// Souk Escrow Keeper: plans an escrow deal the caller supplies and refuses to
// guess what it is not given. The marketplace's own hire flow funds, verifies
// and then releases a payment after a dispute window; this agent turns those
// same terms into a plan the buyer and seller can agree on before anyone pays:
// what is held, what the fee takes, what each milestone pays, how much stays
// in the buffer, and when the release lands. It is deterministic arithmetic on
// the figures the caller supplies, with no chain writes and no market data.

import { privateEndpointReason } from "./endpoint";

export const ESCROW_KEEPER_AGENT_NAME = "Souk Escrow Keeper";
export const ESCROW_KEEPER_AGENT_VERSION = "1.0.0";
export const ESCROW_KEEPER_AGENT_CATEGORY = "escrow";
export const ESCROW_KEEPER_AGENT_DESCRIPTION =
  "Plans an escrow deal: an amount to hold, an optional service fee in basis points, an optional dispute window in hours, and optional milestone payments. It returns what is held, the fee and the net payable, how the milestones allocate the held amount and what buffer remains, and the timeline from funding through the dispute window to the release. The arithmetic is deterministic on the figures the caller supplies, so both sides can reproduce the plan before funding it.";
export const ESCROW_KEEPER_AGENT_PUBLIC_ORIGIN = "https://api.agentsouk.xyz";
export const ESCROW_KEEPER_CARD_PATH = "/api/reference/escrow/.well-known/agent-card.json";
export const ESCROW_KEEPER_MESSAGING_PATH = "/api/reference/escrow/a2a";

export const ESCROW_DEFAULT_FEE_BPS = 0;
export const ESCROW_DEFAULT_DISPUTE_WINDOW_HOURS = 72;
export const ESCROW_MAX_FEE_BPS = 10000;
export const ESCROW_MAX_DISPUTE_WINDOW_HOURS = 24 * 365;
export const ESCROW_MAX_MILESTONES = 50;

export const ESCROW_FORMULA =
  "netPayableUsd = heldUsd - heldUsd * feeBps / 10000; bufferUsd = heldUsd - allocatedUsd; releaseAtHour = disputeWindowHours";

export interface EscrowAgentSkill {
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

export interface EscrowAgentCard {
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
  skills: EscrowAgentSkill[];
  supportedInterfaces: { url: string; transport: string }[];
}

// The card must never name a private or loopback address, so a configured origin
// is used only when it passes the marketplace's own check; otherwise the
// deployed api origin wins.
export function escrowKeeperPickPublicOrigin(
  candidates: (string | null | undefined)[],
): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? "").trim().replace(/\/+$/, "");
    if (trimmed && privateEndpointReason(trimmed) === null) return trimmed;
  }
  return ESCROW_KEEPER_AGENT_PUBLIC_ORIGIN;
}

export function escrowKeeperMessagingUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${ESCROW_KEEPER_MESSAGING_PATH}`;
}

export function escrowKeeperAgentCard(origin: string): EscrowAgentCard {
  const base = origin.replace(/\/+$/, "");
  const messagingUrl = escrowKeeperMessagingUrl(base);
  return {
    name: ESCROW_KEEPER_AGENT_NAME,
    description: ESCROW_KEEPER_AGENT_DESCRIPTION,
    version: ESCROW_KEEPER_AGENT_VERSION,
    url: messagingUrl,
    protocolVersion: "0.3.0",
    provider: { organization: "Agent Souk", url: base },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "plan_escrow",
        name: "Escrow deal plan",
        description:
          "Plans an escrow deal and reports what is held, the fee and net payable, the milestone allocation and remaining buffer, and the timeline from funding through the dispute window to the release. Read-only deterministic arithmetic on the figures you supply, with no chain writes and no market data.",
        tags: ["escrow", "escrow-plan", "milestones", "dispute-window", "payment"],
        examples: [
          "Plan an escrow of 1000 with a 250 basis point fee, a 72 hour dispute window, and milestones 400 600",
          "How would 500 be held if released in milestones of 250 and 250",
        ],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
        inputSchema: {
          type: "object",
          properties: {
            amountUsd: { type: "number", description: "the amount placed under escrow in USD" },
            feeBps: { type: "number", description: "optional service fee in basis points, defaults to 0" },
            disputeWindowHours: {
              type: "number",
              description: "optional dispute window in hours from verified delivery to release, defaults to 72",
            },
            milestones: {
              type: "array",
              description: "optional milestone payments in USD; each must be positive and together cannot exceed the amount",
            },
          },
          required: ["amountUsd"],
          examples: [
            { amountUsd: 1000, feeBps: 250, disputeWindowHours: 72, milestones: [400, 600] },
          ],
        },
        outputSchema: {
          type: "object",
          properties: {
            heldUsd: { type: "number", description: "the amount held under escrow" },
            feeCostUsd: { type: "number", description: "the service fee charged at release" },
            netPayableUsd: { type: "number", description: "the held amount after the fee" },
            milestoneCount: { type: "number", description: "how many milestones are planned" },
            allocatedUsd: { type: "number", description: "the sum of the milestone payments" },
            bufferUsd: { type: "number", description: "what stays held until the deal closes" },
            disputeEndHour: { type: "number", description: "the hour the dispute window ends" },
            releaseAtHour: { type: "number", description: "the hour the release lands" },
            state: { type: "string", description: "exact when the milestones allocate everything, buffer-held otherwise" },
          },
        },
      },
    ],
    supportedInterfaces: [{ url: messagingUrl, transport: "JSONRPC" }],
  };
}

export interface EscrowInput {
  amountUsd: number;
  feeBps: number;
  disputeWindowHours: number;
  milestones: number[];
}

export interface EscrowResult {
  amountUsd: number;
  feeBps: number;
  disputeWindowHours: number;
  milestones: number[];
  heldUsd: number;
  feeCostUsd: number;
  netPayableUsd: number;
  milestoneCount: number;
  allocatedUsd: number;
  bufferUsd: number;
  disputeEndHour: number;
  releaseAtHour: number;
  state: "exact" | "buffer-held";
}

export interface EscrowFields {
  amountUsd?: number;
  feeBps?: number;
  disputeWindowHours?: number;
  milestones?: number[];
}

const ALIASES: Record<string, keyof EscrowFields> = {
  amountusd: "amountUsd",
  amount: "amountUsd",
  total: "amountUsd",
  held: "amountUsd",
  price: "amountUsd",
  feebps: "feeBps",
  fee: "feeBps",
  disputewindowhours: "disputeWindowHours",
  dispute: "disputeWindowHours",
  window: "disputeWindowHours",
  milestones: "milestones",
};

function round(value: number, digits = 2): number {
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

function toMilestones(value: unknown): number[] | undefined {
  const list =
    Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[,\s]+/).filter(Boolean)
        : undefined;
  if (!list) return undefined;
  const nums = list.map(toNumber).filter((n): n is number => n !== undefined);
  return nums.length ? nums : undefined;
}

export function extractEscrowInput(value: unknown): EscrowFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const nested = record.input;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : record;
  const out: EscrowFields = {};
  for (const [key, raw] of Object.entries(source)) {
    const field = ALIASES[key.toLowerCase().replace(/[\s_-]/g, "")];
    if (!field || out[field] !== undefined) continue;
    if (field === "milestones") {
      const milestones = toMilestones(raw);
      if (milestones) out.milestones = milestones;
      continue;
    }
    const parsed = toNumber(raw);
    if (parsed !== undefined) out[field] = parsed;
  }
  return out;
}

export function mergeEscrowInput(
  input: Record<string, unknown> | undefined,
  task: string,
): EscrowFields {
  const fromTask: EscrowFields = {};
  const amount = /(?:escrow|amount|total|held|deal)(?:\s+(?:of|is))?[\s:=-]{0,3}(-?\d[\d,]*(?:\.\d+)?)/i.exec(task);
  const fee = /fee[^0-9-]{0,20}(\d+)\s*(?:bps|basis points)/i.exec(task);
  const window =
    /(?:window|dispute)[^0-9-]{0,40}\s*(\d+)\s*hours?/i.exec(task) ??
    /(\d+)\s*hours?\b/i.exec(task);
  const milestoneText = /milestones?[^0-9-]{0,24}((?:\d[\d,]*(?:\.\d+)?[\s,]*)+)/i.exec(task);
  if (amount) fromTask.amountUsd = toNumber(amount[1]);
  if (fee) fromTask.feeBps = toNumber(fee[1]);
  if (window) fromTask.disputeWindowHours = toNumber(window[1]);
  if (milestoneText) {
    const milestones = toMilestones(milestoneText[1]);
    if (milestones) fromTask.milestones = milestones;
  }
  return { ...fromTask, ...extractEscrowInput(input) };
}

// The plan in one pass: the fee is a single cut at release, milestones pay out
// of the gross, and whatever the milestones do not allocate stays held in the
// buffer until the deal closes.
export function planEscrow(input: EscrowInput): EscrowResult {
  const { amountUsd, feeBps, disputeWindowHours, milestones } = input;
  const heldUsd = round(amountUsd);
  const feeCostUsd = round(heldUsd * (feeBps / 10000));
  const allocatedUsd = round(milestones.reduce((sum, m) => sum + m, 0));
  return {
    amountUsd,
    feeBps,
    disputeWindowHours,
    milestones,
    heldUsd,
    feeCostUsd,
    netPayableUsd: round(heldUsd - feeCostUsd),
    milestoneCount: milestones.length,
    allocatedUsd,
    bufferUsd: round(heldUsd - allocatedUsd),
    disputeEndHour: disputeWindowHours,
    releaseAtHour: disputeWindowHours,
    state: milestones.length > 0 && allocatedUsd === heldUsd ? "exact" : "buffer-held",
  };
}

function stateLabel(result: EscrowResult): string {
  if (result.milestoneCount === 0) return "buffer-held, no milestones were planned";
  return result.state === "exact"
    ? "exact, the milestones allocate the whole amount"
    : "buffer-held, the unallocated share stays held until the deal closes";
}

export function answerText(result: EscrowResult): string {
  const focus =
    result.milestoneCount > 0
      ? ` The ${result.milestoneCount} milestones allocate ${result.allocatedUsd} USD, so the buffer stays at ${result.bufferUsd} USD.`
      : ` No milestones were planned, so the whole ${result.heldUsd} USD stays held until the deal closes.`;
  return `Escrow plan over ${result.heldUsd} USD at a ${result.feeBps} basis point fee: the fee takes ${result.feeCostUsd} USD at release and the net payable to the seller is ${result.netPayableUsd} USD.${focus} The dispute window runs ${result.disputeWindowHours} hours from verified delivery, so the dispute ends at hour ${result.disputeEndHour} and the release lands at hour ${result.releaseAtHour}. State: ${stateLabel(result)}. This is arithmetic on the figures you supplied, with no chain writes and no market data, so both sides can reproduce it.`;
}

export function resultArtifact(result: EscrowResult): Record<string, unknown> {
  return {
    capability: ESCROW_KEEPER_AGENT_CATEGORY,
    action: "plan_escrow",
    formula: ESCROW_FORMULA,
    inputs: {
      amountUsd: result.amountUsd,
      feeBps: result.feeBps,
      disputeWindowHours: result.disputeWindowHours,
      milestoneCount: result.milestones.length,
      milestones: result.milestones,
      currency: "USD",
    },
    result: {
      heldUsd: result.heldUsd,
      feeCostUsd: result.feeCostUsd,
      netPayableUsd: result.netPayableUsd,
      milestoneCount: result.milestoneCount,
      allocatedUsd: result.allocatedUsd,
      bufferUsd: result.bufferUsd,
      disputeEndHour: result.disputeEndHour,
      releaseAtHour: result.releaseAtHour,
      state: result.state,
    },
    timeline: [
      { at: 0, milestone: "fund", what: "the full amount is placed under escrow" },
      { at: 0, milestone: "deliver", what: "the seller delivers against the milestones" },
      { at: result.disputeEndHour, milestone: "dispute-ends", what: "the dispute window closes without an open dispute" },
      { at: result.releaseAtHour, milestone: "release", what: `the held amount releases net of the ${result.feeBps} basis point fee` },
    ],
    assumptions: [
      "The amount, fee, window and milestones are supplied by the caller; nothing is fetched.",
      "The fee is one cut taken at release, not per milestone.",
      "A refund is possible until verified delivery; after that the dispute window is what stands.",
    ],
    readOnly: true,
  };
}

export interface EscrowKeeperReply {
  state: "completed" | "input-required";
  text: string;
  artifact: Record<string, unknown>;
}

const ESCROW_INTENT =
  /escrow|escrowed|hold|held|release|milestone|dispute|arbitrat|paymaster|terms/i;

export function decideEscrowKeeperTask(
  task: string,
  input?: Record<string, unknown>,
): EscrowKeeperReply {
  const fields = mergeEscrowInput(input ?? ({} as Record<string, unknown>), task);
  const wantsPlan =
    ESCROW_INTENT.test(task) ||
    fields.amountUsd !== undefined ||
    fields.milestones !== undefined ||
    fields.disputeWindowHours !== undefined;

  if (!wantsPlan) {
    return { state: "completed", text: capabilityText(), artifact: capabilityArtifact() };
  }

  const missing: string[] = [];
  const problems: string[] = [];
  if (fields.amountUsd === undefined) missing.push("amountUsd");
  else if (!(fields.amountUsd > 0)) problems.push("amountUsd must be a positive number");
  if (
    fields.feeBps !== undefined &&
    !(fields.feeBps >= 0 && fields.feeBps <= ESCROW_MAX_FEE_BPS)
  ) {
    problems.push(`feeBps must be from 0 to ${ESCROW_MAX_FEE_BPS}`);
  }
  if (
    fields.disputeWindowHours !== undefined &&
    !(fields.disputeWindowHours >= 1 && fields.disputeWindowHours <= ESCROW_MAX_DISPUTE_WINDOW_HOURS)
  ) {
    problems.push(`disputeWindowHours must be from 1 to ${ESCROW_MAX_DISPUTE_WINDOW_HOURS}`);
  }
  if (fields.milestones) {
    const milestones = fields.milestones;
    if (milestones.length > ESCROW_MAX_MILESTONES) {
      problems.push(`milestones is capped at ${ESCROW_MAX_MILESTONES} payments`);
    }
    if (milestones.some((m) => !(m > 0))) {
      problems.push("every milestone must be a positive number");
    }
    if (fields.amountUsd !== undefined) {
      const allocated = milestones.reduce((sum, m) => sum + m, 0);
      if (allocated > fields.amountUsd + 1e-9) {
        problems.push(
          `the milestones sum to ${round(allocated)} USD, which exceeds the ${round(
            fields.amountUsd,
          )} USD escrow`,
        );
      }
    }
  }

  if (missing.length || problems.length) {
    return {
      state: "input-required",
      text: inputRequiredText(missing, problems),
      artifact: inputRequiredArtifact(fields, missing, problems),
    };
  }

  const result = planEscrow({
    amountUsd: fields.amountUsd as number,
    feeBps: fields.feeBps ?? ESCROW_DEFAULT_FEE_BPS,
    disputeWindowHours: fields.disputeWindowHours ?? ESCROW_DEFAULT_DISPUTE_WINDOW_HOURS,
    milestones: fields.milestones ?? [],
  });
  return { state: "completed", text: answerText(result), artifact: resultArtifact(result) };
}

export function capabilityText(): string {
  return `Souk Escrow Keeper plans an escrow deal: an amount to hold, an optional service fee in basis points, an optional dispute window in hours from verified delivery to release, and optional milestone payments. It returns what is held, the fee and the net payable, how the milestones allocate the held amount and what buffer remains, and the timeline from funding through the dispute window to the release. Send the figures as a data part, for example { kind: "data", data: { input: { amountUsd: 1000, feeBps: 250, disputeWindowHours: 72, milestones: [400, 600] } } }.`;
}

export function capabilityArtifact(): Record<string, unknown> {
  return {
    capability: ESCROW_KEEPER_AGENT_CATEGORY,
    action: "plan_escrow",
    status: "ok",
    required: ["amountUsd"],
    optional: ["feeBps", "disputeWindowHours", "milestones"],
    formula: ESCROW_FORMULA,
    defaults: {
      feeBps: ESCROW_DEFAULT_FEE_BPS,
      disputeWindowHours: ESCROW_DEFAULT_DISPUTE_WINDOW_HOURS,
      maxFeeBps: ESCROW_MAX_FEE_BPS,
      maxDisputeWindowHours: ESCROW_MAX_DISPUTE_WINDOW_HOURS,
      maxMilestones: ESCROW_MAX_MILESTONES,
    },
    example: {
      kind: "data",
      data: {
        input: {
          amountUsd: 1000,
          feeBps: 250,
          disputeWindowHours: 72,
          milestones: [400, 600],
        },
      },
    },
    limitations: [
      "This agent plans the terms; it does not fund, verify or release anything on chain.",
      "The dispute window is what the callers agree on here; the marketplace's own hire flow reads its window from the funder contract.",
    ],
  };
}

function inputRequiredText(missing: string[], problems: string[]): string {
  const lines = ["I cannot plan an escrow yet, and I will not guess the missing figures."];
  if (missing.length) {
    lines.push(
      `Provide ${missing.join(", ")}. A plan needs at least the amount to hold; feeBps, disputeWindowHours and milestones sharpen it.`,
    );
  }
  if (problems.length) lines.push(`Fix: ${problems.join("; ")}.`);
  lines.push(
    `Send them as a data part, for example { kind: "data", data: { input: { amountUsd: 1000, feeBps: 250, disputeWindowHours: 72, milestones: [400, 600] } } }. amountUsd is a positive number; feeBps is an optional integer from 0 to 10000; disputeWindowHours is an optional number from 1 to 8760; milestones is an optional list of positive payments that together cannot exceed the amount.`,
  );
  return lines.join(" ");
}

function inputRequiredArtifact(
  fields: EscrowFields,
  missing: string[],
  problems: string[],
): Record<string, unknown> {
  return {
    capability: ESCROW_KEEPER_AGENT_CATEGORY,
    action: "plan_escrow",
    status: "input-required",
    required: ["amountUsd"],
    optional: ["feeBps", "disputeWindowHours", "milestones"],
    missing,
    problems,
    received: {
      amountUsd: fields.amountUsd ?? null,
      feeBps: fields.feeBps ?? null,
      disputeWindowHours: fields.disputeWindowHours ?? null,
      milestoneCount: fields.milestones?.length ?? 0,
      milestones: fields.milestones ?? null,
    },
    expected: {
      amountUsd: "a positive USD amount",
      feeBps: "optional integer from 0 to 10000, defaults to 0",
      disputeWindowHours: "optional number from 1 to 8760, defaults to 72",
      milestones: "optional positive USD payments summing to the amount or less",
    },
    note: "Nothing is inferred from partial figures.",
  };
}
