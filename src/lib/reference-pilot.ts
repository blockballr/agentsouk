// Souk Grid Pilot: replays a grid ladder against a price path the caller
// supplies, so the fills and the net capture are reproducible with no market
// data. The planner says what a grid could earn; this says what a given path
// would actually fill.

import { privateEndpointReason } from "./endpoint";

export const PILOT_AGENT_NAME = "Souk Grid Pilot";
export const PILOT_AGENT_VERSION = "1.0.0";
export const PILOT_AGENT_CATEGORY = "grid-trading";
export const PILOT_AGENT_DESCRIPTION =
  "Replays a grid trading ladder against a price path the caller supplies: a lower price, an upper price, a rung count, a value per rung, an optional fee in basis points, and the path itself. It returns the rung spacing, how many distinct rungs the path touched, the round trips completed, the gross and net capture in USD, and the low and high the path reached. The arithmetic is deterministic and uses no market data, so the caller supplies the path and can reproduce every figure.";
export const PILOT_AGENT_PUBLIC_ORIGIN = "https://api.agentsouk.xyz";
export const PILOT_AGENT_CARD_PATH = "/api/reference/pilot/.well-known/agent-card.json";
export const PILOT_AGENT_MESSAGING_PATH = "/api/reference/pilot/a2a";

export const PILOT_DEFAULT_FEE_BPS = 10;
export const PILOT_MIN_LEVELS = 2;
export const PILOT_MAX_LEVELS = 200;
export const PILOT_MAX_FEE_BPS = 10000;
export const PILOT_MAX_PRICES = 500;

export const PILOT_FORMULA =
  "netCaptureUsd = roundTrips * rungGainUsd - roundTrips * orderSizeUsd * feeBps / 10000";

export interface PilotAgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  inputModes: string[];
  outputModes: string[];
  inputSchema?: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
    examples?: Record<string, unknown>[];
  };
  outputSchema?: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
  };
}

export interface PilotAgentCard {
  name: string;
  description: string;
  version: string;
  url: string;
  protocolVersion: string;
  provider: { organization: string; url: string };
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: PilotAgentSkill[];
  supportedInterfaces: { url: string; transport: string }[];
}

// The card must never name a private or loopback address, so a configured origin
// is used only when it passes the marketplace's own check; otherwise the
// deployed api origin wins.
export function pilotPickPublicOrigin(candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? "").trim().replace(/\/+$/, "");
    if (trimmed && privateEndpointReason(trimmed) === null) return trimmed;
  }
  return PILOT_AGENT_PUBLIC_ORIGIN;
}

export function pilotAgentMessagingUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${PILOT_AGENT_MESSAGING_PATH}`;
}

export function pilotAgentCard(origin: string): PilotAgentCard {
  const base = origin.replace(/\/+$/, "");
  const messagingUrl = pilotAgentMessagingUrl(base);
  return {
    name: PILOT_AGENT_NAME,
    description: PILOT_AGENT_DESCRIPTION,
    version: PILOT_AGENT_VERSION,
    url: messagingUrl,
    protocolVersion: "0.3.0",
    provider: { organization: "Agent Souk", url: base },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "replay_grid",
        name: "Grid fill simulation",
        description:
          "Replays a grid ladder against a price path and reports the round trips, the gross and net capture in USD, and the extremes the path reached. Read-only deterministic arithmetic with no market data.",
        tags: ["grid-trading", "grid", "backtest", "simulation", "fills"],
        examples: [
          "Replay a grid from 1000 to 2000 with 11 levels and 100 per order over prices 1500 1300 1100 1400 1700",
          "How many round trips does a grid fill over a given price path",
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
        inputSchema: {
          type: "object",
          properties: {
            lowerUsd: { type: "number", description: "lower price of the range in USD" },
            upperUsd: { type: "number", description: "upper price of the range in USD" },
            levels: { type: "number", description: "number of price rungs, 2 to 200" },
            orderSizeUsd: { type: "number", description: "value placed at each rung in USD" },
            feeBps: { type: "number", description: "optional round trip fee in basis points, defaults to 10" },
            prices: { type: "array", description: "the price path to replay, oldest first" },
          },
          required: ["lowerUsd", "upperUsd", "levels", "orderSizeUsd", "prices"],
          examples: [
            { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100, feeBps: 10, prices: [1500, 1300, 1100, 1400, 1700] },
          ],
        },
        outputSchema: {
          type: "object",
          properties: {
            spacingUsd: { type: "number", description: "spacing between rungs in USD" },
            rungsTouched: { type: "number", description: "distinct rungs the path reached" },
            roundTrips: { type: "number", description: "buy and sell pairs one rung apart" },
            grossCaptureUsd: { type: "number", description: "capture before the fee" },
            feeCostUsd: { type: "number", description: "round trip cost applied to each trip" },
            netCaptureUsd: { type: "number", description: "capture after the fee" },
            lowReachedUsd: { type: "number", description: "lowest price in the path" },
            highReachedUsd: { type: "number", description: "highest price in the path" },
          },
        },
      },
    ],
    supportedInterfaces: [{ url: messagingUrl, transport: "JSONRPC" }],
  };
}

export interface PilotInput {
  lowerUsd: number;
  upperUsd: number;
  levels: number;
  orderSizeUsd: number;
  feeBps: number;
  prices: number[];
}

export interface PilotResult {
  lowerUsd: number;
  upperUsd: number;
  levels: number;
  orderSizeUsd: number;
  feeBps: number;
  prices: number[];
  spacingUsd: number;
  rungsTouched: number;
  roundTrips: number;
  grossCaptureUsd: number;
  feeCostUsd: number;
  netCaptureUsd: number;
  lowReachedUsd: number;
  highReachedUsd: number;
}

export interface PilotFields {
  lowerUsd?: number;
  upperUsd?: number;
  levels?: number;
  orderSizeUsd?: number;
  feeBps?: number;
  prices?: number[];
}

const ALIASES: Record<string, keyof PilotFields> = {
  lowerusd: "lowerUsd",
  lower: "lowerUsd",
  upperusd: "upperUsd",
  upper: "upperUsd",
  levels: "levels",
  rungs: "levels",
  ordersizeusd: "orderSizeUsd",
  ordersize: "orderSizeUsd",
  feebps: "feeBps",
  fee: "feeBps",
  prices: "prices",
  path: "prices",
};

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toPrices(value: unknown): number[] | undefined {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/).filter(Boolean)
      : undefined;
  if (!list) return undefined;
  const nums = list.map(toNumber).filter((n): n is number => n !== undefined);
  return nums.length ? nums : undefined;
}

export function extractPilotInput(value: unknown): PilotFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const nested = record.input;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : record;
  const out: PilotFields = {};
  for (const [key, raw] of Object.entries(source)) {
    const field = ALIASES[key.toLowerCase().replace(/[\s_-]/g, "")];
    if (!field || out[field] !== undefined) continue;
    if (field === "prices") {
      const prices = toPrices(raw);
      if (prices) out.prices = prices;
      continue;
    }
    const parsed = toNumber(raw);
    if (parsed !== undefined) out[field] = parsed;
  }
  return out;
}

export function mergePilotInput(input: Record<string, unknown> | undefined, task: string): PilotFields {
  const fromTask: PilotFields = {};
  const lower = /lower[^0-9-]{0,16}(-?\d[\d,]*(?:\.\d+)?)/i.exec(task);
  const upper = /upper[^0-9-]{0,16}(-?\d[\d,]*(?:\.\d+)?)/i.exec(task);
  const levels = /(?:levels?|rungs?)[^0-9-]{0,16}(\d+)/i.exec(task);
  if (lower) fromTask.lowerUsd = toNumber(lower[1]);
  if (upper) fromTask.upperUsd = toNumber(upper[1]);
  if (levels) fromTask.levels = toNumber(levels[1]);
  return { ...fromTask, ...extractPilotInput(input) };
}

// Walk the path rung by rung: a fall fills the rungs it crossed, a rise sells the
// held rungs below it, and a held rung sold one rung higher is one round trip.
export function simulateGrid(input: PilotInput): PilotResult {
  const { lowerUsd, upperUsd, levels, orderSizeUsd, feeBps, prices } = input;
  const spacingUsd = (upperUsd - lowerUsd) / (levels - 1);
  const rungIndex = (p: number) =>
    Math.max(0, Math.min(levels - 1, Math.round((p - lowerUsd) / spacingUsd)));

  const held = new Set<number>();
  const touched = new Set<number>();
  let roundTrips = 0;
  let prev = rungIndex(prices[0]);
  let low = prices[0];
  let high = prices[0];
  touched.add(prev);

  for (let k = 1; k < prices.length; k++) {
    const price = prices[k];
    low = Math.min(low, price);
    high = Math.max(high, price);
    const idx = rungIndex(price);
    touched.add(idx);
    if (idx < prev) {
      for (let i = idx; i < prev; i++) held.add(i);
    } else if (idx > prev) {
      for (let i = prev; i < idx; i++) {
        if (held.has(i)) {
          held.delete(i);
          roundTrips += 1;
        }
      }
    }
    prev = idx;
  }

  const rungGainUsd = orderSizeUsd * (spacingUsd / lowerUsd);
  const grossCaptureUsd = round(roundTrips * rungGainUsd, 2);
  const feeCostUsd = round(roundTrips * orderSizeUsd * (feeBps / 10000), 2);
  return {
    ...input,
    spacingUsd: round(spacingUsd, 2),
    rungsTouched: touched.size,
    roundTrips,
    grossCaptureUsd,
    feeCostUsd,
    netCaptureUsd: round(grossCaptureUsd - feeCostUsd, 2),
    lowReachedUsd: round(low, 2),
    highReachedUsd: round(high, 2),
  };
}

function stateLabel(result: PilotResult): string {
  if (result.roundTrips === 0) return "no-fill, the path stayed inside one rung";
  return result.netCaptureUsd > 0
    ? "net-positive, the captured round trips beat the fee"
    : "fee-bound, the round trip fee consumed the capture";
}

export function answerText(result: PilotResult): string {
  return `Replayed a grid from ${result.lowerUsd} to ${result.upperUsd} across ${result.levels} rungs, spacing ${result.spacingUsd} USD, over ${result.lowReachedUsd} to ${result.highReachedUsd} USD. The path touched ${result.rungsTouched} rungs and completed ${result.roundTrips} round trips. Gross capture ${result.grossCaptureUsd} USD, the round trip fee is ${result.feeCostUsd} USD, and the net capture is ${result.netCaptureUsd} USD. State: ${stateLabel(result)}. This is deterministic arithmetic on the path you supplied, with no market data, so you can reproduce every figure.`;
}

export function resultArtifact(result: PilotResult): Record<string, unknown> {
  return {
    capability: PILOT_AGENT_CATEGORY,
    action: "replay_grid",
    formula: PILOT_FORMULA,
    inputs: {
      lowerUsd: result.lowerUsd,
      upperUsd: result.upperUsd,
      levels: result.levels,
      orderSizeUsd: result.orderSizeUsd,
      feeBps: result.feeBps,
      priceCount: result.prices.length,
      priceUnit: "USD",
    },
    result: {
      spacingUsd: result.spacingUsd,
      rungsTouched: result.rungsTouched,
      roundTrips: result.roundTrips,
      grossCaptureUsd: result.grossCaptureUsd,
      feeCostUsd: result.feeCostUsd,
      netCaptureUsd: result.netCaptureUsd,
      lowReachedUsd: result.lowReachedUsd,
      highReachedUsd: result.highReachedUsd,
    },
    assumptions: [
      "The range and the path are supplied by the caller; no market data is fetched.",
      "One round trip fills a rung on the way down and sells it one rung higher on the way up.",
      "The fee in basis points is applied to the order size on each completed round trip.",
    ],
    readOnly: true,
  };
}

export interface PilotAgentReply {
  state: "completed" | "input-required";
  text: string;
  artifact: Record<string, unknown>;
}

const GRID_INTENT =
  /grid|replay|backtest|round ?trip|price path|simulat|ladder|rung/i;

export function decidePilotTask(task: string, input?: Record<string, unknown>): PilotAgentReply {
  const fields = mergePilotInput(input, task);
  const wantsGrid =
    GRID_INTENT.test(task) ||
    fields.lowerUsd !== undefined ||
    fields.upperUsd !== undefined ||
    fields.prices !== undefined;

  if (!wantsGrid) {
    return { state: "completed", text: capabilityText(), artifact: capabilityArtifact() };
  }

  const missing: string[] = [];
  const problems: string[] = [];
  if (fields.lowerUsd === undefined) missing.push("lowerUsd");
  else if (!(fields.lowerUsd > 0)) problems.push("lowerUsd must be a positive number");
  if (fields.upperUsd === undefined) missing.push("upperUsd");
  else if (!(fields.upperUsd > (fields.lowerUsd ?? Infinity))) {
    problems.push("upperUsd must be greater than lowerUsd");
  }
  if (fields.levels === undefined) missing.push("levels");
  else if (!(fields.levels >= PILOT_MIN_LEVELS && fields.levels <= PILOT_MAX_LEVELS)) {
    problems.push(`levels must be an integer from ${PILOT_MIN_LEVELS} to ${PILOT_MAX_LEVELS}`);
  }
  if (fields.orderSizeUsd === undefined) missing.push("orderSizeUsd");
  else if (!(fields.orderSizeUsd > 0)) problems.push("orderSizeUsd must be a positive number");
  if (!fields.prices || fields.prices.length === 0) missing.push("prices");
  else if (fields.prices.some((p) => !(p > 0))) problems.push("every price must be a positive number");
  else if (fields.prices.length > PILOT_MAX_PRICES) {
    problems.push(`prices is capped at ${PILOT_MAX_PRICES} points`);
  }
  if (
    fields.feeBps !== undefined &&
    !(fields.feeBps >= 0 && fields.feeBps <= PILOT_MAX_FEE_BPS)
  ) {
    problems.push(`feeBps must be from 0 to ${PILOT_MAX_FEE_BPS}`);
  }

  if (missing.length || problems.length) {
    return {
      state: "input-required",
      text: inputRequiredText(missing, problems),
      artifact: inputRequiredArtifact(fields, missing, problems),
    };
  }

  const result = simulateGrid({
    lowerUsd: fields.lowerUsd as number,
    upperUsd: fields.upperUsd as number,
    levels: Math.round(fields.levels as number),
    orderSizeUsd: fields.orderSizeUsd as number,
    feeBps: fields.feeBps ?? PILOT_DEFAULT_FEE_BPS,
    prices: fields.prices as number[],
  });
  return { state: "completed", text: answerText(result), artifact: resultArtifact(result) };
}

export function capabilityText(): string {
  return `Souk Grid Pilot replays a grid ladder against a price path you supply: a lower price, an upper price, a rung count, a value per rung in USD, an optional round trip fee in basis points, and the path itself. It returns the rung spacing, how many rungs the path touched, the round trips completed, the gross, fee and net capture, and the low and high the path reached. The arithmetic is deterministic and uses no market data, so you can reproduce every figure. Send the values as a data part, for example { kind: "data", data: { input: { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100, feeBps: 10, prices: [1500, 1300, 1100, 1400, 1700] } } }.`;
}

export function capabilityArtifact(): Record<string, unknown> {
  return {
    capability: PILOT_AGENT_CATEGORY,
    action: "replay_grid",
    status: "ok",
    required: ["lowerUsd", "upperUsd", "levels", "orderSizeUsd", "prices"],
    optional: ["feeBps"],
    formula: PILOT_FORMULA,
    defaults: {
      feeBps: PILOT_DEFAULT_FEE_BPS,
      minLevels: PILOT_MIN_LEVELS,
      maxLevels: PILOT_MAX_LEVELS,
      maxFeeBps: PILOT_MAX_FEE_BPS,
      maxPrices: PILOT_MAX_PRICES,
    },
    example: {
      kind: "data",
      data: {
        input: {
          lowerUsd: 1000,
          upperUsd: 2000,
          levels: 11,
          orderSizeUsd: 100,
          feeBps: 10,
          prices: [1500, 1300, 1100, 1400, 1700],
        },
      },
    },
    limitations: [
      "The caller supplies the path; this agent does not read market prices.",
      "The result is a read-only replay and never a transaction.",
    ],
  };
}

function inputRequiredText(missing: string[], problems: string[]): string {
  const lines = ["I cannot replay a grid yet, and I will not guess the missing values."];
  if (missing.length) {
    lines.push(
      `Provide ${missing.join(", ")}. A replay needs a lower price, an upper price, a rung count, an order size, and the price path to walk.`,
    );
  }
  if (problems.length) lines.push(`Fix: ${problems.join("; ")}.`);
  lines.push(
    `Send them as a data part, for example { kind: "data", data: { input: { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100, feeBps: 10, prices: [1500, 1300, 1100, 1400, 1700] } } }. Prices and the order size are positive numbers; levels is an integer from 2 to 200; feeBps is an optional integer from 0 to 10000; prices is the path, oldest first.`,
  );
  return lines.join(" ");
}

function inputRequiredArtifact(
  fields: PilotFields,
  missing: string[],
  problems: string[],
): Record<string, unknown> {
  return {
    capability: PILOT_AGENT_CATEGORY,
    action: "replay_grid",
    status: "input-required",
    required: ["lowerUsd", "upperUsd", "levels", "orderSizeUsd", "prices"],
    missing,
    problems,
    received: {
      lowerUsd: fields.lowerUsd ?? null,
      upperUsd: fields.upperUsd ?? null,
      levels: fields.levels ?? null,
      orderSizeUsd: fields.orderSizeUsd ?? null,
      feeBps: fields.feeBps ?? null,
      priceCount: fields.prices?.length ?? 0,
    },
    expected: {
      lowerUsd: "a positive USD price",
      upperUsd: "a positive USD price above the lower",
      levels: "an integer from 2 to 200",
      orderSizeUsd: "a positive USD value",
      feeBps: "optional integer from 0 to 10000, defaults to 10",
      prices: "the price path, oldest first, up to 500 points",
    },
    note: "Nothing is inferred from partial values.",
  };
}
