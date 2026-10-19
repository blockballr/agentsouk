import { NextRequest, NextResponse } from "next/server";
import { isPlaceholderAgentName, resolveAgentName } from "@/lib/agent-name";
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
// wallet, so map chain:token to its listing once per window instead of sorting
// the whole shelf on each wallet read.
const CATEGORY_TTL_MS = 60_000;

// Hires per wallet, read from the durable receipts store rather than the in-process ledger.

interface AgentMeta {
  category: string | null;
  name: string | null;
}

async function agentMetaMap(): Promise<Map<string, AgentMeta>> {
  return cached(
    cacheKeys.categoryMap(targetChainId()),
    CATEGORY_TTL_MS,
    async () => {
      const catalogue = await queryAgents({ limit: 5000 });
      const map = new Map<string, AgentMeta>();
      for (const a of catalogue.items) {
        map.set(`${a.chain_id}:${a.token_id}`, {
          category: a.category ?? "general",
          name: a.name ?? null,
        });
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
  const byToken = await agentMetaMap();
  const foreignMeta = new Map<string, AgentMeta>();

  // Hires from another chain are durable and real, so read that snapshot rather than report null.
  const missing = new Set(
    stored
      .filter((p) => !byToken.has(`${p.agent?.chainId}:${p.agent?.tokenId}`))
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
        agents?: {
          chain_id?: number;
          token_id?: number;
          category?: string | null;
          name?: string | null;
        }[];
      };
      for (const a of snap.agents ?? []) {
        const key = `${a.chain_id ?? chainId}:${a.token_id}`;
        if (byToken.has(key) || foreignMeta.has(key)) continue;
        // only accept the category keys the marketplace actually uses, so a stale value cannot leak
        const category = CATEGORY_KEYS.includes(a.category as CategoryKey)
          ? (a.category as CategoryKey)
          : null;
        const name = a.name?.trim() || null;
        if (!category && !name) continue;
        foreignMeta.set(key, { category, name });
      }
    } catch {
      // a missing older snapshot leaves those rows uncategorised rather than failing the response
    }
  }

  // a session counts only once its payment is actually recorded, so an unsettled attempt cannot appear
  const hires = await Promise.all(
    stored
      .filter((p) => p.activated)
      .map(async (p) => {
        const categoryKey = `${p.agent.chainId}:${p.agent.tokenId}`;
        const meta = byToken.get(categoryKey) ?? foreignMeta.get(categoryKey);
        const storedName = p.agent.name;
        // a generated label from the registry's first read is not the listing
        const agentName =
          (isPlaceholderAgentName(storedName) ? meta?.name : null) ??
          (await resolveAgentName(p.agent.chainId, p.agent.tokenId, storedName)) ??
          storedName ??
          `Agent #${p.agent.tokenId}`;
        return {
          paymentId: p.paymentId,
          receiptId: p.paymentId,
          chainId: p.agent.chainId,
          tokenId: p.agent.tokenId,
          agentName,
          category: meta?.category ?? null,
          client: p.client,
          txHash: p.txHash ?? null,
          mode: p.mode,
          spendCapUsd: p.session.spendCapUsd,
          createdAt: p.createdAt,
          expiresAt: p.session.expiresAt,
        };
      }),
  );

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
