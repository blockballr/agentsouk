import { NextRequest, NextResponse } from "next/server";
import {
  ContractFunctionExecutionError,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  createPublicClient,
  type Address,
} from "viem";
import { targetChainId } from "@/lib/types";
import { registryAddress } from "@/lib/registry-write";
import { rpcTransport } from "@/lib/rpc";
import {
  checkRegistrationProof,
  confirmClaim,
  getClaim,
  isClaimExpired,
  isTxHash,
  parseAgentId,
  type RegistrationProof,
} from "@/lib/listing-claims";
import {
  admitConfirmedAgent,
  summaryFromRegistration,
  type ShelfAdmission,
} from "@/lib/scanner";
import { enqueueSweep } from "@/lib/verifications-store";

export const dynamic = "force-dynamic";

// The registry mints an ERC-721 per registration, so the agent id is the token id.
const ERC721_ABI = [
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

// only the identifying first line of a viem error dump travels back
function brief(e: unknown): string {
  return String((e as Error)?.message ?? e).split("\n")[0].slice(0, 160);
}

type Verdict =
  | { outcome: "verified"; detail: string }
  | { outcome: "refuted"; detail: string }
  | { outcome: "unavailable"; detail: string };

// Three outcomes: refuted means the chain disagrees; unavailable means it could not be read.
async function readChain(args: {
  chainId: number;
  agentId: string;
  agentUri: string;
  owner: string;
  txHash: `0x${string}`;
}): Promise<Verdict> {
  const registry: Address = registryAddress(args.chainId);
  const client = createPublicClient({
    transport: rpcTransport(args.chainId, process.env.REGISTRY_RPC_URL),
  });

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: args.txHash });
  } catch (e) {
    if (e instanceof TransactionReceiptNotFoundError) {
      return { outcome: "refuted", detail: "No transaction with that hash exists on this chain." };
    }
    return { outcome: "unavailable", detail: `RPC read failed: ${brief(e)}` };
  }

  // the receipt does not carry its calldata, so the signed-over uri comes from the transaction
  let calldata: `0x${string}`;
  try {
    calldata = (await client.getTransaction({ hash: args.txHash })).input;
  } catch (e) {
    if (e instanceof TransactionNotFoundError) {
      return { outcome: "refuted", detail: "That transaction is not on this chain." };
    }
    return { outcome: "unavailable", detail: `RPC read failed: ${brief(e)}` };
  }

  let onchainUri: string;
  let holder: string;
  try {
    onchainUri = await client.readContract({
      address: registry,
      abi: ERC721_ABI,
      functionName: "tokenURI",
      args: [BigInt(args.agentId)],
    });
    holder = await client.readContract({
      address: registry,
      abi: ERC721_ABI,
      functionName: "ownerOf",
      args: [BigInt(args.agentId)],
    });
  } catch (e) {
    // ContractFunctionExecutionError covers the ERC721NonexistentToken revert, undecoded in our ABI
    if (e instanceof ContractFunctionExecutionError) {
      return { outcome: "refuted", detail: `The registry has no agent ${args.agentId}.` };
    }
    return { outcome: "unavailable", detail: `Registry read failed: ${brief(e)}` };
  }

  const proof: RegistrationProof = {
    registry,
    agentId: args.agentId,
    agentUri: args.agentUri,
    owner: args.owner,
    receipt: {
      status: receipt.status,
      to: receipt.to ?? null,
      logs: receipt.logs.map((l) => ({ address: l.address, topics: l.topics })),
    },
    calldata,
    tokenURI: onchainUri,
    holder,
  };

  const result = checkRegistrationProof(proof);
  if (!result.ok) return { outcome: "refuted", detail: result.reason };
  return {
    outcome: "verified",
    detail:
      "Checked onchain: the transaction succeeded against the identity registry, " +
      "minted this agent id, signed over this agentURI, and the registry records " +
      "the same uri for the same wallet.",
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    claimId?: unknown;
    agentId?: unknown;
    txHash?: unknown;
  } | null;

  const claimId = typeof body?.claimId === "string" ? body.claimId.trim() : "";
  if (!claimId) {
    return NextResponse.json({ success: false, error: "claimId is required." }, { status: 400 });
  }
  const agentId = parseAgentId(body?.agentId);
  if (agentId === null) {
    return NextResponse.json(
      { success: false, error: "agentId must be a uint256, decimal or 0x hex." },
      { status: 400 },
    );
  }
  const txHash = body?.txHash;
  if (!isTxHash(txHash)) {
    return NextResponse.json(
      { success: false, error: "txHash must be 0x followed by 64 hex characters." },
      { status: 400 },
    );
  }

  const claim = await getClaim(claimId);
  if (!claim) {
    return NextResponse.json({ success: false, error: "claim not found" }, { status: 404 });
  }
  // a confirmed claim is final: re-running would let a caller swap in another valid registration
  if (claim.status === "confirmed") {
    return NextResponse.json(
      { success: false, error: "This claim is already confirmed." },
      { status: 409 },
    );
  }
  // 410 mirrors the GET: the window closed, so nothing is confirmed and no chain read is wasted
  if (isClaimExpired(claim)) {
    return NextResponse.json(
      {
        success: false,
        error: "This claim expired before it was confirmed. Prepare a new listing.",
      },
      { status: 410 },
    );
  }
  if (claim.chainId !== targetChainId()) {
    return NextResponse.json(
      { success: false, error: "This claim was prepared for a different chain." },
      { status: 409 },
    );
  }

  let verdict: Verdict;
  try {
    verdict = await readChain({
      chainId: claim.chainId,
      agentId,
      agentUri: claim.agentUri,
      owner: claim.owner,
      txHash: txHash as `0x${string}`,
    });
  } catch (e) {
    // registryAddress throws when TARGET_CHAIN has no registry, which is a deployment fault
    return NextResponse.json({ success: false, error: brief(e) }, { status: 500 });
  }

  if (verdict.outcome === "refuted") {
    return NextResponse.json(
      { success: false, error: verdict.detail, verified: false, verification: verdict.detail },
      { status: 409 },
    );
  }
  if (verdict.outcome === "unavailable") {
    return NextResponse.json(
      {
        success: false,
        error: "Could not read the registry, so this was not confirmed. Retry when the chain answers.",
        verified: false,
        retryable: true,
        verification: verdict.detail,
      },
      { status: 503 },
    );
  }

  const confirmed = await confirmClaim(claim.claimId, { agentId, txHash: txHash as string });
  if (!confirmed) {
    return NextResponse.json({ success: false, error: "claim not found" }, { status: 404 });
  }

  // The verification above proved the agent exists and belongs to the caller, so
  // it can go on our shelf now rather than waiting for an indexer to notice it.
  // Admission is deliberately not allowed to fail the registration: the chain
  // fact stands whatever the shelf decides, and a refusal is reported instead.
  let admission: ShelfAdmission;
  try {
    const summary = summaryFromRegistration({
      chainId: confirmed.chainId,
      tokenId: agentId,
      owner: confirmed.owner,
      registry: registryAddress(confirmed.chainId),
      draft: confirmed.draft,
      createdAt: confirmed.confirmedAt ?? new Date().toISOString(),
    });
    admission = await admitConfirmedAgent(summary);
    // A fresh listing jumps the sweep queue so its badge reflects a real probe
    // instead of waiting for a scheduled pass to notice it. Best effort only:
    // the confirmation must never fail because the queue could not be reached.
    // Unadmitted listings are skipped since a sweep without a callable endpoint
    // would spend a hire to learn nothing.
    if (admission.admitted) {
      try {
        await enqueueSweep(agentId, summary.name, summary.category ?? "general");
      } catch {
        // the listing stands regardless; the next scheduled sweep covers it
      }
    }
  } catch (e) {
    admission = { admitted: false, reason: `the shelf could not be reached: ${brief(e)}` };
  }

  return NextResponse.json({
    success: true,
    claimId: confirmed.claimId,
    status: confirmed.status,
    agentId: confirmed.agentId,
    txHash: confirmed.txHash,
    agentUri: confirmed.agentUri,
    verified: true,
    verification: verdict.detail,
    listed: admission.admitted,
    listingReason: admission.reason ?? null,
  });
}
