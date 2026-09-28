// The first party grid-trading reference agent: a real endpoint Agent Souk can
// list through its own wizard. It plans a grid ladder from caller-supplied
// prices and sizes, so every figure is deterministic and reproducible. It reads
// no market prices and invents none; when a required value is absent it asks for
// it rather than guessing.

import { privateEndpointReason } from "./endpoint";

export const GRID_AGENT_NAME = "Souk Grid Planner";
export const GRID_AGENT_VERSION = "1.0.0";
export const GRID_AGENT_CATEGORY = "grid-trading";
export const GRID_AGENT_PROTOCOL_VERSION = "0.3.0";
export const GRID_AGENT_DESCRIPTION =
  "Plans a grid trading ladder over a price range the caller supplies: a lower price, an upper price, the number of price rungs, the value placed at each rung, and an optional round trip fee in basis points. It returns the rung spacing, the first and last rung prices, the value committed across the ladder, the gross, fee and net capture of one completed round trip, and the total net capture if price traverses the whole range once and every rung fills. The arithmetic is deterministic and uses no market data, so the caller supplies the range and the size and can reproduce every figure.";
export const GRID_AGENT_PUBLIC_ORIGIN = "https://api.agentsouk.xyz";
export const GRID_AGENT_CARD_PATH = "/api/reference/grid/.well-known/agent-card.json";
export const GRID_AGENT_MESSAGING_PATH = "/api/reference/grid/a2a";

export const DEFAULT_FEE_BPS = 0;
export const MIN_LEVELS = 2;
export const MAX_LEVELS = 200;
export const MAX_FEE_BPS = 10000;

export const GRID_FORMULA =
  "spacingUsd = (upperUsd - lowerUsd) / (levels - 1); quantityAtFirstRung = orderSizeUsd / lowerUsd; grossCaptureUsd = spacingUsd * quantityAtFirstRung; feeCostUsd = orderSizeUsd * feeBps / 10000; netCaptureUsd = grossCaptureUsd - feeCostUsd; totalNetCaptureUsd = netCaptureUsd * (levels - 1)";

export interface GridAgentSkill {
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

export interface GridAgentCard {
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
  skills: GridAgentSkill[];
  supportedInterfaces: { url: string; transport: string }[];
}

// The card must never name a private or loopback address, so a configured
// origin is used only when it passes the marketplace's own check; otherwise the
// deployed api origin wins.
export function pickGridOrigin(candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? "").trim().replace(/\/+$/, "");
    if (trimmed && privateEndpointReason(trimmed) === null) return trimmed;
  }
  return GRID_AGENT_PUBLIC_ORIGIN;
}

export function gridAgentMessagingUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${GRID_AGENT_MESSAGING_PATH}`;
}

export function gridAgentCard(origin: string): GridAgentCard {
  const base = origin.replace(/\/+$/, "");
  const messagingUrl = gridAgentMessagingUrl(base);
  return {
    name: GRID_AGENT_NAME,
    description: GRID_AGENT_DESCRIPTION,
    version: GRID_AGENT_VERSION,
    url: messagingUrl,
    protocolVersion: GRID_AGENT_PROTOCOL_VERSION,
    provider: { organization: "Agent Souk", url: base },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "plan_grid",
        name: "Grid ladder planning",
        description:
          "Plans a grid trading ladder from a lower price, an upper price, a rung count and a value per rung, with an optional round trip fee in basis points. Returns the rung spacing, the first and last rung prices, the value committed, the gross, fee and net capture of one round trip, and the total net capture across a full traversal. Read-only deterministic arithmetic with no market data.",
        tags: ["grid-trading", "grid", "trading", "ladder", "range", "orders"],
        examples: [
          "Plan a grid from lower 1000 to upper 2000 with 11 levels and 100 per order",
          "What spacing and net capture does a grid trading ladder have",
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
          },
          required: ["lowerUsd", "upperUsd", "levels", "orderSizeUsd"],
          examples: [{ lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100, feeBps: 10 }],
        },
        outputSchema: {
          type: "object",
          properties: {
            spacingUsd: { type: "number", description: "spacing between rungs in USD" },
            firstRungUsd: { type: "number", description: "price of the first rung" },
            lastRungUsd: { type: "number", description: "price of the last rung" },
            committedUsd: { type: "number", description: "value committed across the ladder" },
            netCaptureUsd: { type: "number", description: "net capture of one completed round trip" },
            totalNetCaptureUsd: { type: "number", description: "total net capture across a full traversal" },
          },
        },
      },
    ],
    supportedInterfaces: [{ url: messagingUrl, transport: "JSONRPC" }],
  };
}

export interface GridPlanInput {
  lowerUsd: number;
  upperUsd: number;
  levels: number;
  orderSizeUsd: number;
  feeBps: number;
}

export type GridPlanState = "planned" | "fee-dominated";

export interface GridPlanResult {
  lowerUsd: number;
  upperUsd: number;
  levels: number;
  orderSizeUsd: number;
  feeBps: number;
  spacingUsd: number;
  firstRungUsd: number;
  lastRungUsd: number;
  rungCount: number;
  committedUsd: number;
  quantityAtFirstRung: number;
  grossCaptureUsd: number;
  feeCostUsd: number;
  netCaptureUsd: number;
  roundTripsInFullTraversal: number;
  totalNetCaptureUsd: number;
  state: GridPlanState;
}

export interface GridInputFields {
  lowerUsd?: number;
  upperUsd?: number;
  levels?: number;
  orderSizeUsd?: number;
  feeBps?: number;
  // names of fields that were present but whose value could not be parsed
  invalid: string[];
}

type GridNumericField = "lowerUsd" | "upperUsd" | "levels" | "orderSizeUsd" | "feeBps";

const INPUT_ALIASES: Record<string, GridNumericField> = {
  lower: "lowerUsd",
  lowerusd: "lowerUsd",
  lowerprice: "lowerUsd",
  lowerpriceusd: "lowerUsd",
  low: "lowerUsd",
  min: "lowerUsd",
  minprice: "lowerUsd",
  lowerbound: "lowerUsd",
  from: "lowerUsd",
  upper: "upperUsd",
  upperusd: "upperUsd",
  upperprice: "upperUsd",
  upperpriceusd: "upperUsd",
  high: "upperUsd",
  max: "upperUsd",
  maxprice: "upperUsd",
  upperbound: "upperUsd",
  to: "upperUsd",
  levels: "levels",
  level: "levels",
  gridlevels: "levels",
  rungcount: "levels",
  rungs: "levels",
  grids: "levels",
  ordersizeusd: "orderSizeUsd",
  ordersize: "orderSizeUsd",
  orderamountusd: "orderSizeUsd",
  orderamount: "orderSizeUsd",
  orderusd: "orderSizeUsd",
  ordervalueusd: "orderSizeUsd",
  sizeusd: "orderSizeUsd",
  size: "orderSizeUsd",
  perorderusd: "orderSizeUsd",
  fee: "feeBps",
  fees: "feeBps",
  feebps: "feeBps",
  feebp: "feeBps",
  feetbps: "feeBps",
  roundtripfeebps: "feeBps",
};

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function extractGridInput(value: unknown): GridInputFields {
  const out: GridInputFields = { invalid: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  // the marketplace client sends { kind: "data", data: { input: {...} } }, so
  // an "input" wrapper is unwrapped; a bare data object is read directly
  const nested = record.input;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : record;

  for (const [key, raw] of Object.entries(source)) {
    const field = INPUT_ALIASES[key.toLowerCase().replace(/[\s_-]/g, "")];
    if (!field || out[field] !== undefined) continue;
    const parsed = toNumber(raw);
    if (parsed !== undefined) out[field] = parsed;
    else if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      out.invalid.push(field);
    }
  }
  return out;
}

const TEXT_NUMBER = "(-?\\d[\\d,]*(?:\\.\\d+)?)";

function labelledNumber(text: string, label: string, gap = 8): number | undefined {
  const match = new RegExp(`(?:${label})[^0-9-]{0,${gap}}${TEXT_NUMBER}`, "i").exec(text);
  return match ? toNumber(match[1]) : undefined;
}

// A plain text request can carry labelled values too, for example
// "lower 1000 upper 2000 levels 11 order size 100". Only explicitly labelled
// numbers are read, so an unlabelled figure is never treated as an input.
export function parseGridText(task: string): GridInputFields {
  const out: GridInputFields = { invalid: [] };
  const lower = labelledNumber(task, "lower(?:\\s*usd|\\s*price|\\s*bound)?");
  if (lower !== undefined) out.lowerUsd = lower;
  const upper = labelledNumber(task, "upper(?:\\s*usd|\\s*price|\\s*bound)?");
  if (upper !== undefined) out.upperUsd = upper;
  const levels = labelledNumber(task, "levels?|rungs?|rung\\s*count");
  if (levels !== undefined) out.levels = levels;
  const orderSize = labelledNumber(task, "order\\s*size|order\\s*amount|per\\s*order|size");
  if (orderSize !== undefined) out.orderSizeUsd = orderSize;
  const feeBps = labelledNumber(task, "fee\\s*bps|fee\\s*in\\s*bps|round\\s*trip\\s*fee|fees?");
  if (feeBps !== undefined) out.feeBps = feeBps;
  return out;
}

export function mergeGridInput(
  input: Record<string, unknown> | undefined,
  task: string,
): GridInputFields {
  const fromText = parseGridText(task);
  const fromInput = extractGridInput(input);
  // structured input wins over text when both name the same field
  const merged: GridInputFields = { ...fromText, ...fromInput };
  merged.invalid = [...fromText.invalid, ...fromInput.invalid];
  return merged;
}

export function planGrid(input: GridPlanInput): GridPlanResult {
  const { lowerUsd, upperUsd, levels, orderSizeUsd, feeBps } = input;
  const spacingUsd = round((upperUsd - lowerUsd) / (levels - 1));
  const quantityAtFirstRung = orderSizeUsd / lowerUsd;
  const grossCaptureUsd = round(spacingUsd * quantityAtFirstRung);
  const feeCostUsd = round(orderSizeUsd * (feeBps / MAX_FEE_BPS));
  const netCaptureUsd = round(grossCaptureUsd - feeCostUsd);
  const roundTripsInFullTraversal = levels - 1;
  const totalNetCaptureUsd = round(netCaptureUsd * roundTripsInFullTraversal);
  const state: GridPlanState = netCaptureUsd > 0 ? "planned" : "fee-dominated";

  return {
    ...input,
    spacingUsd,
    firstRungUsd: round(lowerUsd),
    lastRungUsd: round(upperUsd),
    rungCount: levels,
    committedUsd: round(orderSizeUsd * levels, 2),
    quantityAtFirstRung: round(quantityAtFirstRung, 8),
    grossCaptureUsd,
    feeCostUsd,
    netCaptureUsd,
    roundTripsInFullTraversal,
    totalNetCaptureUsd,
    state,
  };
}

function stateLabel(state: GridPlanState): string {
  return state === "planned"
    ? "planned, because the net capture of a round trip is greater than zero"
    : "fee-dominated, because the fee cost consumes the gross capture";
}

function answerText(result: GridPlanResult): string {
  return `Grid plan for a range of ${result.lowerUsd} USD to ${result.upperUsd} USD across ${result.levels} rungs. Spacing is ${result.spacingUsd} USD between rungs, from a first rung at ${result.firstRungUsd} USD to a last rung at ${result.lastRungUsd} USD, committing ${result.committedUsd} USD across the ladder. One completed round trip buys at ${result.firstRungUsd} USD and sells one rung higher: gross capture ${result.grossCaptureUsd} USD, the round trip fee at ${result.feeBps} bps is ${result.feeCostUsd} USD, and the net capture is ${result.netCaptureUsd} USD. If price traverses the whole range once and every rung fills, ${result.roundTripsInFullTraversal} round trips complete for a total net capture of ${result.totalNetCaptureUsd} USD. State: ${stateLabel(result.state)}. This is deterministic arithmetic on the values you supplied, with no market data, so you can reproduce every figure.`;
}

function resultArtifact(result: GridPlanResult): Record<string, unknown> {
  return {
    capability: GRID_AGENT_CATEGORY,
    action: "plan_grid",
    formula: GRID_FORMULA,
    inputs: {
      lowerUsd: result.lowerUsd,
      upperUsd: result.upperUsd,
      levels: result.levels,
      orderSizeUsd: result.orderSizeUsd,
      feeBps: result.feeBps,
      priceUnit: "USD",
      orderSizeUnit: "USD",
    },
    result: {
      spacingUsd: result.spacingUsd,
      firstRungUsd: result.firstRungUsd,
      lastRungUsd: result.lastRungUsd,
      rungCount: result.rungCount,
      committedUsd: result.committedUsd,
      quantityAtFirstRung: result.quantityAtFirstRung,
      grossCaptureUsd: result.grossCaptureUsd,
      feeCostUsd: result.feeCostUsd,
      netCaptureUsd: result.netCaptureUsd,
      roundTripsInFullTraversal: result.roundTripsInFullTraversal,
      totalNetCaptureUsd: result.totalNetCaptureUsd,
      state: result.state,
    },
    assumptions: [
      "The price range and the order size are supplied by the caller; no market data is fetched.",
      "One round trip buys at the first rung and sells one rung higher, so its quantity is orderSizeUsd / lowerUsd.",
      "feeBps is the round trip cost applied to orderSizeUsd, so feeCostUsd = orderSizeUsd * feeBps / 10000.",
      "A full traversal completes levels - 1 round trips, and totalNetCaptureUsd scales the per round trip net capture by that count.",
    ],
    readOnly: true,
  };
}

export function capabilityText(): string {
  return `Souk Grid Planner plans a grid trading ladder from values you supply: a lower price, an upper price, the number of price rungs, and the value placed at each rung in USD, with an optional round trip fee in basis points. It returns the rung spacing, the first and last rung prices, the value committed across the ladder, the gross, fee and net capture of one completed round trip, and the total net capture if price traverses the whole range once and every rung fills. The arithmetic is deterministic and uses no market data, so you can reproduce every figure. Send the values as a data part, for example { kind: "data", data: { input: { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100, feeBps: 10 } } }, using the plan_grid skill.`;
}

export function capabilityArtifact(): Record<string, unknown> {
  return {
    capability: GRID_AGENT_CATEGORY,
    action: "plan_grid",
    skill: "plan_grid",
    status: "ok",
    required: ["lowerUsd", "upperUsd", "levels", "orderSizeUsd"],
    optional: ["feeBps"],
    formula: GRID_FORMULA,
    defaults: {
      feeBps: DEFAULT_FEE_BPS,
      minLevels: MIN_LEVELS,
      maxLevels: MAX_LEVELS,
      maxFeeBps: MAX_FEE_BPS,
    },
    example: {
      kind: "data",
      data: { input: { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100, feeBps: 10 } },
    },
    limitations: [
      "The caller supplies the range and the size; this agent does not read market prices.",
      "The result is a read-only plan and never a transaction.",
    ],
  };
}

function inputRequiredText(missing: string[], problems: string[]): string {
  const lines = ["I cannot plan a grid yet, and I will not guess the missing values."];
  if (missing.length) {
    lines.push(
      `Provide ${missing.join(" and ")}. A grid plan needs a lower price, an upper price, a rung count and an order size.`,
    );
  }
  if (problems.length) lines.push(`Fix: ${problems.join("; ")}.`);
  lines.push(
    `Send them as a data part, for example { kind: "data", data: { input: { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100, feeBps: 10 } } }. Prices and the order size are positive numbers; levels is an integer from 2 to 200; feeBps is an optional integer from 0 to 10000.`,
  );
  return lines.join(" ");
}

function inputRequiredArtifact(
  fields: GridInputFields,
  missing: string[],
  problems: string[],
): Record<string, unknown> {
  return {
    capability: GRID_AGENT_CATEGORY,
    action: "plan_grid",
    status: "input-required",
    required: ["lowerUsd", "upperUsd", "levels", "orderSizeUsd"],
    missing,
    problems,
    received: {
      lowerUsd: fields.lowerUsd ?? null,
      upperUsd: fields.upperUsd ?? null,
      levels: fields.levels ?? null,
      orderSizeUsd: fields.orderSizeUsd ?? null,
      feeBps: fields.feeBps ?? null,
    },
    expected: {
      lowerUsd: "a positive USD price",
      upperUsd: "a positive USD price strictly above lowerUsd",
      levels: "an integer from 2 to 200",
      orderSizeUsd: "a positive USD value placed at each rung",
      feeBps: "optional integer from 0 to 10000, defaulting to 0",
    },
    example: {
      kind: "data",
      data: { input: { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100, feeBps: 10 } },
    },
    note: "Nothing is inferred from partial values.",
  };
}

export interface GridAgentReply {
  state: "completed" | "input-required";
  text: string;
  artifact: Record<string, unknown>;
}

const GRID_INTENT = /\bgrid\b|ladder|rung|\bdca\b|accumulation\s+grid|trading\s+range/i;

export function decideGridAgentTask(
  task: string,
  input?: Record<string, unknown>,
): GridAgentReply {
  const fields = mergeGridInput(input, task);
  const hasAny =
    fields.lowerUsd !== undefined ||
    fields.upperUsd !== undefined ||
    fields.levels !== undefined ||
    fields.orderSizeUsd !== undefined ||
    fields.feeBps !== undefined ||
    fields.invalid.length > 0;
  const wantsGrid = GRID_INTENT.test(task) || hasAny;

  // an empty call or a benign status question is answered directly with the
  // capability, not treated as a request that is missing inputs
  if (!wantsGrid) {
    return { state: "completed", text: capabilityText(), artifact: capabilityArtifact() };
  }

  const missing: string[] = [];
  const problems: string[] = [];
  const take = (field: GridNumericField): number | undefined => {
    const value = fields[field];
    if (value === undefined) {
      if (fields.invalid.includes(field)) problems.push(`${field} must be a number`);
      else missing.push(field);
    }
    return value;
  };

  const lower = take("lowerUsd");
  const upper = take("upperUsd");
  const levels = take("levels");
  const orderSize = take("orderSizeUsd");
  // feeBps is optional: it defaults to 0 when absent, but a present value that
  // cannot be parsed or is out of range is reported rather than silently ignored
  const feeBps = fields.feeBps;
  if (feeBps === undefined && fields.invalid.includes("feeBps")) {
    problems.push(`feeBps must be an integer from 0 to ${MAX_FEE_BPS}`);
  }

  if (lower !== undefined && !(lower > 0)) {
    problems.push("lowerUsd must be a positive number");
  }
  if (upper !== undefined && !(upper > 0)) {
    problems.push("upperUsd must be a positive number");
  }
  if (orderSize !== undefined && !(orderSize > 0)) {
    problems.push("orderSizeUsd must be a positive number");
  }
  if (
    levels !== undefined &&
    (!Number.isInteger(levels) || levels < MIN_LEVELS || levels > MAX_LEVELS)
  ) {
    problems.push(`levels must be an integer from ${MIN_LEVELS} to ${MAX_LEVELS}`);
  }
  if (
    feeBps !== undefined &&
    (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS)
  ) {
    problems.push(`feeBps must be an integer from 0 to ${MAX_FEE_BPS}`);
  }
  if (lower !== undefined && upper !== undefined && lower > 0 && upper > 0 && upper <= lower) {
    problems.push("upperUsd must be strictly greater than lowerUsd");
  }

  if (missing.length || problems.length) {
    return {
      state: "input-required",
      text: inputRequiredText(missing, problems),
      artifact: inputRequiredArtifact(fields, missing, problems),
    };
  }

  const result = planGrid({
    lowerUsd: lower as number,
    upperUsd: upper as number,
    levels: levels as number,
    orderSizeUsd: orderSize as number,
    feeBps: feeBps ?? DEFAULT_FEE_BPS,
  });
  return { state: "completed", text: answerText(result), artifact: resultArtifact(result) };
}
