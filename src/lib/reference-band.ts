// Souk Band Keeper: keeps a two-asset position inside a drift band the caller
// sets. The grid earns inside a range; the band keeper keeps the allocation
// inside the range that range is sized for. Named a PancakeSwap pair, it also
// suggests a v3 liquidity range around that pool's price.

import { privateEndpointReason } from "./endpoint";

export const BAND_AGENT_NAME = "Souk Band Keeper";
export const BAND_AGENT_VERSION = "1.1.0";
export const BAND_AGENT_CATEGORY = "rebalancing";
export const BAND_AGENT_DESCRIPTION =
  "Checks a two-asset position against a drift band around a target weight. From two holding values in USD, the target share of the first asset, and an optional band width, it returns the current weight, the drift, the band edges, whether the weight is inside or outside the band, the distance to the nearest edge, and the USD value to move back to target. That check is deterministic and uses no market data. Named a PancakeSwap pair and a width, it instead reads that pool on the chain this marketplace runs on and suggests a v3 liquidity range: the ticks, the prices at them, how a deposit splits between the two tokens, and a link that opens PancakeSwap with the range set. It never adds liquidity or trades.";
export const BAND_AGENT_PUBLIC_ORIGIN = "https://api.agentsouk.xyz";
export const BAND_AGENT_CARD_PATH = "/api/reference/band/.well-known/agent-card.json";
export const BAND_AGENT_MESSAGING_PATH = "/api/reference/band/a2a";

export const BAND_DEFAULT_WIDTH_PERCENT = 5;
export const BAND_MAX_WIDTH_PERCENT = 100;
export const BAND_FORMULA =
  "driftPercent = (valueAUsd / (valueAUsd + valueBUsd)) * 100 - targetAPercent";

export interface BandAgentSkill {
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

export interface BandAgentCard {
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
  skills: BandAgentSkill[];
  supportedInterfaces: { url: string; transport: string }[];
}

export function bandPickPublicOrigin(candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? "").trim().replace(/\/+$/, "");
    if (trimmed && privateEndpointReason(trimmed) === null) return trimmed;
  }
  return BAND_AGENT_PUBLIC_ORIGIN;
}

export function bandAgentMessagingUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${BAND_AGENT_MESSAGING_PATH}`;
}

export function bandAgentCard(origin: string): BandAgentCard {
  const base = origin.replace(/\/+$/, "");
  const messagingUrl = bandAgentMessagingUrl(base);
  return {
    name: BAND_AGENT_NAME,
    description: BAND_AGENT_DESCRIPTION,
    version: BAND_AGENT_VERSION,
    url: messagingUrl,
    protocolVersion: "0.3.0",
    provider: { organization: "Agent Souk", url: base },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "check_band",
        name: "Drift band check",
        description:
          "Checks a two-asset position against a drift band around a target weight and returns the current weight, the drift, the band edges, the status and the USD value to move back to target. Read-only deterministic arithmetic with no market data.",
        tags: ["rebalancing", "allocation", "band", "drift", "portfolio"],
        examples: [
          "Check a band for valueA 700 and valueB 300 with a target of 50 percent and a band of 5 percent",
          "Is my allocation inside its band or outside it",
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
        inputSchema: {
          type: "object",
          properties: {
            valueAUsd: { type: "number", description: "value of asset A in USD" },
            valueBUsd: { type: "number", description: "value of asset B in USD" },
            targetAPercent: { type: "number", description: "target share of asset A, a percentage from 0 to 100" },
            bandPercent: { type: "number", description: "band half width in percentage points, defaults to 5" },
            symbolA: { type: "string", description: "optional label for asset A" },
            symbolB: { type: "string", description: "optional label for asset B" },
          },
          required: ["valueAUsd", "valueBUsd", "targetAPercent"],
          examples: [{ valueAUsd: 700, valueBUsd: 300, targetAPercent: 50, bandPercent: 5, symbolA: "BNB", symbolB: "USDT" }],
        },
        outputSchema: {
          type: "object",
          properties: {
            totalUsd: { type: "number", description: "portfolio total in USD" },
            currentAPercent: { type: "number", description: "current weight of asset A" },
            driftAPercent: { type: "number", description: "current weight minus the target, in points" },
            bandLowerPercent: { type: "number", description: "lower edge of the band" },
            bandUpperPercent: { type: "number", description: "upper edge of the band" },
            status: { type: "string", description: "in-band, above-band or below-band" },
            distanceToEdgePercent: { type: "number", description: "distance to the nearest band edge" },
            valueToMoveUsd: { type: "number", description: "USD value to move back to target" },
            fromSymbol: { type: "string", description: "asset to move value from" },
            toSymbol: { type: "string", description: "asset to move value to" },
          },
        },
      },
      {
        id: "suggest_lp_range",
        name: "PancakeSwap liquidity range",
        description:
          "Reads a PancakeSwap v3 pool for a pair such as WBNB/USDT and suggests a liquidity range of the width you ask for, centred on the pool's price: the ticks aligned to the pool's spacing, the prices at those ticks, how an optional deposit splits between the two tokens, and a link that opens PancakeSwap's add-liquidity page with the range set. It names the pool and the block it read. It never adds liquidity or trades.",
        tags: ["rebalancing", "pancakeswap", "liquidity", "range", "v3"],
        examples: ["Suggest a PancakeSwap range for WBNB/USDT 10% wide with a deposit of 100"],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
        inputSchema: {
          type: "object",
          properties: {
            pair: { type: "string", description: "a PancakeSwap pair priced in dollars, WBNB/USDT" },
            widthPct: { type: "number", description: "the range width in percent, centred on the pool price" },
            depositUsd: { type: "number", description: "optional deposit in USD to split between the two tokens" },
            feeTier: { type: "number", description: "optional pool fee tier, 100, 500, 2500 or 10000; the deepest pool otherwise" },
          },
          required: ["pair", "widthPct"],
          examples: [{ pair: "WBNB/USDT", widthPct: 10, depositUsd: 100 }],
        },
        outputSchema: {
          type: "object",
          properties: {
            tickLower: { type: "number", description: "lower tick, aligned to the pool's spacing" },
            tickUpper: { type: "number", description: "upper tick, aligned to the pool's spacing" },
            priceLower: { type: "number", description: "quote per base at the lower tick" },
            priceUpper: { type: "number", description: "quote per base at the upper tick" },
            baseAmount: { type: "number", description: "base tokens the deposit takes" },
            quoteAmount: { type: "number", description: "quote tokens the deposit takes" },
            link: { type: "string", description: "PancakeSwap add-liquidity page with the range set" },
          },
        },
      },
    ],
    supportedInterfaces: [{ url: messagingUrl, transport: "JSONRPC" }],
  };
}

export interface BandInput {
  valueAUsd: number;
  valueBUsd: number;
  targetAPercent: number;
  bandPercent: number;
  symbolA: string;
  symbolB: string;
}

export interface BandResult {
  state: "in-band" | "above-band" | "below-band";
  rebalanceWarranted: boolean;
  totalUsd: number;
  currentAPercent: number;
  targetAPercent: number;
  driftAPercent: number;
  bandLowerPercent: number;
  bandUpperPercent: number;
  distanceToEdgePercent: number;
  valueToTargetAUsd: number;
  valueToMoveUsd: number;
  fromSymbol: string;
  toSymbol: string;
  symbolA: string;
  symbolB: string;
}

export interface BandFields {
  valueAUsd?: number;
  valueBUsd?: number;
  targetAPercent?: number;
  bandPercent?: number;
  symbolA?: string;
  symbolB?: string;
}

const ALIASES: Record<string, keyof BandFields> = {
  valueausd: "valueAUsd",
  valuea: "valueAUsd",
  valuebusd: "valueBUsd",
  valueb: "valueBUsd",
  targetapercent: "targetAPercent",
  targeta: "targetAPercent",
  target: "targetAPercent",
  bandpercent: "bandPercent",
  band: "bandPercent",
  width: "bandPercent",
  symbola: "symbolA",
  symbolb: "symbolB",
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

function toSymbol(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function extractBandInput(value: unknown): BandFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const nested = record.input;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : record;
  const out: BandFields = {};
  for (const [key, raw] of Object.entries(source)) {
    const field = ALIASES[key.toLowerCase().replace(/[\s_-]/g, "")];
    if (!field || out[field] !== undefined) continue;
    if (field === "symbolA" || field === "symbolB") {
      const symbol = toSymbol(raw);
      if (symbol) out[field] = symbol;
      continue;
    }
    const parsed = toNumber(raw);
    if (parsed !== undefined) out[field] = parsed;
  }
  return out;
}

const TEXT_NUMBER = "(-?\\d[\\d,]*(?:\\.\\d+)?)";

function labelledNumber(text: string, label: string): number | undefined {
  const match = new RegExp(`${label}[^0-9-]{0,24}${TEXT_NUMBER}`, "i").exec(text);
  return match ? toNumber(match[1]) : undefined;
}

export function mergeBandInput(input: Record<string, unknown> | undefined, task: string): BandFields {
  const fromTask: BandFields = {};
  const a = labelledNumber(task, "valuea(?:\\s+usd)?");
  const b = labelledNumber(task, "valueb(?:\\s+usd)?");
  const target = labelledNumber(task, "target(?:\\s+a)?(?:\\s+percent|\\s+%)?");
  if (a !== undefined) fromTask.valueAUsd = a;
  if (b !== undefined) fromTask.valueBUsd = b;
  if (target !== undefined) fromTask.targetAPercent = target;
  return { ...fromTask, ...extractBandInput(input) };
}

export function keepBand(input: BandInput): BandResult {
  const { valueAUsd, valueBUsd, targetAPercent, bandPercent, symbolA, symbolB } = input;
  const totalUsd = valueAUsd + valueBUsd;
  const currentAPercent = totalUsd > 0 ? (valueAUsd / totalUsd) * 100 : 0;
  const driftAPercent = currentAPercent - targetAPercent;
  const bandLowerPercent = Math.max(0, targetAPercent - bandPercent);
  const bandUpperPercent = Math.min(100, targetAPercent + bandPercent);
  const state: BandResult["state"] =
    currentAPercent > bandUpperPercent
      ? "above-band"
      : currentAPercent < bandLowerPercent
        ? "below-band"
        : "in-band";
  const distanceToEdgePercent =
    state === "in-band"
      ? round(Math.min(bandUpperPercent - currentAPercent, currentAPercent - bandLowerPercent), 2)
      : round(Math.abs(driftAPercent), 2);
  const targetAUsd = (targetAPercent / 100) * totalUsd;
  const valueToTargetAUsd = round(targetAUsd - valueAUsd, 2);
  return {
    state,
    rebalanceWarranted: state !== "in-band",
    totalUsd: round(totalUsd, 2),
    currentAPercent: round(currentAPercent, 2),
    targetAPercent,
    driftAPercent: round(driftAPercent, 2),
    bandLowerPercent: round(bandLowerPercent, 2),
    bandUpperPercent: round(bandUpperPercent, 2),
    distanceToEdgePercent,
    valueToTargetAUsd,
    valueToMoveUsd: Math.abs(valueToTargetAUsd),
    fromSymbol: valueToTargetAUsd < 0 ? symbolA : symbolB,
    toSymbol: valueToTargetAUsd < 0 ? symbolB : symbolA,
    symbolA,
    symbolB,
  };
}

export function answerText(result: BandResult): string {
  const move =
    result.valueToMoveUsd > 0
      ? `A rebalance is warranted: move ${result.valueToMoveUsd} USD from ${result.fromSymbol} into ${result.toSymbol}.`
      : "No rebalance is warranted; the weight is inside the band.";
  return `${result.symbolA} holds ${result.currentAPercent}% of a ${result.totalUsd} USD position, against a target of ${result.targetAPercent}% and a band of ${result.bandLowerPercent}% to ${result.bandUpperPercent}%. Drift is ${result.driftAPercent} points, so the state is ${result.state}, ${result.distanceToEdgePercent} points from the nearest edge. ${move} This is deterministic arithmetic on the values you supplied, with no market data, so you can reproduce every figure.`;
}

export function resultArtifact(result: BandResult): Record<string, unknown> {
  return {
    capability: BAND_AGENT_CATEGORY,
    action: "check_band",
    formula: BAND_FORMULA,
    inputs: {
      valueUnit: "USD",
      symbolA: result.symbolA,
      symbolB: result.symbolB,
    },
    result: {
      state: result.state,
      rebalanceWarranted: result.rebalanceWarranted,
      totalUsd: result.totalUsd,
      currentAPercent: result.currentAPercent,
      targetAPercent: result.targetAPercent,
      driftAPercent: result.driftAPercent,
      bandLowerPercent: result.bandLowerPercent,
      bandUpperPercent: result.bandUpperPercent,
      distanceToEdgePercent: result.distanceToEdgePercent,
      valueToMoveUsd: result.valueToMoveUsd,
      fromSymbol: result.fromSymbol,
      toSymbol: result.toSymbol,
    },
    assumptions: [
      "Holding values are USD amounts supplied by the caller; no market price is read.",
      "The band is a symmetric half width in percentage points around the target weight.",
      "The trade is reported in value terms, never converted to units.",
    ],
    readOnly: true,
  };
}

export interface BandAgentReply {
  state: "completed" | "input-required";
  text: string;
  artifact: Record<string, unknown>;
}

const BAND_INTENT = /band|rebalanc|allocation|drift|weight|target\s+share/i;

export function decideBandTask(task: string, input?: Record<string, unknown>): BandAgentReply {
  const fields = mergeBandInput(input, task);
  const wantsBand =
    BAND_INTENT.test(task) ||
    fields.valueAUsd !== undefined ||
    fields.valueBUsd !== undefined ||
    fields.targetAPercent !== undefined;

  if (!wantsBand) {
    return { state: "completed", text: capabilityText(), artifact: capabilityArtifact() };
  }

  const missing: string[] = [];
  const problems: string[] = [];
  const hasA = fields.valueAUsd !== undefined;
  const hasB = fields.valueBUsd !== undefined;
  if (!hasA) missing.push("valueAUsd");
  if (!hasB) missing.push("valueBUsd");
  if (hasA && hasB && (fields.valueAUsd as number) + (fields.valueBUsd as number) <= 0) {
    problems.push("at least one holding value must be above zero");
  }
  if (fields.valueAUsd !== undefined && (fields.valueAUsd as number) < 0) {
    problems.push("valueAUsd must be zero or greater");
  }
  if (fields.valueBUsd !== undefined && (fields.valueBUsd as number) < 0) {
    problems.push("valueBUsd must be zero or greater");
  }
  if (fields.targetAPercent === undefined) missing.push("targetAPercent");
  else if (!((fields.targetAPercent as number) >= 0 && (fields.targetAPercent as number) <= 100)) {
    problems.push("targetAPercent must be a percentage from 0 to 100");
  }
  if (
    fields.bandPercent !== undefined &&
    !((fields.bandPercent as number) >= 0 && (fields.bandPercent as number) <= BAND_MAX_WIDTH_PERCENT)
  ) {
    problems.push(`bandPercent must be from 0 to ${BAND_MAX_WIDTH_PERCENT}`);
  }

  if (missing.length || problems.length) {
    return {
      state: "input-required",
      text: inputRequiredText(missing, problems),
      artifact: inputRequiredArtifact(fields, missing, problems),
    };
  }

  const result = keepBand({
    valueAUsd: fields.valueAUsd as number,
    valueBUsd: fields.valueBUsd as number,
    targetAPercent: fields.targetAPercent as number,
    bandPercent: fields.bandPercent ?? BAND_DEFAULT_WIDTH_PERCENT,
    symbolA: fields.symbolA ?? "A",
    symbolB: fields.symbolB ?? "B",
  });
  return { state: "completed", text: answerText(result), artifact: resultArtifact(result) };
}

export function capabilityText(): string {
  return `Souk Band Keeper checks a two-asset position against a drift band around a target weight. Send two holding values in USD, the target share of the first asset as a percentage from 0 to 100, and an optional band half width in percentage points. It returns the current weight, the drift, the band edges, whether the weight is inside or outside the band, the distance to the nearest edge, and the USD value to move back to target. The arithmetic is deterministic and uses no market data. Send the values as a data part, for example { kind: "data", data: { input: { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50, bandPercent: 5, symbolA: "BNB", symbolB: "USDT" } } }. Or name a PancakeSwap pair and a width, for example { pair: "WBNB/USDT", widthPct: 10, depositUsd: 100 }, for a suggested v3 liquidity range around that pool's price.`;
}

export function capabilityArtifact(): Record<string, unknown> {
  return {
    capability: BAND_AGENT_CATEGORY,
    action: "check_band",
    status: "ok",
    required: ["valueAUsd", "valueBUsd", "targetAPercent"],
    optional: ["bandPercent", "symbolA", "symbolB"],
    formula: BAND_FORMULA,
    defaults: {
      bandPercent: BAND_DEFAULT_WIDTH_PERCENT,
      maxBandPercent: BAND_MAX_WIDTH_PERCENT,
    },
    example: {
      kind: "data",
      data: {
        input: {
          valueAUsd: 700,
          valueBUsd: 300,
          targetAPercent: 50,
          bandPercent: 5,
          symbolA: "BNB",
          symbolB: "USDT",
        },
      },
    },
    limitations: [
      "The caller supplies the valuations; this agent does not read prices.",
      "The trade is reported in value terms, never in units.",
    ],
  };
}

function inputRequiredText(missing: string[], problems: string[]): string {
  const lines = ["I cannot check a band yet, and I will not guess the missing values."];
  if (missing.length) {
    lines.push(
      `Provide ${missing.join(" and ")}. The drift is the current weight minus the target, so both holding values and the target share are required.`,
    );
  }
  if (problems.length) lines.push(`Fix: ${problems.join("; ")}.`);
  lines.push(
    `Send them as a data part, for example { kind: "data", data: { input: { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50, bandPercent: 5 } } }. Holding values are USD amounts zero or greater, with at least one above zero; the target share is a percentage from 0 to 100; the band half width is an optional percentage from 0 to 100.`,
  );
  return lines.join(" ");
}

function inputRequiredArtifact(
  fields: BandFields,
  missing: string[],
  problems: string[],
): Record<string, unknown> {
  return {
    capability: BAND_AGENT_CATEGORY,
    action: "check_band",
    status: "input-required",
    required: ["valueAUsd", "valueBUsd", "targetAPercent"],
    missing,
    problems,
    received: {
      valueAUsd: fields.valueAUsd ?? null,
      valueBUsd: fields.valueBUsd ?? null,
      targetAPercent: fields.targetAPercent ?? null,
      bandPercent: fields.bandPercent ?? null,
    },
    expected: {
      valueAUsd: "a USD amount zero or greater",
      valueBUsd: "a USD amount zero or greater, at least one above zero",
      targetAPercent: "a percentage from 0 to 100",
      bandPercent: "optional half width in percentage points",
    },
    note: "Nothing is inferred from partial values.",
  };
}
