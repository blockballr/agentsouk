import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { assessAuthority, describeAuthority, type AuthorityFacts } from "@/lib/authority";
import {
  DECLARATION_SIGNATURE_WINDOW_MS,
  declarationDigest,
  declarationMessage,
  normaliseDeclaration,
} from "@/lib/authority-declaration";
import { declarationKey, loadDeclaration, saveDeclaration } from "@/lib/authority-store";
import { isAgentOwner, verifyBoostOwnership } from "@/lib/boost-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rpcTransport } from "@/lib/rpc";
import { getAgentByToken } from "@/lib/scanner";
import { loadTrackRecord } from "@/lib/track-record";
import { BSC_TESTNET_CHAIN_ID, settlementAsset, targetChainId } from "@/lib/types";
import { loadVerifications } from "@/lib/verifications";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const erc20Abi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

async function readBond(
  chainId: number,
  wallet: string | null,
): Promise<{ wallet: string; usd: number; block: number } | null> {
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return null;
  const asset = settlementAsset(chainId);
  try {
    const client = createPublicClient({
      chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc,
      transport: rpcTransport(chainId),
    });
    const [raw, block] = await Promise.all([
      client.readContract({
        address: asset.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet as `0x${string}`],
      }),
      client.getBlockNumber(),
    ]);
    return { wallet, usd: Number(raw) / 10 ** asset.decimals, block: Number(block) };
  } catch {
    return null;
  }
}

function priceFrom(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get("price") ?? "");
  if (!Number.isFinite(raw) || raw < 0) return 0.02;
  return Math.min(raw, 1000);
}

// GET /api/agents/[chainId]/[tokenId]/authority?price=0.02
// The grant the marketplace would issue for one hire, and the facts behind it.
// The bond is the owner's live balance of the settlement asset, read at a block,
// not a declaration: nothing is escrowed yet, so the response says so.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> },
) {
  const { chainId: chainRaw, tokenId } = await params;
  const chainId = Number(chainRaw);
  if (!Number.isFinite(chainId) || chainId !== targetChainId()) {
    return NextResponse.json({ success: false, error: "unsupported chain" }, { status: 400 });
  }
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ success: false, error: "bad token id" }, { status: 400 });
  }

  const agent = await getAgentByToken(chainId, tokenId);
  if (!agent) {
    return NextResponse.json({ success: false, error: "agent not found" }, { status: 404 });
  }

  const owner = "owner_address" in agent ? (agent.owner_address as string | null) : null;
  const [record, verifications, bond, declared] = await Promise.all([
    loadTrackRecord(chainId, tokenId, owner),
    loadVerifications(chainId),
    readBond(chainId, owner),
    loadDeclaration(declarationKey(chainId, tokenId)),
  ]);
  const verification = verifications.get(tokenId);
  const facts: AuthorityFacts = {
    hires: record.hires,
    completed: record.completed,
    distinctBuyers: record.distinctBuyers,
    successRate: record.successRate,
    firstHireAt: record.firstHireAt,
    verified: verification?.status === "online",
    bondUsd: bond ? bond.usd : null,
    priceUsd: priceFrom(req),
    symbol: settlementAsset(chainId).symbol,
  };
  const authority = assessAuthority(facts, declared);

  return NextResponse.json(
    {
      success: true,
      authority,
      summary: describeAuthority(authority),
      facts,
      bond,
      declared,
      meta: { chainId, tokenId, checkedAt: new Date().toISOString() },
    },
    { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}

const WRITE_RATE = {
  table: "authority_write_rate",
  limit: 20,
  windowMs: 60 * 60 * 1000,
};

// POST /api/agents/[chainId]/[tokenId]/authority
// the registered owner declares the ceiling this agent may be offered, signed
// with the owner key. A declaration can only narrow what the record earns.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> },
) {
  const { chainId: chainRaw, tokenId } = await params;
  const chainId = Number(chainRaw);
  if (!Number.isFinite(chainId) || chainId !== targetChainId()) {
    return NextResponse.json({ success: false, error: "unsupported chain" }, { status: 400 });
  }
  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json({ success: false, error: "bad token id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as {
    owner?: unknown;
    signature?: unknown;
    issuedAt?: unknown;
    declaration?: unknown;
  } | null;
  const owner = typeof body?.owner === "string" ? body.owner : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  const issuedAt = typeof body?.issuedAt === "string" ? body.issuedAt : "";
  if (!owner || !signature || !issuedAt) {
    return NextResponse.json(
      { success: false, error: "owner, signature and issuedAt required" },
      { status: 400 },
    );
  }
  const signedAt = Date.parse(issuedAt);
  if (!Number.isFinite(signedAt) || new Date(signedAt).toISOString() !== issuedAt) {
    return NextResponse.json({ success: false, error: "issuedAt must be an ISO time" }, { status: 400 });
  }
  if (Math.abs(Date.now() - signedAt) > DECLARATION_SIGNATURE_WINDOW_MS) {
    return NextResponse.json(
      { success: false, error: "that signature is too old, sign the declaration again" },
      { status: 400 },
    );
  }

  const checked = normaliseDeclaration(body?.declaration);
  if (!checked.ok) {
    return NextResponse.json({ success: false, error: checked.errors.join("; ") }, { status: 400 });
  }

  const agent = await getAgentByToken(chainId, tokenId);
  if (!agent) return NextResponse.json({ success: false, error: "agent not found" }, { status: 404 });
  if (!isAgentOwner(owner, agent)) {
    return NextResponse.json({ success: false, error: "only the registered owner may set this" }, { status: 403 });
  }

  const digest = await declarationDigest(checked.value);
  const message = declarationMessage(chainId, tokenId, owner, digest, issuedAt);
  const verdict = await verifyBoostOwnership({ message, signature, expectedOwner: owner });
  if (!verdict.ok) {
    return NextResponse.json({ success: false, error: verdict.error ?? "signature did not match" }, { status: 403 });
  }

  try {
    const rate = await enforceRateLimit(WRITE_RATE, { keys: [`token:${chainId}:${tokenId}`] });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many declarations. Try again later." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, error: "Declarations are temporarily unavailable." },
      { status: 503 },
    );
  }

  const saved = await saveDeclaration(declarationKey(chainId, tokenId), checked.value, owner);
  if (!saved) {
    return NextResponse.json(
      { success: false, error: "the declaration store could not take the write" },
      { status: 503 },
    );
  }
  return NextResponse.json({ success: true, declared: checked.value });
}
