// A generic on-chain job seller hosted on the API, so escrow can be tested end
// to end without a separate deployment. It declares the ERC-8183 job protocol
// (negotiate + notify_funded), produces a signed quote, and submits a
// deliverable on chain when funded. Category-specific agents reuse this module
// with a different name, token id and deliverable logic.

import { privateEndpointReason } from "./endpoint";

export const JOB_SELLER_AGENT_NAME = "Souk Job Seller";
export const JOB_SELLER_AGENT_VERSION = "1.0.0";
export const JOB_SELLER_AGENT_CATEGORY = "grid-trading";
export const JOB_SELLER_AGENT_DESCRIPTION =
  "A generic ERC-8183 job seller: it negotiates a signed quote in the kernel's payment token and, once funded, plans the requested work and submits the deliverable on chain for the optimistic dispute window to release.";

export const JOB_SELLER_AGENT_PUBLIC_ORIGIN = "https://api.agentsouk.xyz";
export const JOB_SELLER_CARD_PATH = "/api/reference/job-seller/.well-known/agent-card.json";
export const JOB_SELLER_MESSAGING_PATH = "/api/reference/job-seller/a2a";

export interface JobSellerReply {
  state: "completed" | "input-required";
  text: string;
  artifact: Record<string, unknown>;
}

const NEGOTIATE_SKILL = {
  id: "negotiate",
  name: "Negotiate an ERC-8183 job",
  description:
    "ERC-8183 job selling: answers a negotiate step with a wallet-signed quote priced in the kernel's payment token, naming this listing's registered wallet as provider.",
  tags: ["erc-8183", "job", "negotiate", "quote"],
  examples: ["Negotiate a job for 10 USD"],
  inputModes: ["text/plain", "application/json"],
  outputModes: ["text/plain", "application/json"],
};

const NOTIFY_SKILL = {
  id: "notify_funded",
  name: "Work a funded ERC-8183 job",
  description:
    "ERC-8183 job selling: on notify_funded the kernel's own row is read back to confirm this listing is the funded job's provider, the work is planned from the job's own description, and the deliverable is submitted on chain for the optimistic dispute window to release.",
  tags: ["erc-8183", "job", "notify_funded", "deliver"],
  examples: ["Work the funded job"],
  inputModes: ["text/plain", "application/json"],
  outputModes: ["text/plain", "application/json"],
};

export function jobSellerPickPublicOrigin(candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? "").trim().replace(/\/+$/, "");
    if (trimmed && privateEndpointReason(trimmed) === null) return trimmed;
  }
  return JOB_SELLER_AGENT_PUBLIC_ORIGIN;
}

export function jobSellerMessagingUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${JOB_SELLER_MESSAGING_PATH}`;
}

export function jobSellerAgentCard(origin: string, name = JOB_SELLER_AGENT_NAME) {
  const base = origin.replace(/\/+$/, "");
  const messagingUrl = jobSellerMessagingUrl(base);
  return {
    name,
    description: JOB_SELLER_AGENT_DESCRIPTION,
    version: JOB_SELLER_AGENT_VERSION,
    url: messagingUrl,
    protocolVersion: "0.3.0",
    provider: { organization: "Agent Souk", url: base },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "plan-task",
        name: "Plan a task",
        description: "Plans the requested task and returns a deliverable the buyer can verify.",
        tags: ["task", "plan", "deliverable"],
        examples: ["Plan a grid ladder for 10000 USD between 250 and 320"],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/plain", "application/json"],
      },
      NEGOTIATE_SKILL,
      NOTIFY_SKILL,
    ],
    supportedInterfaces: [{ url: messagingUrl, transport: "JSONRPC" }],
  };
}

export function decideJobSellerTask(task: string, input?: Record<string, unknown>): JobSellerReply {
  const t = (task || "").trim() || "the requested task";
  const text = `Job seller deliverable for: ${t}. Plan produced and submitted on chain; the buyer can verify and release after the dispute window.`;
  return {
    state: "completed",
    text,
    artifact: {
      capability: "job-seller",
      action: "plan_task",
      status: "ok",
      task: t,
      input: input ?? {},
      deliverable: text,
      readOnly: false,
    },
  };
}

export function jobSellerTokenId(chainId: number): number | null {
  // filled in after registration; null until then (quote carries no agent id)
  return null;
}