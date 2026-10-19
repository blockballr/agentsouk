import "server-only";

import { PANCAKE_FEE_TIERS, isUsdQuote, supportedPairs } from "./pancake";
import { readPancakePrice, type PoolReader } from "./pancake-read";
import {
  GRID_AGENT_CATEGORY,
  MAX_FEE_BPS,
  MAX_LEVELS,
  MIN_LEVELS,
  decideGridAgentTask,
  extractGridInput,
  hasGridIntent,
  mergeGridInput,
  type GridAgentReply,
  type GridPriceSource,
} from "./reference-grid";
import { targetChainId } from "./types";

// optional AI layer: a short analysis from Gemini, appended to the deterministic
// plan. the deterministic numbers are always the source of truth; if this call
// fails or times out the plan is still returned unchanged, so deterministic is
// the fallback and nothing is invented.
const LLM_API_KEY = process.env.LLM_EVAL_API_KEY ?? "";
const LLM_BASE_URL = process.env.LLM_EVAL_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai";
const LLM_MODEL = process.env.LLM_EVAL_MODEL ?? "gemini-2.5-flash";

async function aiGridCommentary(task: string, planText: string): Promise<string | null> {
  if (!LLM_API_KEY) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a grid trading analyst. Given a grid plan's numbers, write 2-3 sentences of plain prose: " +
              "whether the spacing and capture look reasonable, one caveat, and what a trader should watch. " +
              "Never invent numbers not in the plan. No markdown, no lists.",
          },
          { role: "user", content: `Task: ${task}\n\nPlan:\n${planText}` },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// the grid agent's PancakeSwap mode: a named pair and a width stand in for the two
// prices, read from the pool at one block; everything else is the ordinary planner

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// the caller's own fields, minus empty ones, so a null never overwrites a computed bound
function callerFields(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const nested = input?.input;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : (input ?? {});
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}

function liveInputRequired(missing: string[], problems: string[], why?: string): GridAgentReply {
  const lines = [why ?? "I cannot plan around the PancakeSwap price yet, and I will not guess the missing values."];
  if (missing.length) lines.push(`Provide ${missing.join(" and ")}.`);
  if (problems.length) lines.push(`Fix: ${problems.join("; ")}.`);
  lines.push(
    'Send a pair, a width, a rung count and an order size, for example { pair: "WBNB/USDT", widthPct: 10, levels: 11, orderSizeUsd: 100 }, or send lowerUsd and upperUsd instead of the pair and the width.',
  );
  return {
    state: "input-required",
    text: lines.join(" "),
    artifact: {
      capability: GRID_AGENT_CATEGORY,
      action: "plan_grid",
      status: "input-required",
      mode: "pancakeswap",
      missing,
      problems,
      example: { kind: "data", data: { input: { pair: "WBNB/USDT", widthPct: 10, levels: 11, orderSizeUsd: 100 } } },
      note: "Nothing is inferred from partial values.",
    },
  };
}

export async function decideGridAgentTaskLive(
  task: string,
  input?: Record<string, unknown>,
  opts: { chainId?: number; reader?: PoolReader; deadlineMs?: number } = {},
): Promise<GridAgentReply> {
  const fields = mergeGridInput(input, task);
  const structured = extractGridInput(input);
  const rangeGiven =
    fields.lowerUsd !== undefined ||
    fields.upperUsd !== undefined ||
    fields.invalid.includes("lowerUsd") ||
    fields.invalid.includes("upperUsd");
  // a pair sent as data asks for this mode; one mentioned in prose does only beside a grid or a width
  const pairAsked =
    structured.pair !== undefined ||
    structured.invalid.includes("pair") ||
    (fields.pair !== undefined && (hasGridIntent(task) || fields.widthPct !== undefined));
  if (!pairAsked) {
    const reply = decideGridAgentTask(task, input);
    const ai = await aiGridCommentary(task, reply.text);
    if (ai) return { ...reply, text: `${reply.text}\n\n${ai}` };
    return reply;
  }
  if (rangeGiven) {
    const reply = decideGridAgentTask(task, input);
    if (structured.pair === undefined && !structured.invalid.includes("pair")) return reply;
    // the caller's own range wins, but a pair sent as data is answered rather than dropped
    const note = "The pair was not read on PancakeSwap, because lowerUsd and upperUsd already set the range.";
    return { ...reply, text: `${reply.text} ${note}`, artifact: { ...reply.artifact, pairNote: note } };
  }

  // the pool on the chain this marketplace settles on, so a testnet market reads a testnet pool
  const chainId = opts.chainId ?? targetChainId();
  const pairs = supportedPairs(chainId).join(" or ");
  const missing: string[] = [];
  const problems: string[] = [];
  // every check runs before the chain is read, so a malformed request costs no RPC call
  if (!fields.pair || !isUsdQuote(fields.pair.quote)) {
    problems.push(`pair must be ${pairs}, with the dollar token second`);
  }
  const width = fields.widthPct;
  if (width === undefined) {
    if (fields.invalid.includes("widthPct")) problems.push("widthPct must be a number, such as 10");
    else missing.push("widthPct");
  } else if (!(width > 0 && width < 200)) {
    problems.push("widthPct must be above 0 and below 200");
  }
  if (fields.invalid.includes("feeTier")) problems.push(`feeTier must be one of ${PANCAKE_FEE_TIERS.join(", ")}`);
  else if (fields.feeTier !== undefined && !PANCAKE_FEE_TIERS.includes(fields.feeTier as (typeof PANCAKE_FEE_TIERS)[number])) {
    problems.push(`feeTier must be one of ${PANCAKE_FEE_TIERS.join(", ")}`);
  }
  if (fields.levels === undefined) {
    if (fields.invalid.includes("levels")) problems.push(`levels must be an integer from ${MIN_LEVELS} to ${MAX_LEVELS}`);
    else missing.push("levels");
  } else if (!Number.isInteger(fields.levels) || fields.levels < MIN_LEVELS || fields.levels > MAX_LEVELS) {
    problems.push(`levels must be an integer from ${MIN_LEVELS} to ${MAX_LEVELS}`);
  }
  if (fields.orderSizeUsd === undefined) {
    if (fields.invalid.includes("orderSizeUsd")) problems.push("orderSizeUsd must be a positive number");
    else missing.push("orderSizeUsd");
  } else if (!(fields.orderSizeUsd > 0)) {
    problems.push("orderSizeUsd must be a positive number");
  }
  if (
    fields.invalid.includes("feeBps") ||
    (fields.feeBps !== undefined && (!Number.isInteger(fields.feeBps) || fields.feeBps < 0 || fields.feeBps > MAX_FEE_BPS))
  ) {
    problems.push(`feeBps must be an integer from 0 to ${MAX_FEE_BPS}`);
  }
  if (missing.length || problems.length || !fields.pair || width === undefined) {
    return liveInputRequired(missing, problems);
  }

  const quote = await readPancakePrice(chainId, fields.pair.base, fields.pair.quote, {
    feeTier: fields.feeTier,
    reader: opts.reader,
    deadlineMs: opts.deadlineMs,
  });
  if ("error" in quote) {
    return liveInputRequired([], [quote.error], "I could not read the PancakeSwap price, so I have not planned anything.");
  }

  const price = round(quote.price);
  const feeFromPool = fields.feeBps === undefined;
  const source: GridPriceSource = {
    dex: "PancakeSwap v3",
    chainId: quote.chainId,
    pair: quote.pair,
    pool: quote.pool,
    feeTier: quote.feeTier,
    tick: quote.tick,
    price,
    blockNumber: quote.blockNumber,
    widthPct: width,
    feeFromPool,
  };
  // the pool's own round trip is two swaps at its fee tier; a tier of 500 is 5 bps a swap
  const feeBps = fields.feeBps ?? (2 * quote.feeTier) / 100;
  const reply = decideGridAgentTask(
    task,
    {
      ...callerFields(input),
      lowerUsd: round(price * (1 - width / 200)),
      upperUsd: round(price * (1 + width / 200)),
      feeBps,
    },
    source,
  );
  const ai = await aiGridCommentary(task, reply.text);
  if (ai) return { ...reply, text: `${reply.text}\n\n${ai}` };
  return reply;
}
