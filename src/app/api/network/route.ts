import { NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { rpcTransport } from "@/lib/rpc";
import { readFreshness } from "@/lib/freshness";
import { BSC_TESTNET_CHAIN_ID, targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_MS = 30_000;
const PRICE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin&vs_currencies=usd";
const FALLBACK_PRICE_URL = "https://api.coinbase.com/v2/prices/BNB-USD/spot";

interface Reading {
  price: number | null;
  tps: number | null;
  block: number | null;
  checkedAt: string;
  source: string;
  error: string | null;
}

let cache: { at: number; reading: Reading } | null = null;

async function readPrice(): Promise<{ price: number | null; source: string; error: string | null }> {
  try {
    const res = await fetch(PRICE_URL, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const body = (await res.json()) as { binancecoin?: { usd?: number } };
      const price = body.binancecoin?.usd;
      if (typeof price === "number" && Number.isFinite(price)) {
        return { price, source: "coingecko", error: null };
      }
    }
  } catch {
    // fall through
  }
  try {
    const res = await fetch(FALLBACK_PRICE_URL, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const body = (await res.json()) as { data?: { amount?: string } };
      const price = Number(body.data?.amount);
      if (Number.isFinite(price)) return { price, source: "coinbase", error: null };
    }
  } catch {
    // fall through
  }
  return { price: null, source: "none", error: "price unavailable" };
}

async function readBlock(chainId: number): Promise<{ tps: number | null; block: number | null; error: string | null }> {
  try {
    const client = createPublicClient({
      chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc,
      transport: rpcTransport(chainId),
    });
    const block = await client.getBlock({ blockTag: "latest", includeTransactions: false });
    const txs = block.transactions.length;
    return { tps: Math.round(txs / 3), block: Number(block.number), error: null };
  } catch {
    return { tps: null, block: null, error: "chain unavailable" };
  }
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    const age = now - Date.parse(cache.reading.checkedAt);
    return NextResponse.json(
      {
        data: cache.reading,
        error: null,
        meta: { cached: true, checkedAt: cache.reading.checkedAt, freshness: readFreshness(cache.reading.checkedAt, now), cacheMs: CACHE_MS },
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  }

  const chainId = targetChainId();
  const [price, chain] = await Promise.all([readPrice(), readBlock(chainId)]);
  const reading: Reading = {
    price: price.price,
    tps: chain.tps,
    block: chain.block,
    checkedAt: new Date(now).toISOString(),
    source: price.source,
    error: price.error ?? chain.error,
  };
  cache = { at: now, reading };

  return NextResponse.json(
    {
      data: reading,
      error: reading.price === null && reading.tps === null ? "all sources unavailable" : null,
      meta: { cached: false, checkedAt: reading.checkedAt, freshness: readFreshness(reading.checkedAt, now), cacheMs: CACHE_MS },
    },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
  );
}
