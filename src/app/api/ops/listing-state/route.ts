import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, isAddress } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { HOUSE_OPERATOR } from "@/lib/house";
import { BSC_CHAIN_ID, targetChainId } from "@/lib/types";
import { registryAddress } from "@/lib/registry-write";
import { rpcTransport } from "@/lib/rpc";
import { setDelisted } from "@/lib/delist-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Takes a house listing off the market without a browser wallet. The public
// delist route proves ownership with a signature; a listing whose key lives in
// the environment cannot sign there, so this route proves the same fact with an
// on-chain owner read and writes the same store. The bearer secret gates the
// call, and the owner check keeps it to tokens the house actually controls.

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { tokenId?: unknown; action?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body must be json" }, { status: 400 });
  }
  const tokenId = Number(body?.tokenId);
  if (!Number.isInteger(tokenId) || tokenId <= 0) {
    return NextResponse.json({ error: "tokenId must be a positive integer" }, { status: 400 });
  }
  const action = body?.action === "delist" || body?.action === "relist" ? body.action : null;
  if (!action) {
    return NextResponse.json({ error: "action must be delist or relist" }, { status: 400 });
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
  const owner = (await publicClient.readContract({
    address: registryAddress(chainId),
    abi: [{ name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] }] as const,
    functionName: "ownerOf",
    args: [BigInt(tokenId)],
  }).catch(() => null)) as string | null;
  if (!owner || !isAddress(owner)) {
    return NextResponse.json({ error: "cannot read the token on chain" }, { status: 502 });
  }
  const house = [signer.address, HOUSE_OPERATOR].map((address) => address.toLowerCase());
  if (!house.includes(owner.toLowerCase())) {
    return NextResponse.json(
      { error: "the house does not own this token, so it cannot change its listing state", owner },
      { status: 403 },
    );
  }

  const persisted = await setDelisted(
    String(tokenId),
    action === "delist",
    action === "delist" ? "house delist" : undefined,
  );
  if (!persisted) {
    return NextResponse.json({ error: "the listing state could not be persisted, try again" }, { status: 503 });
  }
  return NextResponse.json({ success: true, tokenId, delisted: action === "delist" });
}
