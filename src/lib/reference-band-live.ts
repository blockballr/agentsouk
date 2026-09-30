import "server-only";

import { PANCAKE_FEE_TIERS, chainName, feeTierLabel, isUsdQuote, parsePair, supportedPairs } from "./pancake";
import { readPancakePrice, type PoolReader } from "./pancake-read";
import { pancakeAddLiquidityUrl, suggestRange } from "./pancake-range";
import { BAND_AGENT_CATEGORY, decideBandTask, mergeBandInput, type BandAgentReply } from "./reference-band";
import { targetChainId } from "./types";

// Band Keeper's PancakeSwap mode: a pair and a width ask for a v3 liquidity range around
// that pool's price; anything else is the ordinary drift band check

// "position" and "band" stay out, since a drift check on an LP position uses both words
const LP_INTENT = /liquidity|\blp\b|\brange\b|\bpool\b/i;

interface RangeFields {
  pair?: { base: string; quote: string };
  // the pair arrived as data, which asks for this mode on its own
  pairFromData: boolean;
  invalid: string[];
  widthPct?: number;
  depositUsd?: number;
  feeTier?: number;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value.trim().replace(/[$,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

const FIELD: Record<string, "widthPct" | "depositUsd" | "feeTier"> = {
  widthpct: "widthPct",
  width: "widthPct",
  rangepct: "widthPct",
  depositusd: "depositUsd",
  deposit: "depositUsd",
  amountusd: "depositUsd",
  feetier: "feeTier",
  poolfee: "feeTier",
};

function readRangeFields(task: string, input: Record<string, unknown> | undefined): RangeFields {
  const nested = input?.input;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested) ? (nested as Record<string, unknown>) : (input ?? {});
  const out: RangeFields = { pairFromData: false, invalid: [] };
  for (const [key, raw] of Object.entries(source)) {
    if (raw === null || raw === undefined || raw === "") continue;
    if (key.toLowerCase() === "pair") {
      out.pairFromData = true;
      const pair = typeof raw === "string" ? parsePair(raw) : null;
      if (pair) out.pair = pair;
      else out.invalid.push("pair");
      continue;
    }
    const field = FIELD[key.toLowerCase().replace(/[\s_-]/g, "")];
    if (!field) continue;
    const value = num(raw);
    if (value === undefined) out.invalid.push(field);
    else out[field] = value;
  }
  // prose fills only what the data left out
  if (!out.pair && !out.pairFromData) out.pair = parsePair(task) ?? undefined;
  if (out.widthPct === undefined) {
    const w = /(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:wide|width|range)\b/i.exec(task) ?? /\bwidth\s*(?:of\s*)?(\d+(?:\.\d+)?)/i.exec(task);
    if (w) out.widthPct = Number(w[1]);
  }
  if (out.depositUsd === undefined) {
    const d = /\bdeposit\s*(?:of\s*)?\$?\s*(\d[\d,]*(?:\.\d+)?)/i.exec(task);
    if (d) out.depositUsd = Number(d[1].replace(/,/g, ""));
  }
  return out;
}

function rangeInputRequired(missing: string[], problems: string[], why?: string): BandAgentReply {
  const lines = [why ?? "I cannot suggest a PancakeSwap range yet, and I will not guess the missing values."];
  if (missing.length) lines.push(`Provide ${missing.join(" and ")}.`);
  if (problems.length) lines.push(`Fix: ${problems.join("; ")}.`);
  lines.push('Send a pair and a width, for example { pair: "WBNB/USDT", widthPct: 10, depositUsd: 100 }.');
  return {
    state: "input-required",
    text: lines.join(" "),
    artifact: {
      capability: BAND_AGENT_CATEGORY,
      action: "suggest_lp_range",
      status: "input-required",
      missing,
      problems,
      example: { kind: "data", data: { input: { pair: "WBNB/USDT", widthPct: 10, depositUsd: 100 } } },
      note: "Nothing is inferred from partial values.",
    },
  };
}

const fmt = (n: number, digits = 6) => Number(n.toPrecision(digits));

export async function decideBandTaskLive(
  task: string,
  input?: Record<string, unknown>,
  opts: { chainId?: number; reader?: PoolReader; deadlineMs?: number } = {},
): Promise<BandAgentReply> {
  // any drift band value means the caller wants the band check, whatever else it names
  const band = mergeBandInput(input, task);
  if (band.valueAUsd !== undefined || band.valueBUsd !== undefined || band.targetAPercent !== undefined) {
    return decideBandTask(task, input);
  }
  const f = readRangeFields(task, input);
  const asked = f.pairFromData || (f.pair !== undefined && (LP_INTENT.test(task) || f.widthPct !== undefined));
  if (!asked) return decideBandTask(task, input);

  const chainId = opts.chainId ?? targetChainId();
  const missing: string[] = [];
  const problems: string[] = [];
  if (!f.pair || !isUsdQuote(f.pair.quote)) {
    problems.push(`pair must be ${supportedPairs(chainId).join(" or ")}, with the dollar token second`);
  }
  if (f.widthPct === undefined) {
    if (f.invalid.includes("widthPct")) problems.push("widthPct must be a number, such as 10");
    else missing.push("widthPct");
  } else if (!(f.widthPct > 0 && f.widthPct < 200)) {
    problems.push("widthPct must be above 0 and below 200");
  }
  if (f.invalid.includes("depositUsd") || (f.depositUsd !== undefined && !(f.depositUsd > 0))) {
    problems.push("depositUsd must be a positive number");
  }
  if (
    f.invalid.includes("feeTier") ||
    (f.feeTier !== undefined && !PANCAKE_FEE_TIERS.includes(f.feeTier as (typeof PANCAKE_FEE_TIERS)[number]))
  ) {
    problems.push(`feeTier must be one of ${PANCAKE_FEE_TIERS.join(", ")}`);
  }
  if (missing.length || problems.length || !f.pair || f.widthPct === undefined) {
    return rangeInputRequired(missing, problems);
  }

  const q = await readPancakePrice(chainId, f.pair.base, f.pair.quote, {
    feeTier: f.feeTier,
    reader: opts.reader,
    deadlineMs: opts.deadlineMs,
  });
  if ("error" in q) {
    return rangeInputRequired([], [q.error], "I could not read the PancakeSwap pool, so I have not suggested a range.");
  }

  const range = suggestRange({
    sqrtPriceX96: BigInt(q.sqrtPriceX96),
    tickSpacing: q.tickSpacing,
    decimals0: q.decimals0,
    decimals1: q.decimals1,
    baseIsToken0: q.baseIsToken0,
    widthPct: f.widthPct,
    depositQuote: f.depositUsd,
  });
  const [base, quote] = q.pair.split("/");
  const link = pancakeAddLiquidityUrl({
    chainId,
    base: q.baseAddress,
    quote: q.quoteAddress,
    feeTier: q.feeTier,
    priceLower: range.priceLower,
    priceUpper: range.priceUpper,
  });
  const testnet = chainId === 97 ? ", so the price is a testnet one rather than a market one" : "";
  const deposit = range.deposit
    ? ` A deposit of ${range.deposit.quote} ${quote} splits into ${fmt(range.deposit.baseAmount)} ${base} and ${fmt(range.deposit.quoteAmount)} ${quote} at today's price.`
    : "";
  const text =
    `Suggested PancakeSwap v3 range for ${q.pair}: ${fmt(range.priceLower)} to ${fmt(range.priceUpper)} ${quote} per ${base}, ` +
    `ticks ${range.tickLower} to ${range.tickUpper} on the ${feeTierLabel(q.feeTier)} pool ${q.pool}, whose price is ${fmt(range.priceNow)} ${quote}. ` +
    `I read it at block ${q.blockNumber} on ${chainName(chainId)}${testnet}.${deposit} ` +
    `Open it on PancakeSwap with the range set: ${link} . This is a suggestion; I never add liquidity or trade.`;
  return {
    state: "completed",
    text,
    artifact: {
      capability: BAND_AGENT_CATEGORY,
      action: "suggest_lp_range",
      source: {
        dex: "PancakeSwap v3",
        chainId,
        pair: q.pair,
        pool: q.pool,
        feeTier: q.feeTier,
        tickSpacing: q.tickSpacing,
        tick: q.tick,
        blockNumber: q.blockNumber,
      },
      range: {
        widthPct: f.widthPct,
        tickLower: range.tickLower,
        tickUpper: range.tickUpper,
        priceLower: fmt(range.priceLower, 8),
        priceUpper: fmt(range.priceUpper, 8),
        priceNow: fmt(range.priceNow, 8),
        inRange: range.inRange,
      },
      ...(range.deposit
        ? {
            deposit: {
              quote: range.deposit.quote,
              baseAmount: fmt(range.deposit.baseAmount, 8),
              quoteAmount: fmt(range.deposit.quoteAmount, 8),
              baseShare: fmt(range.deposit.baseShare, 4),
            },
          }
        : {}),
      link,
      assumptions: [
        "The range is centred on the pool price and widened outward to the nearest ticks on the pool's spacing.",
        "The deposit split holds at the price read; it shifts as the price moves inside the range.",
      ],
      readOnly: true,
    },
  };
}
