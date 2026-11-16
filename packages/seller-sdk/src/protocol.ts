import { keccak256, stringToHex } from "viem";

// the two data parts a buyer sends a job seller, named as the marketplace names them
const NEGOTIATE = /^negotiate(-erc8183-job)?$/i;
const NOTIFY = /^notify_funded$/i;

export function isNegotiateData(data: unknown): data is Record<string, unknown> & { skill: string } {
  return typeof data === "object" && data !== null && NEGOTIATE.test(String((data as Record<string, unknown>).skill ?? ""));
}

export function isNotifyData(data: unknown): data is { skill: string; job_id: unknown } {
  return typeof data === "object" && data !== null && NOTIFY.test(String((data as Record<string, unknown>).skill ?? ""));
}

export interface NegotiationInput {
  task: string;
  terms: unknown;
  provider: string;
  currency: string;
  /** the price in the payment token's smallest unit, as a decimal string */
  price: string;
  validUntil: number;
  agentId: number | null;
}

// one deterministic line per field, so a buyer can recompute the hash from the quote alone
// the marketplace checks this exact layout, so it must not change
export function negotiationMaterials(input: NegotiationInput): string {
  return [
    "ERC8183-NEGOTIATE-v1",
    input.provider.toLowerCase(),
    input.currency.toLowerCase(),
    input.price,
    String(input.validUntil),
    input.task,
    input.agentId === null ? "" : String(input.agentId),
    input.terms ? JSON.stringify(input.terms) : "",
  ].join("\n");
}

export function negotiationHashOf(input: NegotiationInput): `0x${string}` {
  return keccak256(stringToHex(negotiationMaterials(input)));
}
