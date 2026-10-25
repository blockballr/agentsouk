import { NextResponse } from "next/server";
import { executorWallet, executorWallets } from "@/lib/vault-executor";
import { vaultFor } from "@/lib/vault";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/vault/executor
export async function GET() {
  return NextResponse.json({
    executor: executorWallet(),
    executors: executorWallets(),
    vault: vaultFor(targetChainId()),
  });
}
