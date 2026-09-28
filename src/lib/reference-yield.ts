// The first party reference yield agent: a real endpoint Agent Souk can list
// through its own wizard. It computes the net yield of a deposit from a
// principal and an annual rate the caller supplies, so every figure is
// deterministic and reproducible. It fetches no market yield and invents none;
// when a required value is absent it asks for it rather than guessing.

import { privateEndpointReason } from "./endpoint";

export const REFERENCE_YIELD_NAME = "Souk Yield Lens";
export const REFERENCE_YIELD_VERSION = "1.0.0";
export const REFERENCE_YIELD_CATEGORY = "yield";
export const REFERENCE_YIELD_DESCRIPTION =
  "Computes the net yield of a deposit from a principal in USD, a gross annual rate (APY) the caller supplies, an optional compounding frequency and an optional fee in basis points. It returns the effective annual rate after compounding, the net rate after the fee, the fee drag in percentage points and the projected earnings over one year. The arithmetic is deterministic and uses no market data, so the caller supplies the rate and can reproduce every figure.";
export const REFERENCE_YIELD_PUBLIC_ORIGIN = "https://api.agentsouk.xyz";
export const REFERENCE_YIELD_CARD_PATH = "/api/reference/yield/.well-known/agent-card.json";
export const REFERENCE_YIELD_MESSAGING_PATH = "/api/reference/yield/a2a";

export const DEFAULT_COMPOUNDING_PER_YEAR = 12;
export const DEFAULT_FEE_BPS = 0;
export const MIN_COMPOUNDING_PER_YEAR = 1;
export const MAX_COMPOUNDING_PER_YEAR = 365;
export const MAX_FEE_BPS = 10000;

export interface ReferenceYieldSkill {
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

export interface ReferenceYieldCard {
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
  skills: ReferenceYieldSkill[];
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
  return REFERENCE_YIELD_PUBLIC_ORIGIN;
}

export function referenceYieldMessagingUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${REFERENCE_YIELD_MESSAGING_PATH}`;
}

export function referenceYieldCard(origin: string): ReferenceYieldCard {
  const base = origin.replace(/\/+$/, "");
  const messagingUrl = referenceYieldMessagingUrl(base);
  return {
    name: REFERENCE_YIELD_NAME,
    description: REFERENCE_YIELD_DESCRIPTION,
    version: REFERENCE_YIELD_VERSION,
    url: messagingUrl,
    protocolVersion: "0.3.0",
    provider: { organization: "Agent Souk", url: base },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "compute_net_yield",
        name: "Net yield calculation",
        description:
          "Computes the effective annual rate, the net rate after a fee, the fee drag in percentage points and the projected one year earnings of a deposit, from a principal in USD and a gross annual rate the caller supplies, with an optional compounding frequency and an optional fee in basis points. Read-only deterministic arithmetic with no market data.",
        tags: ["yield", "apy", "apr", "compounding", "fees"],
        examples: [
          "Compute the net yield for a 10000 USD principal at a gross APY of 12 compounded monthly with a 200 basis point fee",
          "What are the projected one year earnings after fees for my deposit",
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
        inputSchema: {
          type: "object",
          properties: {
            principalUsd: { type: "number", description: "principal in USD" },
            grossApyPercent: { type: "number", description: "gross annual rate in percent" },
            compoundingPerYear: { type: "number", description: "compounding frequency per year, defaults to 12" },
            feeBps: { type: "number", description: "fee in basis points, defaults to 200" },
          },
          required: ["principalUsd", "grossApyPercent"],
          examples: [{ principalUsd: 10000, grossApyPercent: 12, compoundingPerYear: 12, feeBps: 200 }],
        },
        outputSchema: {
          type: "object",
          properties: {
            effectiveAnnualRatePercent: { type: "number", description: "effective annual rate after compounding" },
            netRatePercent: { type: "number", description: "net rate after the fee" },
            feeDragPercent: { type: "number", description: "the fee drag in percentage points" },
            projectedEarningsUsd: { type: "number", description: "projected one year earnings after fees" },
          },
        },
      },
    ],
    supportedInterfaces: [{ url: messagingUrl, transport: "JSONRPC" }],
  };
}

export interface NetYieldInput {
  principalUsd: number;
  grossApyPercent: number;
  compoundingPerYear: number;
  feeBps: number;
}

export type NetYieldState = "net-positive" | "fee-dominated";

export interface NetYieldResult {
  principalUsd: number;
  grossApyPercent: number;
  compoundingPerYear: number;
  feeBps: number;
  effectiveAnnualRatePercent: number;
  netRatePercent: number;
  feeDragPercent: number;
  projectedEarningsUsd: number;
  state: NetYieldState;
}

export interface YieldInputFields {
  principalUsd?: number;
  grossApyPercent?: number;
  compoundingPerYear?: number;
  feeBps?: number;
  compoundingInvalid?: boolean;
  feeInvalid?: boolean;
}

const INPUT_ALIASES: Record<string, keyof Omit<YieldInputFields, "compoundingInvalid" | "feeInvalid">> = {
  principal: "principalUsd",
  principalusd: "principalUsd",
  principalamount: "principalUsd",
  deposit: "principalUsd",
  depositusd: "principalUsd",
  amount: "principalUsd",
  amountusd: "principalUsd",
  notional: "principalUsd",
  grossapypercent: "grossApyPercent",
  grossapy: "grossApyPercent",
  apypercent: "grossApyPercent",
  apy: "grossApyPercent",
  grossaprpercent: "grossApyPercent",
  grossapr: "grossApyPercent",
  aprpercent: "grossApyPercent",
  apr: "grossApyPercent",
  grossrate: "grossApyPercent",
  rate: "grossApyPercent",
  compoundingperyear: "compoundingPerYear",
  compoundingsperyear: "compoundingPerYear",
  compoundsperyear: "compoundingPerYear",
  periodsperyear: "compoundingPerYear",
  compounding: "compoundingPerYear",
  compoundingfrequency: "compoundingPerYear",
  frequency: "compoundingPerYear",
  feebps: "feeBps",
  fee: "feeBps",
  feebasispoints: "feeBps",
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
  const parsed = Number(trimmed.replace(/[$,\s%]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === "";
}

export function extractYieldInput(value: unknown): YieldInputFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  // the marketplace client sends { kind: "data", data: { input: {...} } }, so
  // an "input" wrapper is unwrapped; a bare data object is read directly
  const nested = record.input;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : record;

  const out: YieldInputFields = {};
  for (const [key, raw] of Object.entries(source)) {
    const field = INPUT_ALIASES[key.toLowerCase().replace(/[\s_-]/g, "")];
    if (!field || out[field] !== undefined) continue;
    if (field === "compoundingPerYear") {
      const periods = toNumber(raw);
      if (periods !== undefined && isIntegerInRange(periods, MIN_COMPOUNDING_PER_YEAR, MAX_COMPOUNDING_PER_YEAR)) {
        out.compoundingPerYear = periods;
      } else if (!isBlank(raw)) {
        out.compoundingInvalid = true;
      }
      continue;
    }
    if (field === "feeBps") {
      const bps = toNumber(raw);
      if (bps !== undefined && isIntegerInRange(bps, 0, MAX_FEE_BPS)) {
        out.feeBps = bps;
      } else if (!isBlank(raw)) {
        out.feeInvalid = true;
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
// "principal 10000 at a gross APY of 12 with a 200 bps fee". Only explicitly
// labelled numbers are read, so an unlabelled figure is never treated as an
// input.
export function parseYieldText(task: string): YieldInputFields {
  const out: YieldInputFields = {};
  const principal = labelledNumber(task, "\\bprincipal(?:\\s+usd|\\s+amount)?");
  if (principal !== undefined) out.principalUsd = principal;
  const gross = labelledNumber(task, "\\b(?:gross\\s+)?(?:apy|apr)\\b");
  if (gross !== undefined) out.grossApyPercent = gross;
  const compounding = labelledNumber(task, "\\bcompounding(?:\\s+per\\s+year)?\\b");
  if (compounding !== undefined) out.compoundingPerYear = compounding;
  const fee = labelledNumber(task, "\\bfee(?:\\s+bps|\\s+basis\\s+points)?\\b");
  if (fee !== undefined) out.feeBps = fee;
  return out;
}

export function mergeYieldInput(
  input: Record<string, unknown> | undefined,
  task: string,
): YieldInputFields {
  // structured input wins over text when both name the same field
  return { ...parseYieldText(task), ...extractYieldInput(input) };
}

export function computeNetYield(input: NetYieldInput): NetYieldResult {
  const { principalUsd, grossApyPercent, compoundingPerYear, feeBps } = input;
  const periodicRate = grossApyPercent / 100 / compoundingPerYear;
  const effectiveAnnualRate = (1 + periodicRate) ** compoundingPerYear - 1;
  const feeFraction = feeBps / 10000;
  const netRate = effectiveAnnualRate - feeFraction;
  // the state is decided on the exact net rate, before rounding, so a value
  // that rounds to zero is still reported as fee-dominated
  const state: NetYieldState = netRate > 0 ? "net-positive" : "fee-dominated";

  return {
    ...input,
    effectiveAnnualRatePercent: round(effectiveAnnualRate * 100, 4),
    netRatePercent: round(netRate * 100, 4),
    feeDragPercent: round(feeFraction * 100, 4),
    projectedEarningsUsd: round(principalUsd * netRate, 2),
    state,
  };
}

const FORMULA =
  "effectiveAnnualRate = (1 + grossApyPercent / 100 / compoundingPerYear) ^ compoundingPerYear - 1; netRate = effectiveAnnualRate - feeBps / 10000; projectedEarningsUsd = principalUsd * netRate";

function answerText(result: NetYieldResult): string {
  if (result.state === "fee-dominated") {
    return `Fee-dominated: the effective annual rate of ${result.effectiveAnnualRatePercent}% does not cover the ${result.feeDragPercent} point fee, so the net rate is ${result.netRatePercent}% per year and the projected one year earnings are ${result.projectedEarningsUsd} USD on a principal of ${result.principalUsd} USD. Gross APY ${result.grossApyPercent}% compounded ${result.compoundingPerYear} times per year. State: fee-dominated. This is deterministic arithmetic on the rate you supplied, with no market data, so you can reproduce every figure.`;
  }
  return `Net rate ${result.netRatePercent}% per year on a principal of ${result.principalUsd} USD, from a gross APY of ${result.grossApyPercent}% compounded ${result.compoundingPerYear} times per year, after a fee of ${result.feeBps} basis points (${result.feeDragPercent} percentage points). The effective annual rate before the fee is ${result.effectiveAnnualRatePercent}%, and the projected one year earnings are ${result.projectedEarningsUsd} USD. State: net-positive. This is deterministic arithmetic on the rate you supplied, with no market data, so you can reproduce every figure.`;
}

function resultArtifact(result: NetYieldResult): Record<string, unknown> {
  return {
    capability: "yield",
    action: "compute_net_yield",
    formula: FORMULA,
    inputs: {
      principalUsd: result.principalUsd,
      grossApyPercent: result.grossApyPercent,
      compoundingPerYear: result.compoundingPerYear,
      feeBps: result.feeBps,
      principalUnit: "USD",
      rateUnit: "percent per year",
      feeUnit: "basis points",
    },
    result: {
      effectiveAnnualRatePercent: result.effectiveAnnualRatePercent,
      netRatePercent: result.netRatePercent,
      feeDragPercent: result.feeDragPercent,
      projectedEarningsUsd: result.projectedEarningsUsd,
      state: result.state,
    },
    assumptions: [
      "The principal and the gross annual rate are supplied by the caller.",
      "The gross annual rate is nominal and is compounded compoundingPerYear times per year to give the effective annual rate.",
      "The fee in basis points is deducted from the effective annual rate, and the projected earnings use the net rate.",
      "No market yield or on-chain data is fetched, so every figure is reproducible from the inputs.",
    ],
    readOnly: true,
  };
}

export function capabilityText(): string {
  return `Souk Yield Lens computes the net yield of a deposit from values you supply: a principal in USD, a gross annual rate (APY) you choose, an optional compounding frequency and an optional fee in basis points. It returns the effective annual rate after compounding, the net rate after the fee, the fee drag in percentage points and the projected earnings over one year. The arithmetic is deterministic and uses no market data, so you supply the rate and can reproduce every figure. Send the values as a data part, for example { kind: "data", data: { input: { principalUsd: 10000, grossApyPercent: 12, compoundingPerYear: 12, feeBps: 200 } } }.`;
}

export function capabilityArtifact(): Record<string, unknown> {
  return {
    capability: "yield",
    action: "compute_net_yield",
    status: "ok",
    required: ["principalUsd", "grossApyPercent"],
    optional: ["compoundingPerYear", "feeBps"],
    formula: FORMULA,
    defaults: {
      compoundingPerYear: DEFAULT_COMPOUNDING_PER_YEAR,
      feeBps: DEFAULT_FEE_BPS,
      minCompoundingPerYear: MIN_COMPOUNDING_PER_YEAR,
      maxCompoundingPerYear: MAX_COMPOUNDING_PER_YEAR,
      maxFeeBps: MAX_FEE_BPS,
    },
    example: {
      kind: "data",
      data: { input: { principalUsd: 10000, grossApyPercent: 12, compoundingPerYear: 12, feeBps: 200 } },
    },
    limitations: [
      "The caller supplies the rate; this agent does not read market yields.",
      "The result is a read-only calculation and never a transaction.",
    ],
  };
}

function inputRequiredText(missing: string[], problems: string[]): string {
  const lines = ["I cannot compute a net yield yet, and I will not guess the missing values."];
  if (missing.length) {
    lines.push(
      `Provide ${missing.join(" and ")}. The net yield needs the principal you are depositing and the gross annual rate you want to evaluate.`,
    );
  }
  if (problems.length) lines.push(`Fix: ${problems.join("; ")}.`);
  lines.push(
    `Send them as a data part, for example { kind: "data", data: { input: { principalUsd: 10000, grossApyPercent: 12, compoundingPerYear: 12, feeBps: 200 } } }. principalUsd is a USD amount greater than zero and grossApyPercent is a yearly rate in percent, zero or greater; compoundingPerYear is an optional integer from 1 to 365 and feeBps is an optional integer from 0 to 10000.`,
  );
  return lines.join(" ");
}

function inputRequiredArtifact(
  fields: YieldInputFields,
  missing: string[],
  problems: string[],
): Record<string, unknown> {
  return {
    capability: "yield",
    action: "compute_net_yield",
    status: "input-required",
    required: ["principalUsd", "grossApyPercent"],
    missing,
    problems,
    received: {
      principalUsd: fields.principalUsd ?? null,
      grossApyPercent: fields.grossApyPercent ?? null,
      compoundingPerYear: fields.compoundingPerYear ?? null,
      feeBps: fields.feeBps ?? null,
    },
    expected: {
      principalUsd: "a USD amount greater than zero",
      grossApyPercent: "a yearly rate in percent, zero or greater",
      compoundingPerYear: "optional integer from 1 to 365",
      feeBps: "optional integer from 0 to 10000",
    },
    example: {
      kind: "data",
      data: { input: { principalUsd: 10000, grossApyPercent: 12, compoundingPerYear: 12, feeBps: 200 } },
    },
    note: "Nothing is inferred from partial values.",
  };
}

export interface ReferenceYieldReply {
  state: "completed" | "input-required";
  text: string;
  artifact: Record<string, unknown>;
}

const YIELD_INTENT =
  /yield|\bapy\b|\bapr\b|compound|principal|interest|\bearn\b|staking|deposit|return/i;

export function decideReferenceYieldTask(
  task: string,
  input?: Record<string, unknown>,
): ReferenceYieldReply {
  const fields = mergeYieldInput(input, task);
  const hasPrincipal = fields.principalUsd !== undefined;
  const hasGross = fields.grossApyPercent !== undefined;
  const wantsYield = YIELD_INTENT.test(task) || hasPrincipal || hasGross;

  // a benign status or capability question is answered directly, not treated as
  // a request that is missing inputs
  if (!wantsYield) {
    return { state: "completed", text: capabilityText(), artifact: capabilityArtifact() };
  }

  const missing: string[] = [];
  const problems: string[] = [];
  if (!hasPrincipal) missing.push("principalUsd");
  else if (!((fields.principalUsd as number) > 0)) {
    problems.push("principalUsd must be greater than zero");
  }
  if (!hasGross) missing.push("grossApyPercent");
  else if (!((fields.grossApyPercent as number) >= 0)) {
    problems.push("grossApyPercent must be zero or greater");
  }
  if (fields.compoundingInvalid && fields.compoundingPerYear === undefined) {
    problems.push("compoundingPerYear must be an integer from 1 to 365");
  }
  if (fields.feeInvalid && fields.feeBps === undefined) {
    problems.push("feeBps must be an integer from 0 to 10000");
  }

  if (missing.length || problems.length) {
    return {
      state: "input-required",
      text: inputRequiredText(missing, problems),
      artifact: inputRequiredArtifact(fields, missing, problems),
    };
  }

  const result = computeNetYield({
    principalUsd: fields.principalUsd as number,
    grossApyPercent: fields.grossApyPercent as number,
    compoundingPerYear: fields.compoundingPerYear ?? DEFAULT_COMPOUNDING_PER_YEAR,
    feeBps: fields.feeBps ?? DEFAULT_FEE_BPS,
  });
  return { state: "completed", text: answerText(result), artifact: resultArtifact(result) };
}
