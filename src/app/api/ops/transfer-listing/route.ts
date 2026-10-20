import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, isAddress } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { HOUSE_OPERATOR } from "@/lib/house";
import { BSC_CHAIN_ID, targetChainId } from "@/lib/types";
import { registryAddress } from "@/lib/registry-write";
import { rpcTransport } from "@/lib/rpc";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hands a house-owned listing to a wallet the operator controls, so the key
// that signs quotes and deliveries is not also the key that must be kept forever
// to manage the token. The recipient is fixed here rather than taken from the
// request: a leaked secret must not be able to send a listing anywhere else.

const RECIPIENT = HOUSE_OPERATOR;

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { tokenId?: unknown } = { tokenId: null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body must be json" }, { status: 400 });
  }
  const tokenId = Number(body?.tokenId);
  if (!Number.isInteger(tokenId) || tokenId <= 0) {
    return NextResponse.json({ error: "tokenId must be a positive integer" }, { status: 400 });
  }

  const chainId = targetChainId();
  if (chainId !== BSC_CHAIN_ID) {
    return NextResponse.json({ error: "ops writes settle on BSC only" }, { status: 400 });
  }
  if (!isAddress(RECIPIENT)) {
    return NextResponse.json({ error: "the recipient is not a wallet address" }, { status: 500 });
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
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    return NextResponse.json(
      { error: "the house wallet does not own this token, so it cannot be transferred", owner },
      { status: 403 },
    );
  }

  const walletClient = createWalletClient({ account: signer, chain: bsc, transport: rpcTransport(chainId) });
  const hash = await walletClient.writeContract({
    address: registryAddress(chainId),
    abi: [
      {
        name: "transferFrom",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "tokenId", type: "uint256" },
        ],
        outputs: [],
      },
    ] as const,
    functionName: "transferFrom",
    args: [owner as `0x${string}`, RECIPIENT, BigInt(tokenId)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const after = (await publicClient.readContract({
    address: registryAddress(chainId),
    abi: [{ name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] }] as const,
    functionName: "ownerOf",
    args: [BigInt(tokenId)],
  })) as string;
  return NextResponse.json({ success: true, hash, status: receipt.status, owner: after, recipient: RECIPIENT });
}
