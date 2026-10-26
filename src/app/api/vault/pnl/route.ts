import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { receiptsForAgent, type Receipt } from "@/lib/receipt-store";
import { loadAltanaSessions } from "@/lib/vault-actor";
import { rpcTransport } from "@/lib/rpc";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

const EXPLORER: Record<number, string> = {
  56: "https://bscscan.com",
  97: "https://testnet.bscscan.com",
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : typeof v === "bigint" ? v.toString() : null;
}

function delta(policy: string, r: Receipt): { unit: string; value: number | string } | null {
  if (r.status !== "traded" || !r.before || !r.after) return null;
  if (policy === "Band") {
    const a = num(r.before.weightA);
    const b = num(r.after.weightA);
    if (a == null || b == null) return null;
    return { unit: "weight pts", value: Number((b - a).toFixed(3)) };
  }
  if (policy === "Buffer-Vault") {
    const a = str(r.before.totalSleeve) ?? str(r.before.liquid);
    const b = str(r.after.totalSleeve) ?? str(r.after.liquid);
    if (a == null || b == null) return null;
    try { return { unit: "sleeve", value: (BigInt(b) - BigInt(a)).toString() }; } catch { return null; }
  }
  if (policy === "Porter") {
    const a = num(r.before.healthFactor);
    const b = num(r.after.healthFactor);
    if (a == null || b == null) return null;
    return { unit: "health factor", value: Number((b - a).toFixed(4)) };
  }
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const chainId = Number(req.nextUrl.searchParams.get("chainId")) || targetChainId();

  const unread: Record<string, string> = {};
  let blockNumber: number | null = null;
  let blockTime: string | null = null;
  try {
    const block = await createPublicClient({ transport: rpcTransport(chainId) }).getBlock({ blockTag: "latest" });
    blockNumber = Number(block.number);
    blockTime = new Date(Number(block.timestamp) * 1000).toISOString();
  } catch (e) {
    unread.blockNumber = e instanceof Error ? e.message.slice(0, 160) : "rpc did not answer";
  }

  const sessions = loadAltanaSessions(chainId);
  const wallets = sessions.map((s) => ({ wallet: s.walletAddress, label: s.label ?? "agent" }));
  if (wallets.length === 0) {
    const raw = process.env.AGENT_EXECUTOR_KEY;
    if (raw) {
      const { privateKeyToAccount } = await import("viem/accounts");
      wallets.push({ wallet: privateKeyToAccount(raw as `0x${string}`).address, label: "executor" });
    }
  }

  const agents = await Promise.all(wallets.map(async ({ wallet, label }) => {
    const receipts = await receiptsForAgent(wallet, 200);
    const traded = receipts.filter((r) => r.status === "traded");
    const refused = receipts.filter((r) => r.status === "refused");
    const skipped = receipts.filter((r) => r.status === "skipped");
    const policies = [...new Set(receipts.map((r) => r.policy))];

    const realized: Record<string, { unit: string; value: number | string }> = {};
    for (const r of traded) {
      const d = delta(r.policy, r);
      if (!d) continue;
      const prev = realized[r.policy];
      if (!prev) { realized[r.policy] = d; continue; }
      if (typeof d.value === "number" && typeof prev.value === "number") prev.value = Number((prev.value + d.value).toFixed(4));
      else {
        try { prev.value = (BigInt(String(prev.value)) + BigInt(String(d.value))).toString(); } catch { /* keep */ }
      }
    }

    const last = receipts[0] ?? null;
    const lastTraded = traded[0] ?? null;
    const explorer = EXPLORER[chainId];

    return {
      wallet,
      label,
      decisions: receipts.length,
      traded: traded.length,
      skipped: skipped.length,
      refused: refused.length,
      policies,
      realized,
      lastBlock: last?.blockNumber ?? null,
      lastTx: lastTraded?.txHash ?? null,
      lastTxUrl: lastTraded?.txHash && explorer ? `${explorer}/tx/${lastTraded.txHash}` : null,
      lastAt: last?.createdAt ?? null,
      recent: receipts.slice(0, 5).map((r) => ({
        policy: r.policy,
        status: r.status,
        reason: r.reason,
        txHash: r.txHash,
        blockNumber: r.blockNumber,
        createdAt: r.createdAt,
      })),
    };
  }));

  return NextResponse.json({
    success: true,
    ok: true,
    chainId,
    blockNumber,
    blockTime,
    generatedAt: new Date().toISOString(),
    ...(Object.keys(unread).length > 0 ? { unread } : {}),
    source: "execution_receipt",
    agents,
    rederive: {
      via: "receipts",
      request: `/api/vault/receipts?chainId=${chainId}&agent=<wallet>`,
    },
  }, { headers: { "cache-control": "no-store" } });
}
