// The house health-factor agent: a real endpoint Agent Souk can list through its
// own wizard. It computes a liquidation health factor from caller-supplied
// collateral and debt, so every figure is deterministic and reproducible. It
// fetches no market prices and invents none; when a required value is absent it
// asks for it rather than guessing.

import { privateEndpointReason } from "./endpoint";

export const HOUSE_AGENT_NAME = "Souk Health Guard";
export const HOUSE_AGENT_VERSION = "1.0.0";
export const HOUSE_AGENT_CATEGORY = "health-factor";
export const HOUSE_AGENT_DESCRIPTION =
  "Computes the health factor and liquidation distance of a lending position from the collateral value and debt value the caller supplies, with an optional liquidation threshold. The arithmetic is deterministic and uses no market data, so the caller supplies the valuation and can reproduce every figure.";
export const HOUSE_AGENT_PUBLIC_ORIGIN = "https://api.agentsouk.xyz";
export const HOUSE_AGENT_CARD_PATH = "/api/house-agent/.well-known/agent-card.json";
export const HOUSE_AGENT_MESSAGING_PATH = "/api/house-agent/a2a";

export const DEFAULT_LIQUIDATION_THRESHOLD = 0.8;
export const HEALTHY_AT = 1.5;
export const LIQUIDATABLE_AT = 1;

export interface HouseAgentSkill {
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
  };
}

export interface HouseAgentCard {
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
  skills: HouseAgentSkill[];
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
  return HOUSE_AGENT_PUBLIC_ORIGIN;
}

export function houseAgentMessagingUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${HOUSE_AGENT_MESSAGING_PATH}`;
}

export function houseAgentCard(origin: string): HouseAgentCard {
  const base = origin.replace(/\/+$/, "");
  const messagingUrl = houseAgentMessagingUrl(base);
  return {
    name: HOUSE_AGENT_NAME,
    description: HOUSE_AGENT_DESCRIPTION,
    version: HOUSE_AGENT_VERSION,
    url: messagingUrl,
    protocolVersion: "0.3.0",
    provider: { organization: "Agent Souk", url: base },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "compute-health-factor",
        name: "Health factor calculation",
        description:
          "Computes the health factor, liquidation capacity and liquidation distance of a lending position from a collateral value and a debt value in USD, with an optional liquidation threshold. Returns a healthy, caution or liquidatable state. Read-only deterministic arithmetic with no on-chain price data.",
        tags: ["health-factor", "liquidation", "collateral", "debt", "risk"],
        examples: [
          "Compute the health factor for collateral 1000 and debt 500 at a liquidation threshold of 0.8",
          "What is my liquidation distance for a lending position",
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
        inputSchema: {
          type: "object",
          properties: {
            collateral: { type: "number", description: "collateral value in USD" },
            debt: { type: "number", description: "debt value in USD" },
            liquidationThreshold: {
              type: "number",
              description: "fraction above 0 and at most 1, or a percentage such as 80; defaults to 0.8",
            },
          },
          required: ["collateral", "debt"],
        },
      },
    ],
    supportedInterfaces: [{ url: messagingUrl, transport: "JSONRPC" }],
  };
}

export interface HealthFactorInput {
  collateral: number;
  debt: number;
  liquidationThreshold: number;
}

export type HealthFactorState = "no-debt" | "healthy" | "caution" | "liquidatable";

export interface HealthFactorResult {
  collateral: number;
  debt: number;
  liquidationThreshold: number;
  liquidationCapacity: number;
  healthFactor: number | null;
  state: HealthFactorState;
  liquidationDistance: number | null;
  maxDebtAtHealthFactorOne: number;
  additionalDebtBeforeLiquidation: number;
}

export interface HealthInputFields {
  collateral?: number;
  debt?: number;
  liquidationThreshold?: number;
  liquidationThresholdInvalid?: boolean;
}

const INPUT_ALIASES: Record<string, keyof Omit<HealthInputFields, "liquidationThresholdInvalid">> = {
  collateral: "collateral",
  collateralvalue: "collateral",
  collateralusd: "collateral",
  collateralvalueusd: "collateral",
  debt: "debt",
  debtvalue: "debt",
  debtusd: "debt",
  borrowvalue: "debt",
  liquidationthreshold: "liquidationThreshold",
  threshold: "liquidationThreshold",
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

// A threshold is a fraction in (0, 1], or a percentage string such as "80%".
// A bare number above 1 is refused rather than read as a percentage, because
// guessing the caller's unit would silently change the answer.
function thresholdFromValue(raw: unknown): number | null {
  if (typeof raw === "string" && raw.includes("%")) {
    const percent = toNumber(raw.replace(/%/g, ""));
    if (percent === undefined) return null;
    const fraction = percent / 100;
    return fraction > 0 && fraction <= 1 ? fraction : null;
  }
  const value = toNumber(raw);
  return value !== undefined && value > 0 && value <= 1 ? value : null;
}

export function extractHealthInput(value: unknown): HealthInputFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  // the marketplace client sends { kind: "data", data: { input: {...} } }, so
  // an "input" wrapper is unwrapped; a bare data object is read directly
  const nested = record.input;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : record;

  const out: HealthInputFields = {};
  for (const [key, raw] of Object.entries(source)) {
    const field = INPUT_ALIASES[key.toLowerCase().replace(/[\s_-]/g, "")];
    if (!field || out[field] !== undefined) continue;
    if (field === "liquidationThreshold") {
      const threshold = thresholdFromValue(raw);
      if (threshold !== null) out.liquidationThreshold = threshold;
      else if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        out.liquidationThresholdInvalid = true;
      }
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

// A plain text request can carry labelled values too, for example
// "collateral 1000 and debt 500". Only explicitly labelled numbers are read, so
// an unlabelled figure is never treated as an input.
export function parseHealthText(task: string): HealthInputFields {
  const out: HealthInputFields = {};
  const collateral = labelledNumber(task, "collateral(?:\\s+value)?");
  if (collateral !== undefined) out.collateral = collateral;
  const debt = labelledNumber(task, "debt(?:\\s+value)?");
  if (debt !== undefined) out.debt = debt;
  return out;
}

export function mergeHealthInput(
  input: Record<string, unknown> | undefined,
  task: string,
): HealthInputFields {
  // structured input wins over text when both name the same field
  return { ...parseHealthText(task), ...extractHealthInput(input) };
}

export function computeHealthFactor(input: HealthFactorInput): HealthFactorResult {
  const { collateral, debt, liquidationThreshold } = input;
  const liquidationCapacity = round(collateral * liquidationThreshold, 2);
  const maxDebtAtHealthFactorOne = liquidationCapacity;

  if (debt === 0) {
    return {
      ...input,
      liquidationCapacity,
      healthFactor: null,
      state: "no-debt",
      liquidationDistance: null,
      maxDebtAtHealthFactorOne,
      additionalDebtBeforeLiquidation: liquidationCapacity,
    };
  }

  const healthFactor = (collateral * liquidationThreshold) / debt;
  const state: HealthFactorState =
    healthFactor >= HEALTHY_AT ? "healthy" : healthFactor >= LIQUIDATABLE_AT ? "caution" : "liquidatable";

  return {
    ...input,
    liquidationCapacity,
    healthFactor: round(healthFactor),
    state,
    liquidationDistance: round(1 - 1 / healthFactor),
    maxDebtAtHealthFactorOne,
    additionalDebtBeforeLiquidation: round(Math.max(0, liquidationCapacity - debt), 2),
  };
}

function formatPercent(fraction: number): string {
  return `${round(fraction * 100, 1)}%`;
}

function answerText(result: HealthFactorResult): string {
  const threshold = result.liquidationThreshold;
  if (result.healthFactor === null) {
    return `No debt was supplied, so there is no health factor to compute: with debt 0 the ratio is undefined rather than a number. At collateral ${result.collateral} USD and a liquidation threshold of ${threshold}, the liquidation capacity is ${result.liquidationCapacity} USD, and the position can carry up to ${result.maxDebtAtHealthFactorOne} USD of debt before the health factor reaches 1. This is deterministic arithmetic on the values you supplied, with no on-chain price or market data.`;
  }
  const stateLabel =
    result.state === "healthy"
      ? "healthy, at or above a health factor of 1.5"
      : result.state === "caution"
        ? "caution, between a health factor of 1 and 1.5"
        : "liquidatable, below a health factor of 1";
  return `Health factor ${result.healthFactor} for collateral ${result.collateral} USD at a liquidation threshold of ${threshold} and debt ${result.debt} USD. Liquidation capacity is ${result.liquidationCapacity} USD, so collateral value can fall by ${formatPercent(result.liquidationDistance ?? 0)} before the health factor reaches 1. State: ${stateLabel}. This is deterministic arithmetic on the values you supplied, with no on-chain price or market data.`;
}

function resultArtifact(result: HealthFactorResult): Record<string, unknown> {
  return {
    capability: "health-factor",
    action: "compute_health_factor",
    formula: "healthFactor = (collateral * liquidationThreshold) / debt",
    inputs: {
      collateral: result.collateral,
      debt: result.debt,
      liquidationThreshold: result.liquidationThreshold,
      collateralUnit: "USD",
      debtUnit: "USD",
    },
    result: {
      healthFactor: result.healthFactor,
      state: result.state,
      liquidationCapacity: result.liquidationCapacity,
      maxDebtAtHealthFactorOne: result.maxDebtAtHealthFactorOne,
      additionalDebtBeforeLiquidation: result.additionalDebtBeforeLiquidation,
      liquidationDistance: result.liquidationDistance,
      liquidationDistancePercent:
        result.liquidationDistance === null ? null : round(result.liquidationDistance * 100, 2),
    },
    assumptions: [
      "Collateral and debt are USD-denominated values supplied by the caller.",
      "The liquidation threshold is the fraction of collateral value counted as liquidation capacity, defaulting to 0.8 when omitted.",
      "No on-chain price or market data is fetched, so every figure is reproducible from the inputs.",
    ],
    readOnly: true,
  };
}

export function capabilityText(): string {
  return `Souk Health Guard computes the health factor of a lending position from values you supply: a collateral value and a debt value in USD, with an optional liquidation threshold. It returns the health factor, the liquidation capacity, how far collateral value can fall before the health factor reaches 1, and a healthy, caution or liquidatable state. The arithmetic is deterministic and uses no on-chain price data, so you can reproduce every figure. Send the values as a data part, for example { kind: "data", data: { input: { collateral: 1000, debt: 500, liquidationThreshold: 0.8 } } }.`;
}

export function capabilityArtifact(): Record<string, unknown> {
  return {
    capability: "health-factor",
    action: "compute_health_factor",
    status: "ok",
    required: ["collateral", "debt"],
    optional: ["liquidationThreshold"],
    formula: "healthFactor = (collateral * liquidationThreshold) / debt",
    defaults: {
      liquidationThreshold: DEFAULT_LIQUIDATION_THRESHOLD,
      healthyAt: HEALTHY_AT,
      liquidatableBelow: LIQUIDATABLE_AT,
    },
    example: {
      kind: "data",
      data: { input: { collateral: 1000, debt: 500, liquidationThreshold: 0.8 } },
    },
    limitations: [
      "The caller supplies the valuation; this agent does not read on-chain prices.",
      "The result is a read-only calculation and never a transaction.",
    ],
  };
}

function inputRequiredText(missing: string[], problems: string[]): string {
  const lines = ["I cannot compute a health factor yet, and I will not guess the missing values."];
  if (missing.length) {
    lines.push(
      `Provide ${missing.join(" and ")}. The health factor is (collateral * liquidationThreshold) / debt, so both collateral and debt are required.`,
    );
  }
  if (problems.length) lines.push(`Fix: ${problems.join("; ")}.`);
  lines.push(
    `Send them as a data part, for example { kind: "data", data: { input: { collateral: 1000, debt: 500, liquidationThreshold: 0.8 } } }. Collateral and debt are USD values; the threshold is an optional fraction above 0 and at most 1, or a percentage such as 80.`,
  );
  return lines.join(" ");
}

function inputRequiredArtifact(
  fields: HealthInputFields,
  missing: string[],
  problems: string[],
): Record<string, unknown> {
  return {
    capability: "health-factor",
    action: "compute_health_factor",
    status: "input-required",
    required: ["collateral", "debt"],
    missing,
    problems,
    received: {
      collateral: fields.collateral ?? null,
      debt: fields.debt ?? null,
      liquidationThreshold: fields.liquidationThreshold ?? null,
    },
    expected: {
      collateral: "a positive USD value",
      debt: "zero or a positive USD value",
      liquidationThreshold: "optional fraction above 0 and at most 1, or a percentage such as 80",
    },
    example: {
      kind: "data",
      data: { input: { collateral: 1000, debt: 500, liquidationThreshold: 0.8 } },
    },
    note: "Nothing is inferred from partial values.",
  };
}

export interface HouseAgentReply {
  state: "completed" | "input-required";
  text: string;
  artifact: Record<string, unknown>;
}

const HEALTH_INTENT =
  /health[\s-]*factor|liquidat|collateral|\bdebt\b|borrow(?:ing)?\s+position|lending\s+position/i;

export function decideHouseAgentTask(
  task: string,
  input?: Record<string, unknown>,
): HouseAgentReply {
  const fields = mergeHealthInput(input, task);
  const hasCollateral = fields.collateral !== undefined;
  const hasDebt = fields.debt !== undefined;
  const wantsHealth = HEALTH_INTENT.test(task) || hasCollateral || hasDebt;

  // a benign status or capability question is answered directly, not treated as
  // a request that is missing inputs
  if (!wantsHealth) {
    return { state: "completed", text: capabilityText(), artifact: capabilityArtifact() };
  }

  const missing: string[] = [];
  const problems: string[] = [];
  if (!hasCollateral) missing.push("collateral");
  else if (!((fields.collateral as number) > 0)) {
    problems.push("collateral must be a positive number");
  }
  if (!hasDebt) missing.push("debt");
  else if (!((fields.debt as number) >= 0)) {
    problems.push("debt must be zero or a positive number");
  }
  if (fields.liquidationThresholdInvalid && fields.liquidationThreshold === undefined) {
    problems.push("liquidationThreshold must be a fraction above 0 and at most 1, or a percentage such as 80");
  }

  if (missing.length || problems.length) {
    return {
      state: "input-required",
      text: inputRequiredText(missing, problems),
      artifact: inputRequiredArtifact(fields, missing, problems),
    };
  }

  const result = computeHealthFactor({
    collateral: fields.collateral as number,
    debt: fields.debt as number,
    liquidationThreshold: fields.liquidationThreshold ?? DEFAULT_LIQUIDATION_THRESHOLD,
  });
  return { state: "completed", text: answerText(result), artifact: resultArtifact(result) };
}
