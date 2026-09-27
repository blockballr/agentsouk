import { NextRequest, NextResponse } from "next/server";
import { listPaymentsByClient, receiptsMode } from "@/lib/receipts-store";
import { queryAgents } from "@/lib/scanner";
import { cacheKeys, cached } from "@/lib/short-cache";
import { snapshotFileFor, targetChainId } from "@/lib/types";
import { CATEGORY_KEYS, type CategoryKey } from "@agora/core";

export const dynamic = "force-dynamic";

// A hire list only changes on settle or revoke; five seconds bounds the lag for
// the settle path, which runs in another route this read cannot invalidate, and
// keeps the answer live for a page the buyer opens rather than polls.
const HIRES_TTL_MS = 5000;

// The catalogue changes on the scanner's own 60s cadence and is shared by every
// wallet, so map chain:token to category once per window instead of sorting the
// whole shelf on each wallet read.
const CATEGORY_TTL_MS = 60_000;

// Hires per wallet, read from the durable receipts store rather than the in-process ledger.

async function categoryMap(): Promise<Map<string, string>> {
  return cached(
    cacheKeys.categoryMap(targetChainId()),
    CATEGORY_TTL_MS,
    async () => {
      const catalogue = await queryAgents({ limit: 5000 });
      const map = new Map<string, string>();
      for (const a of catalogue.items) {
        map.set(`${a.chain_id}:${a.token_id}`, a.category ?? "general");
      }
      return map;
    },
  );
}

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

  const body = await cached(cacheKeys.hires(wallet), HIRES_TTL_MS, () =>
    hiresForWallet(wallet),
  );
  return NextResponse.json(body);
}

async function hiresForWallet(wallet: string) {
  // The durable read is the batch: every receipt for this wallet arrives in one
  // query, so the join below never has to reach the store per payment.
  const stored = await listPaymentsByClient(wallet);
  const categoryByToken = await categoryMap();
  const foreignCategories = new Map<string, string>();

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
        if (
          CATEGORY_KEYS.includes(a.category as CategoryKey) &&
          !categoryByToken.has(key) &&
          !foreignCategories.has(key)
        ) {
          foreignCategories.set(key, a.category as CategoryKey);
        }
      }
    } catch {
      // a missing older snapshot leaves those rows uncategorised rather than failing the response
    }
  }

  // a session counts only once its payment is actually recorded, so an unsettled attempt cannot appear
  const hires = [];
  for (const p of stored) {
    if (!p.activated) continue;
    const categoryKey = `${p.agent.chainId}:${p.agent.tokenId}`;
    hires.push({
      paymentId: p.paymentId,
      receiptId: p.paymentId,
      chainId: p.agent.chainId,
      tokenId: p.agent.tokenId,
      agentName: p.agent.name,
      category: categoryByToken.get(categoryKey) ?? foreignCategories.get(categoryKey) ?? null,
      client: p.client,
      txHash: p.txHash ?? null,
      mode: p.mode,
      spendCapUsd: p.session.spendCapUsd,
      createdAt: p.createdAt,
      expiresAt: p.session.expiresAt,
    });
  }

  return {
    success: true,
    wallet,
    hires,
    counts: {
      hires: hires.length,
    },
    // surfaced so a reader can tell a genuinely empty answer from an incomplete one
    source: receiptsMode(),
  };
}
