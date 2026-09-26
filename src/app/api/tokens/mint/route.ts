// Sponsored test-token mint: the visitor signs a free message and this route pays.
// The signature must recover to the funded address and a lifetime cap bounds the gas.

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, encodeFunctionData, parseUnits, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import {
  isMintRequestExpired,
  mintRequestMessage,
  validateMintRequest,
} from "@agora/core";
import { readGrant, writeGrant } from "@/lib/mint-grants";
import { rpcTransport } from "@/lib/rpc";
import { BSC_TESTNET_CHAIN_ID, targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// testnet only: on mainnet the settlement asset has no permissionless mint.
const SUSD_ADDRESS = "0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53" as const;

const SUSD_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const GRANT = parseUnits("10", 18);
const MAX_LIFETIME_GRANT = parseUnits("100", 18);
const GAS_DRIP_WEI = parseUnits("0.001", 18);
const SIGNATURE_TTL_SECONDS = 15 * 60;

export async function POST(req: NextRequest) {
  if (targetChainId() !== 97) {
    return NextResponse.json(
      { success: false, error: "test tokens are only available on the testnet deployment" },
      { status: 404 },
    );
  }

  const body = await req.json().catch(() => null);
  const { error, fields } = validateMintRequest(body);
  if (error || !fields) {
    return NextResponse.json({ success: false, error: error || "bad request" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (isMintRequestExpired(fields, now)) {
    return NextResponse.json(
      { success: false, error: "that request expired, please try again" },
      { status: 400 },
    );
  }

  // verifyMessage recovers the signer over this exact text, which is the whole authorisation
  let signatureMatches = false;
  try {
    signatureMatches = await verifyMessage({
      address: fields.address as `0x${string}`,
      message: mintRequestMessage(fields),
      signature: (body as { signature: string }).signature as `0x${string}`,
    });
  } catch {
    signatureMatches = false;
  }

  if (!signatureMatches) {
    return NextResponse.json(
      { success: false, error: "that signature did not match the address" },
      { status: 400 },
    );
  }

  // without a durable cap every deploy resets the allowance into an unbounded gas tap; refuse instead
  let granted = 0n;
  try {
    const existing = await readGrant(fields.address);
    granted = existing?.granted ?? 0n;
  } catch {
    return NextResponse.json(
      { success: false, error: "minting is temporarily unavailable, please try again shortly" },
      { status: 503 },
    );
  }

  if (granted + GRANT > MAX_LIFETIME_GRANT) {
    return NextResponse.json(
      {
        success: false,
        error: "this address has already had its sponsored test tokens",
        granted: granted.toString(),
      },
      { status: 429 },
    );
  }

  const key = process.env.RELAY_PRIVATE_KEY;
  if (!key) {
    return NextResponse.json(
      { success: false, error: "minting is not configured" },
      { status: 503 },
    );
  }

  const account = privateKeyToAccount(key as `0x${string}`);
  // a wallet client, not the bare account: the account can sign but cannot send
  const wallet = createWalletClient({ account, chain: bscTestnet, transport: rpcTransport(BSC_TESTNET_CHAIN_ID) });
  try {
    // record before broadcasting, so a failure cannot be retried into a double grant
    await writeGrant({
      address: fields.address,
      granted: granted + GRANT,
      lastNonce: fields.nonce,
      updatedAt: new Date().toISOString(),
    });


    const hash = await wallet.sendTransaction({
      to: SUSD_ADDRESS,
      data: encodeFunctionData({
        abi: SUSD_ABI,
        functionName: "mint",
        args: [fields.address as `0x${string}`, GRANT],
      }),
    });

    // A small tBNB top-up: registration cannot be sponsored, because the registry
    // records the sender as owner, and the official faucet refuses most newcomers.
    let gasTxHash: string | null = null;
    try {
      const publicClient = createPublicClient({
        chain: bscTestnet,
        transport: rpcTransport(BSC_TESTNET_CHAIN_ID),
      });
      const balance = await publicClient.getBalance({
        address: fields.address as `0x${string}`,
      });
      if (balance === 0n) {
        gasTxHash = await wallet.sendTransaction({
          to: fields.address as `0x${string}`,
          value: GAS_DRIP_WEI,
        });
      }
    } catch {
      // the participant still has their tokens; the drip is a convenience
    }

    return NextResponse.json({
      success: true,
      amount: GRANT.toString(),
      txHash: hash,
      explorer: `https://testnet.bscscan.com/tx/${hash}`,
      gasTxHash,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 502 },
    );
  }
}
