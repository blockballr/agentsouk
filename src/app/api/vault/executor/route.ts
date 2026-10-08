import { NextResponse } from "next/server";
import { executorWallet } from "@/lib/vault-executor";
import { vaultFor } from "@/lib/vault";
import { BSC_TESTNET_CHAIN_ID } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/vault/executor
// The pairing a deposit-hire link checks: which wallet the executor trades
// from and which contract the deposit lands in. The address is public chain
// state, every executed hire names it; nothing secret leaves this route, and
// a deployment with no executor lane answers simply none.
export async function GET() {
  return NextResponse.json({
    executor: executorWallet(),
    vault: vaultFor(BSC_TESTNET_CHAIN_ID),
  });
}
