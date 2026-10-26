import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { rpcTransport } from "@/lib/rpc";
import { recentReceipts, refuteReceipt, type Receipt } from "@/lib/receipt-store";
import { clearStrategyState } from "@/lib/strategy-store";
import { targetChainId, BSC_TESTNET_CHAIN_ID } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/admin/reconcile-receipts  (Authorization: Bearer $CRON_SECRET)
// body: { chainId?, limit? }
//
// A "traded" receipt is a claim that a transaction moved the hire. This pass
// asks the chain. A hash the chain cannot show, a reverted receipt, or a row
// whose before and after balances are identical is stood down to "refused",
// and the hire's strategy state is cleared so the rung can be filled honestly.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { chainId?: number; limit?: number };
  const chainId = Number(body.chainId) || targetChainId();
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);
  const client = createPublicClient({
    chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc,
    transport: rpcTransport(chainId),
  });

  const rows = await recentReceipts(chainId, limit);
  const refuted: { id: string; hireId: string; txHash: string | null; reason: string }[] = [];
  const confirms: { id: string; txHash: string }[] = [];
  let checked = 0;

  const balanced = (r: Receipt): boolean => {
    const before = (r.before ?? {}) as Record<string, unknown>;
    const after = (r.after ?? {}) as Record<string, unknown> | null;
    if (!after) return false;
    const keys = ["balanceA", "balanceB"].filter((k) => before[k] != null && after[k] != null);
    if (keys.length === 0) return true;
    return keys.some((k) => String(before[k]) !== String(after[k]));
  };

  for (const r of rows) {
    if (r.status !== "traded") continue;
    checked += 1;
    if (!r.txHash) {
      await refuteReceipt(r.id, "no transaction hash on the receipt");
      await clearStrategyState(chainId, r.hireId);
      refuted.push({ id: r.id, hireId: r.hireId, txHash: null, reason: "no transaction hash" });
      continue;
    }
    const receipt = await client.getTransactionReceipt({ hash: r.txHash as `0x${string}` }).catch(() => null);
    if (!receipt) {
      await refuteReceipt(r.id, `tx ${r.txHash} is not on chain`);
      await clearStrategyState(chainId, r.hireId);
      refuted.push({ id: r.id, hireId: r.hireId, txHash: r.txHash, reason: "tx not found" });
      continue;
    }
    if (receipt.status !== "success") {
      await refuteReceipt(r.id, `tx ${r.txHash} reverted on chain`);
      await clearStrategyState(chainId, r.hireId);
      refuted.push({ id: r.id, hireId: r.hireId, txHash: r.txHash, reason: "tx reverted" });
      continue;
    }
    if (!balanced(r)) {
      await refuteReceipt(r.id, `tx ${r.txHash} mined but the hire's balances did not move`);
      await clearStrategyState(chainId, r.hireId);
      refuted.push({ id: r.id, hireId: r.hireId, txHash: r.txHash, reason: "no balance change" });
      continue;
    }
    confirms.push({ id: r.id, txHash: r.txHash });
  }

  return NextResponse.json(
    { success: true, chainId, scanned: rows.length, checked, confirmed: confirms.length, refuted, confirms },
    { headers: { "cache-control": "no-store" } },
  );
}
