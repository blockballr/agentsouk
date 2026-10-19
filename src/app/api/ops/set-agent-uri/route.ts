import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { BSC_CHAIN_ID, targetChainId } from "@/lib/types";
import { registryAddress } from "@/lib/registry-write";
import { rpcTransport } from "@/lib/rpc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The house wallet's key lives only in the environment, so manager actions on
// house-owned listings (a corrected agent URI, for instance) run here instead
// of in a local script. Guarded by the cron secret and by an on-chain owner
// check, so it can only ever rewrite a listing the house wallet itself owns.

const MAX_URI = 512;

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  // fails closed, like the money-spending cron routes
  if (!cronSecret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { tokenId?: unknown; uri?: unknown } = { tokenId: null, uri: null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body must be json" }, { status: 400 });
  }
  const tokenId = Number(body?.tokenId);
  if (!Number.isInteger(tokenId) || tokenId <= 0) {
    return NextResponse.json({ error: "tokenId must be a positive integer" }, { status: 400 });
  }
  const uri = typeof body?.uri === "string" ? body.uri.trim() : "";
  if (!uri.startsWith("https://") || uri.length > MAX_URI) {
    return NextResponse.json({ error: "uri must be a short https url" }, { status: 400 });
  }

  const chainId = targetChainId();
  if (chainId !== BSC_CHAIN_ID) {
    return NextResponse.json({ error: "ops writes settle on BSC only" }, { status: 400 });
  }
  const sellerKey = (process.env.SELLER8183_PRIVATE_KEY_TAJIR ?? process.env.SELLER8183_PRIVATE_KEY ?? "").trim();
  const normalized = sellerKey.startsWith("0x") ? sellerKey : `0x${sellerKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    return NextResponse.json({ error: "house wallet key is not configured" }, { status: 503 });
  }
  const signer = privateKeyToAccount(normalized as `0x${string}`);

  const publicClient = createPublicClient({ chain: bsc, transport: rpcTransport(chainId) });
  const walletClient = createWalletClient({ account: signer, chain: bsc, transport: rpcTransport(chainId) });
  const owner = (await publicClient.readContract({
    address: registryAddress(chainId),
    abi: [{ name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] }] as const,
    functionName: "ownerOf",
    args: [BigInt(tokenId)],
  }).catch(() => null)) as string | null;
  if (!owner || !isAddress(owner)) {
    return NextResponse.json({ error: "cannot read the token on chain" }, { status: 502 });
  }
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    return NextResponse.json(
      { error: "the house wallet does not own this token, so it will not be rewritten", owner },
      { status: 403 },
    );
  }

  const hash = await walletClient.writeContract({
    address: registryAddress(chainId),
    abi: [
      {
        name: "setAgentURI",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "agentId", type: "uint256" },
          { name: "newURI", type: "string" },
        ],
        outputs: [],
      },
    ] as const,
    functionName: "setAgentURI",
    args: [BigInt(tokenId), uri],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return NextResponse.json({ success: true, hash, status: receipt.status, block: Number(receipt.blockNumber) });
}
