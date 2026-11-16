import { NextRequest, NextResponse } from "next/server";
import { erc8183Stack, negotiateQuote } from "@/lib/jobs8183";
import { fetchAgentDetail } from "@/lib/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/compare/quotes {chainId, tokenIds, task} - asks each agent's own
// negotiate step to price the same task. a quote moves no money; it is the
// signed price the seller would accept for a job. answers are cached an hour
// per agent and task, so a page left open does not keep asking sellers

const MAX_AGENTS = 6;
const MAX_TASK = 400;
const TTL_MS = 60 * 60_000;
const cache = new Map<string, { at: number; row: QuoteRow }>();
const asked = new Map<string, number[]>();

export interface QuoteRow {
  tokenId: string;
  ok: boolean;
  price: string | null;
  reason: string | null;
}

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (asked.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  asked.set(ip, recent);
  return recent.length > 6;
}

function formatPrice(price: bigint, currency: string, paymentToken: string | null): string {
  const amount = (Number(price) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 4 });
  const label = paymentToken && currency.toLowerCase() === paymentToken.toLowerCase() ? "U" : `of ${currency.slice(0, 6)}...${currency.slice(-4)}`;
  return `${amount} ${label}`;
}

async function quoteOne(chainId: number, tokenId: string, task: string): Promise<QuoteRow> {
  const key = `${chainId}:${tokenId}:${task}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;
  const detail = await fetchAgentDetail(chainId, tokenId, 6000).catch(() => null);
  let row: QuoteRow;
  if (!detail?.a2a_endpoint) {
    row = { tokenId, ok: false, price: null, reason: "takes no quotes: it publishes no A2A endpoint" };
  } else {
    const result = await negotiateQuote(chainId, detail.a2a_endpoint, task, null).catch(() => null);
    row = !result
      ? { tokenId, ok: false, price: null, reason: "did not answer" }
      : result.ok
        ? { tokenId, ok: true, price: formatPrice(result.quote.price, result.quote.currency, erc8183Stack(chainId)?.paymentToken ?? null), reason: null }
        : { tokenId, ok: false, price: null, reason: result.error };
  }
  cache.set(key, { at: Date.now(), row });
  return row;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) return NextResponse.json({ success: false, error: "too many quote requests; wait a minute" }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { chainId?: number; tokenIds?: unknown; task?: unknown } | null;
  const chainId = Number(body?.chainId ?? 56);
  const task = typeof body?.task === "string" ? body.task.trim() : "";
  const tokenIds = Array.isArray(body?.tokenIds) ? body!.tokenIds.filter((t): t is string => typeof t === "string" && /^\d+$/.test(t)) : [];
  if (!task || task.length > MAX_TASK) {
    return NextResponse.json({ success: false, error: `describe the task in 1 to ${MAX_TASK} characters` }, { status: 400 });
  }
  if (tokenIds.length === 0 || tokenIds.length > MAX_AGENTS) {
    return NextResponse.json({ success: false, error: `name 1 to ${MAX_AGENTS} agents` }, { status: 400 });
  }
  const quotes = await Promise.all(tokenIds.map((id) => quoteOne(chainId, id, task)));
  return NextResponse.json({ success: true, chainId, task, quotes });
}
