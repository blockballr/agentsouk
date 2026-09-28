// The first party reference agent for the rebalancing category: a real endpoint
// Agent Souk can list through its own wizard. It plans a portfolio rebalance from
// the two holding values and the target share the caller supplies, so every
// figure is deterministic and reproducible. It fetches no market prices and
// invents none; when a required value is absent it asks for it rather than
// guessing.

import { privateEndpointReason } from "./endpoint";

export const REFERENCE_AGENT_NAME = "Souk Drift Guard";
export const REFERENCE_AGENT_VERSION = "1.0.0";
export const REFERENCE_AGENT_CATEGORY = "rebalancing";
export const REFERENCE_AGENT_DESCRIPTION =
  "Plans a portfolio rebalance from the two holding values and the target share the caller supplies, returning the portfolio total, each asset's current and target weight, each drift in percentage points, whether a rebalance is warranted, and the value in USD to move from one label to the other. The arithmetic is deterministic and uses no market data, so the caller supplies every valuation and can reproduce every figure.";
export const REFERENCE_AGENT_PUBLIC_ORIGIN = "https://api.agentsouk.xyz";
export const REFERENCE_AGENT_CARD_PATH = "/api/reference/rebalancing/.well-known/agent-card.json";
export const REFERENCE_AGENT_MESSAGING_PATH = "/api/reference/rebalancing/a2a";

export const DEFAULT_DRIFT_THRESHOLD_PERCENT = 5;

export interface ReferenceAgentSkill {
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

export interface ReferenceAgentCard {
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
  skills: ReferenceAgentSkill[];
  supportedInterfaces: { url: string; transport: string }[];
}

// The card must never name a private or loopback address, so a configured
// origin is used only when it passes the marketplace's own check; otherwise the
// deployed api origin wins.
export function pickPublicOrigin(candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? "").trim().replace(/\/+$/, "");
    if (trimmed && privateEndpointReason(trimmed) === null) return trimmed;
  }
  return REFERENCE_AGENT_PUBLIC_ORIGIN;
}

export function referenceMessagingUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${REFERENCE_AGENT_MESSAGING_PATH}`;
}

export function referenceAgentCard(origin: string): ReferenceAgentCard {
  const base = origin.replace(/\/+$/, "");
  const messagingUrl = referenceMessagingUrl(base);
  return {
    name: REFERENCE_AGENT_NAME,
    description: REFERENCE_AGENT_DESCRIPTION,
    version: REFERENCE_AGENT_VERSION,
    url: messagingUrl,
    protocolVersion: "0.3.0",
    provider: { organization: "Agent Souk", url: base },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "plan-rebalance",
        name: "Rebalance planning",
        description:
          "Plans a portfolio rebalance from two holding values in USD and a target share for the first asset, with an optional drift threshold. Returns the portfolio total, current and target weights, each drift in percentage points, whether a rebalance is warranted, and the USD value to move between labels. Read-only deterministic arithmetic with no market data and no price input.",
        tags: ["rebalancing", "allocation", "drift", "portfolio", "weights"],
        examples: [
          "Plan a rebalance for valueA 700 and valueB 300 with a target of 50 percent for A",
          "Is my portfolio outside its target allocation by more than 5 percent",
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
        inputSchema: {
          type: "object",
          properties: {
            valueAUsd: { type: "number", description: "value of asset A in USD" },
            valueBUsd: { type: "number", description: "value of asset B in USD" },
            targetAPercent: { type: "number", description: "target share of asset A, a percentage from 0 to 100" },
            thresholdPercent: { type: "number", description: "optional drift threshold in percentage points, defaults to 5" },
            symbolA: { type: "string", description: "optional label for asset A" },
            symbolB: { type: "string", description: "optional label for asset B" },
          },
          required: ["valueAUsd", "valueBUsd", "targetAPercent"],
          examples: [{ valueAUsd: 700, valueBUsd: 300, targetAPercent: 50, thresholdPercent: 5, symbolA: "BNB", symbolB: "USDT" }],
        },
        outputSchema: {
          type: "object",
          properties: {
            totalUsd: { type: "number", description: "portfolio total in USD" },
            currentAPercent: { type: "number", description: "current weight of asset A" },
            driftAPercent: { type: "number", description: "drift of asset A in percentage points" },
            rebalanceWarranted: { type: "boolean", description: "whether a drift exceeds the threshold" },
            valueToMoveUsd: { type: "number", description: "USD value to move when a rebalance is warranted" },
            fromSymbol: { type: "string", description: "asset to move value from" },
            toSymbol: { type: "string", description: "asset to move value to" },
          },
        },
      },
    ],
    supportedInterfaces: [{ url: messagingUrl, transport: "JSONRPC" }],
  };
}

export interface RebalanceInput {
  valueAUsd: number;
  valueBUsd: number;
  targetAPercent: number;
  thresholdPercent: number;
  symbolA: string;
  symbolB: string;
}

export type RebalanceState = "rebalance" | "in-band";

export interface RebalanceResult {
  valueAUsd: number;
  valueBUsd: number;
  symbolA: string;
  symbolB: string;
  targetAPercent: number;
  thresholdPercent: number;
  totalUsd: number;
  currentAPercent: number;
  targetBPercent: number;
  currentBPercent: number;
  driftAPercent: number;
  driftBPercent: number;
  rebalanceWarranted: boolean;
  state: RebalanceState;
  targetValueAUsd: number;
  targetValueBUsd: number;
  valueToMoveUsd: number | null;
  fromSymbol: string | null;
  toSymbol: string | null;
  valueToMoveUnits: number | null;
  priceSupplied: boolean;
}

export interface RebalanceInputFields {
  valueAUsd?: number;
  valueBUsd?: number;
  targetAPercent?: number;
  thresholdPercent?: number;
  targetAPercentInvalid?: boolean;
  thresholdPercentInvalid?: boolean;
  symbolA?: string;
  symbolB?: string;
}

type NumberField = "valueAUsd" | "valueBUsd" | "targetAPercent" | "thresholdPercent";
type SymbolField = "symbolA" | "symbolB";

const NUMBER_ALIASES: Record<string, NumberField> = {
  valueausd: "valueAUsd",
  valuea: "valueAUsd",
  ausd: "valueAUsd",
  holdingausd: "valueAUsd",
  holdinga: "valueAUsd",
  assetavalueusd: "valueAUsd",
  valuebusd: "valueBUsd",
  valueb: "valueBUsd",
  busd: "valueBUsd",
  holdingbusd: "valueBUsd",
  holdingb: "valueBUsd",
  assetbvalueusd: "valueBUsd",
  targetapercent: "targetAPercent",
  targeta: "targetAPercent",
  targetweighta: "targetAPercent",
  targetweightapercent: "targetAPercent",
  targetpercent: "targetAPercent",
  thresholdpercent: "thresholdPercent",
  threshold: "thresholdPercent",
  driftthreshold: "thresholdPercent",
  driftthresholdpercent: "thresholdPercent",
};

const SYMBOL_ALIASES: Record<string, SymbolField> = {
  symbola: "symbolA",
  labela: "symbolA",
  tickera: "symbolA",
  symbolb: "symbolB",
  labelb: "symbolB",
  tickerb: "symbolB",
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

// A target share and a threshold are percentages from 0 to 100. A bare number is
// read on that scale, and a string such as "50%" has the sign stripped, so the
// caller's unit is never guessed from magnitude.
function percentFromValue(raw: unknown): number | undefined {
  if (typeof raw === "string" && raw.includes("%")) {
    return toNumber(raw.replace(/%/g, ""));
  }
  return toNumber(raw);
}

export function extractReferenceInput(value: unknown): RebalanceInputFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  // the marketplace client sends { kind: "data", data: { input: {...} } }, so
  // an "input" wrapper is unwrapped; a bare data object is read directly
  const nested = record.input;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : record;

  const out: RebalanceInputFields = {};
  for (const [key, raw] of Object.entries(source)) {
    const normalized = key.toLowerCase().replace(/[\s_-]/g, "");
    const numberField = NUMBER_ALIASES[normalized];
    if (numberField && out[numberField] === undefined) {
      const parsed =
        numberField === "targetAPercent" || numberField === "thresholdPercent"
          ? percentFromValue(raw)
          : toNumber(raw);
      if (parsed !== undefined) {
        out[numberField] = parsed;
      } else if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        if (numberField === "targetAPercent") out.targetAPercentInvalid = true;
        if (numberField === "thresholdPercent") out.thresholdPercentInvalid = true;
      }
      continue;
    }
    const symbolField = SYMBOL_ALIASES[normalized];
    if (symbolField && out[symbolField] === undefined) {
      if (typeof raw === "string" && raw.trim()) out[symbolField] = raw.trim();
    }
  }
  return out;
}

const TEXT_NUMBER = "(-?\\d[\\d,]*(?:\\.\\d+)?)";

function labelledNumber(text: string, label: string): number | undefined {
  const match = new RegExp(`${label}[^0-9-]{0,24}${TEXT_NUMBER}`, "i").exec(text);
  return match ? toNumber(match[1]) : undefined;
}

// A plain text request can carry labelled values too, for example
// "value A 700 and value B 300". Only explicitly labelled numbers are read, so
// an unlabelled figure is never treated as an input.
export function parseReferenceText(task: string): RebalanceInputFields {
  const out: RebalanceInputFields = {};
  const valueA = labelledNumber(task, "value\\s*a(?:\\s*usd)?");
  if (valueA !== undefined) out.valueAUsd = valueA;
  const valueB = labelledNumber(task, "value\\s*b(?:\\s*usd)?");
  if (valueB !== undefined) out.valueBUsd = valueB;
  const targetA = labelledNumber(task, "target(?:\\s*a)?");
  if (targetA !== undefined) out.targetAPercent = targetA;
  const threshold = labelledNumber(task, "threshold");
  if (threshold !== undefined) out.thresholdPercent = threshold;
  return out;
}

export function mergeReferenceInput(
  input: Record<string, unknown> | undefined,
  task: string,
): RebalanceInputFields {
  // structured input wins over text when both name the same field
  return { ...parseReferenceText(task), ...extractReferenceInput(input) };
}

export function computeRebalance(input: RebalanceInput): RebalanceResult {
  const { valueAUsd, valueBUsd, targetAPercent, thresholdPercent, symbolA, symbolB } = input;
  const totalRaw = valueAUsd + valueBUsd;
  const currentARaw = (valueAUsd / totalRaw) * 100;
  const currentBRaw = 100 - currentARaw;
  // B is the complement of A, so its drift is the exact negative of A's
  const driftARaw = currentARaw - targetAPercent;
  const driftBRaw = -driftARaw;
  const targetBPercent = round(100 - targetAPercent, 2);
  const targetValueARaw = (targetAPercent / 100) * totalRaw;
  const targetValueBRaw = totalRaw - targetValueARaw;
  const rebalanceWarranted = Math.abs(driftARaw) > thresholdPercent;

  let valueToMoveUsd: number | null = null;
  let fromSymbol: string | null = null;
  let toSymbol: string | null = null;
  if (rebalanceWarranted) {
    valueToMoveUsd = round(Math.abs(targetValueARaw - valueAUsd), 2);
    if (driftARaw > 0) {
      fromSymbol = symbolA;
      toSymbol = symbolB;
    } else {
      fromSymbol = symbolB;
      toSymbol = symbolA;
    }
  }

  return {
    valueAUsd,
    valueBUsd,
    symbolA,
    symbolB,
    targetAPercent,
    thresholdPercent,
    totalUsd: round(totalRaw, 2),
    currentAPercent: round(currentARaw, 2),
    targetBPercent,
    currentBPercent: round(currentBRaw, 2),
    driftAPercent: round(driftARaw, 2),
    driftBPercent: round(driftBRaw, 2),
    rebalanceWarranted,
    state: rebalanceWarranted ? "rebalance" : "in-band",
    targetValueAUsd: round(targetValueARaw, 2),
    targetValueBUsd: round(targetValueBRaw, 2),
    valueToMoveUsd,
    fromSymbol,
    toSymbol,
    valueToMoveUnits: null,
    priceSupplied: false,
  };
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function answerText(result: RebalanceResult): string {
  const portfolio = `Portfolio total ${result.totalUsd} USD: ${result.symbolA} at ${result.valueAUsd} USD and ${result.symbolB} at ${result.valueBUsd} USD, against a target of ${result.targetAPercent}% for ${result.symbolA} and ${result.targetBPercent}% for ${result.symbolB}. Current weights are ${result.currentAPercent}% for ${result.symbolA}, a drift of ${signed(result.driftAPercent)} percentage points, and ${result.currentBPercent}% for ${result.symbolB}, a drift of ${signed(result.driftBPercent)} percentage points. The rebalance threshold is ${result.thresholdPercent} percentage points.`;
  const provenance =
    "This is deterministic arithmetic on the values you supplied, with no market data. No price was supplied, so the trade is stated in value terms only and cannot be expressed in units.";

  if (!result.rebalanceWarranted) {
    return `No rebalance is needed: both drifts are within the ${result.thresholdPercent} percentage point threshold. ${portfolio} ${provenance}`;
  }
  return `A rebalance is needed: the drift of ${signed(result.driftAPercent)} percentage points exceeds the ${result.thresholdPercent} percentage point threshold. ${portfolio} Move ${result.valueToMoveUsd} USD from ${result.fromSymbol} to ${result.toSymbol} to reach the target weights. ${provenance}`;
}

function resultArtifact(result: RebalanceResult): Record<string, unknown> {
  return {
    capability: "rebalancing",
    action: "plan_rebalance",
    formula: "driftAPercent = (valueAUsd / (valueAUsd + valueBUsd)) * 100 - targetAPercent",
    inputs: {
      valueAUsd: result.valueAUsd,
      valueBUsd: result.valueBUsd,
      targetAPercent: result.targetAPercent,
      thresholdPercent: result.thresholdPercent,
      symbolA: result.symbolA,
      symbolB: result.symbolB,
      valueUnit: "USD",
    },
    result: {
      state: result.state,
      rebalanceWarranted: result.rebalanceWarranted,
      totalUsd: result.totalUsd,
      currentAPercent: result.currentAPercent,
      targetAPercent: result.targetAPercent,
      driftAPercent: result.driftAPercent,
      currentBPercent: result.currentBPercent,
      targetBPercent: result.targetBPercent,
      driftBPercent: result.driftBPercent,
      targetValueAUsd: result.targetValueAUsd,
      targetValueBUsd: result.targetValueBUsd,
      valueToMoveUsd: result.valueToMoveUsd,
      fromSymbol: result.fromSymbol,
      toSymbol: result.toSymbol,
      valueToMoveUnits: result.valueToMoveUnits,
      priceSupplied: result.priceSupplied,
    },
    assumptions: [
      "Holding values are USD amounts supplied by the caller; no market price is read.",
      "Weights and drifts are percentages and percentage points; the threshold defaults to 5 percentage points when omitted.",
      "No price is accepted, so the trade is reported in value terms and never converted to units.",
      "Every figure is reproducible from the inputs.",
    ],
    readOnly: true,
  };
}

export function capabilityText(): string {
  return `Souk Drift Guard plans a portfolio rebalance from values you supply: a value for asset A and a value for asset B in USD, and the target share of the portfolio that asset A should hold as a percentage from 0 to 100. It returns the portfolio total, each asset's current and target weight, each drift in percentage points, whether a drift exceeds the threshold, and, when a rebalance is warranted, the USD value to move and the labels to move it between. The arithmetic is deterministic and uses no market data, so you can reproduce every figure. No price is accepted, so the trade is stated in value terms, not units. Send the values as a data part, for example { kind: "data", data: { input: { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50, thresholdPercent: 5, symbolA: "BNB", symbolB: "USDT" } } }.`;
}

export function capabilityArtifact(): Record<string, unknown> {
  return {
    capability: "rebalancing",
    action: "plan_rebalance",
    status: "ok",
    required: ["valueAUsd", "valueBUsd", "targetAPercent"],
    optional: ["thresholdPercent", "symbolA", "symbolB"],
    formula: "driftAPercent = (valueAUsd / (valueAUsd + valueBUsd)) * 100 - targetAPercent",
    defaults: {
      thresholdPercent: DEFAULT_DRIFT_THRESHOLD_PERCENT,
      symbolA: "A",
      symbolB: "B",
    },
    example: {
      kind: "data",
      data: {
        input: {
          valueAUsd: 700,
          valueBUsd: 300,
          targetAPercent: 50,
          thresholdPercent: 5,
          symbolA: "BNB",
          symbolB: "USDT",
        },
      },
    },
    limitations: [
      "The caller supplies the valuations; this agent does not read prices.",
      "No price is accepted, so the recommended trade is expressed in value terms, not units.",
      "The result is a read-only plan and never a transaction.",
    ],
  };
}

function inputRequiredText(missing: string[], problems: string[]): string {
  const lines = ["I cannot plan a rebalance yet, and I will not guess the missing values."];
  if (missing.length) {
    lines.push(
      `Provide ${missing.join(" and ")}. The drift is the current weight minus the target weight, so both holding values and the target share are required.`,
    );
  }
  if (problems.length) lines.push(`Fix: ${problems.join("; ")}.`);
  lines.push(
    `Send them as a data part, for example { kind: "data", data: { input: { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50 } } }. Holding values are USD amounts zero or greater, with at least one above zero; the target share is a percentage from 0 to 100; the threshold is an optional percentage from 0 to 100.`,
  );
  return lines.join(" ");
}

function inputRequiredArtifact(
  fields: RebalanceInputFields,
  missing: string[],
  problems: string[],
): Record<string, unknown> {
  return {
    capability: "rebalancing",
    action: "plan_rebalance",
    status: "input-required",
    required: ["valueAUsd", "valueBUsd", "targetAPercent"],
    missing,
    problems,
    received: {
      valueAUsd: fields.valueAUsd ?? null,
      valueBUsd: fields.valueBUsd ?? null,
      targetAPercent: fields.targetAPercent ?? null,
      thresholdPercent: fields.thresholdPercent ?? null,
      symbolA: fields.symbolA ?? null,
      symbolB: fields.symbolB ?? null,
    },
    expected: {
      valueAUsd: "a USD value zero or greater, with at least one holding above zero",
      valueBUsd: "a USD value zero or greater, with at least one holding above zero",
      targetAPercent: "a percentage from 0 to 100",
      thresholdPercent: "optional percentage from 0 to 100, defaulting to 5",
    },
    example: {
      kind: "data",
      data: { input: { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50 } },
    },
    note: "Nothing is inferred from partial values.",
  };
}

export interface ReferenceAgentReply {
  state: "completed" | "input-required";
  text: string;
  artifact: Record<string, unknown>;
}

const REBALANCE_INTENT = /rebalanc|drift|allocation|weight|portfolio|target\s*(?:share|weight)/i;

export function decideReferenceTask(
  task: string,
  input?: Record<string, unknown>,
): ReferenceAgentReply {
  const fields = mergeReferenceInput(input, task);
  const hasA = fields.valueAUsd !== undefined;
  const hasB = fields.valueBUsd !== undefined;
  const hasTarget = fields.targetAPercent !== undefined;
  const wantsRebalance = REBALANCE_INTENT.test(task) || hasA || hasB || hasTarget;

  // a benign status or capability question is answered directly, not treated as
  // a request that is missing inputs
  if (!wantsRebalance) {
    return { state: "completed", text: capabilityText(), artifact: capabilityArtifact() };
  }

  const missing: string[] = [];
  const problems: string[] = [];
  if (!hasA) missing.push("valueAUsd");
  else if (!((fields.valueAUsd as number) >= 0)) {
    problems.push("valueAUsd must be zero or a positive number");
  }
  if (!hasB) missing.push("valueBUsd");
  else if (!((fields.valueBUsd as number) >= 0)) {
    problems.push("valueBUsd must be zero or a positive number");
  }
  if (!hasTarget) {
    missing.push("targetAPercent");
    if (fields.targetAPercentInvalid) problems.push("targetAPercent must be a number from 0 to 100");
  } else if (!((fields.targetAPercent as number) >= 0 && (fields.targetAPercent as number) <= 100)) {
    problems.push("targetAPercent must be a number from 0 to 100");
  }
  if (fields.thresholdPercentInvalid && fields.thresholdPercent === undefined) {
    problems.push("thresholdPercent must be a number from 0 to 100");
  } else if (
    fields.thresholdPercent !== undefined &&
    !(fields.thresholdPercent >= 0 && fields.thresholdPercent <= 100)
  ) {
    problems.push("thresholdPercent must be a number from 0 to 100");
  }
  if (hasA && hasB && !((fields.valueAUsd as number) > 0) && !((fields.valueBUsd as number) > 0)) {
    problems.push("at least one of valueAUsd and valueBUsd must be greater than zero");
  }

  if (missing.length || problems.length) {
    return {
      state: "input-required",
      text: inputRequiredText(missing, problems),
      artifact: inputRequiredArtifact(fields, missing, problems),
    };
  }

  const result = computeRebalance({
    valueAUsd: fields.valueAUsd as number,
    valueBUsd: fields.valueBUsd as number,
    targetAPercent: fields.targetAPercent as number,
    thresholdPercent: fields.thresholdPercent ?? DEFAULT_DRIFT_THRESHOLD_PERCENT,
    symbolA: fields.symbolA ?? "A",
    symbolB: fields.symbolB ?? "B",
  });
  return { state: "completed", text: answerText(result), artifact: resultArtifact(result) };
}
