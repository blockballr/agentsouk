import { NextRequest, NextResponse } from "next/server";
import { getPaymentDurable, listPaymentsByClient, receiptsMode } from "@/lib/receipts-store";
import { queryAgents } from "@/lib/scanner";
import { snapshotFileFor, targetChainId } from "@/lib/types";
import { CATEGORY_KEYS, type CategoryKey } from "@agora/core";

export const dynamic = "force-dynamic";

// Hires per wallet, read from the durable receipts store rather than the in-process ledger.

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!wallet) {
    return NextResponse.json(
      { success: false, error: "wallet required" },
      { status: 400 },
    );
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json(
      { success: false, error: "wallet must be an address" },
      { status: 400 },
    );
  }

  const stored = await listPaymentsByClient(wallet);
  const catalogue = await queryAgents({ limit: 5000 });
  const categoryByToken = new Map(
    catalogue.items.map((a) => [
      `${a.chain_id}:${a.token_id}`,
      a.category ?? "general",
    ]),
  );

  // Hires from another chain are durable and real, so read that snapshot rather than report null.
  const missing = new Set(
    stored
      .filter((p) => !categoryByToken.has(`${p.agent?.chainId}:${p.agent?.tokenId}`))
      .map((p) => p.agent?.chainId)
      .filter((c): c is number => typeof c === "number" && c !== targetChainId()),
  );
  for (const chainId of missing) {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const file = path.join(process.cwd(), "data", snapshotFileFor(chainId));
      const raw = await fs.readFile(file, "utf8");
      const snap = JSON.parse(raw) as {
        agents?: { chain_id?: number; token_id?: number; category?: string | null }[];
      };
      for (const a of snap.agents ?? []) {
        const key = `${a.chain_id ?? chainId}:${a.token_id}`;
        // only accept the category keys the marketplace actually uses, so a stale value cannot leak
        if (CATEGORY_KEYS.includes(a.category as CategoryKey) && !categoryByToken.has(key)) {
          categoryByToken.set(key, a.category as CategoryKey);
        }
      }
    } catch {
      // a missing older snapshot leaves those rows uncategorised rather than failing the response
    }
  }

  // a session counts only once its payment is actually recorded, so an unsettled attempt cannot appear
  const hires = [];
  for (const p of stored) {
    const payment = (await getPaymentDurable(p.paymentId)) ?? p;
    if (!payment.activated) continue;
    hires.push({
      paymentId: payment.paymentId,
      receiptId: payment.paymentId,
      chainId: payment.agent.chainId,
      tokenId: payment.agent.tokenId,
      agentName: payment.agent.name,
      category:
        categoryByToken.get(`${payment.agent.chainId}:${payment.agent.tokenId}`) ?? null,
      client: payment.client,
      txHash: payment.txHash ?? null,
      mode: payment.mode,
      spendCapUsd: payment.session.spendCapUsd,
      createdAt: payment.createdAt,
      expiresAt: payment.session.expiresAt,
    });
  }

  return NextResponse.json({
    success: true,
    wallet,
    hires,
    counts: {
      hires: hires.length,
    },
    // surfaced so a reader can tell a genuinely empty answer from an incomplete one
    source: receiptsMode(),
  });
}
