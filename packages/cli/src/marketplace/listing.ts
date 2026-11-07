import { CliError } from "../core/errors";
import { apiRequest } from "../core/http";
import type { CliConfig } from "../core/config";
import { assertCallableEndpoint } from "./call";

export interface ListingDraft {
  name: string;
  description: string;
  category: string;
  endpoint: string;
  endpointKind?: string;
  endpointKinds?: string[];
  image?: string;
  agentWallet?: string;
  x402Support?: boolean;
  selfHosted?: boolean;
  ownUri?: string;
}

export interface CheckResult {
  ok: boolean;
  cardUrl: string | null;
  name: string | null;
  skills: number;
  detail: string;
}

// an A2A URL answers POST and refuses GET, so the card is derived from the
// documented well-known path when the endpoint is a messaging URL
export function cardUrlFor(endpoint: string): string {
  const url = assertCallableEndpoint(endpoint);
  if (url.pathname.endsWith(".json")) return url.toString();
  if (/\/a2a\/?$/.test(url.pathname)) {
    return `${url.origin}/.well-known/agent-card.json`;
  }
  return url.toString();
}

export async function checkListing(endpoint: string): Promise<CheckResult> {
  const candidates = [cardUrlFor(endpoint)];
  if (!candidates.includes(endpoint)) candidates.push(endpoint);
  let last = "no card answered";
  for (const candidate of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(candidate, { headers: { accept: "application/json" }, signal: controller.signal });
      if (!response.ok) {
        last = `${candidate} answered ${response.status}`;
        continue;
      }
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body.name !== "string") {
        last = `${candidate} is not a card (no name)`;
        continue;
      }
      const skills = Array.isArray(body.skills) ? body.skills.length : 0;
      return { ok: true, cardUrl: candidate, name: body.name, skills, detail: `card ok, ${skills} skills` };
    } catch (error) {
      last = `${candidate}: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, cardUrl: null, name: null, skills: 0, detail: last };
}

export interface PrepareResult {
  success?: boolean;
  claimId?: string;
  agentUri?: string;
  chainId?: number;
  registryAddress?: string;
  registerCalldata?: string;
  persistence?: string;
  error?: string;
}

export function validateDraft(draft: Partial<ListingDraft>): string[] {
  const errors: string[] = [];
  if (!draft.name || draft.name.trim().length < 2) errors.push("name is required");
  if (!draft.description || draft.description.trim().length < 20) errors.push("description needs at least 20 characters");
  if (!draft.category) errors.push("category is required");
  if (!draft.endpoint) errors.push("endpoint is required");
  return errors;
}

export async function prepareListing(
  config: CliConfig,
  draft: ListingDraft,
  options: { owner?: string; mode?: string } = {},
): Promise<PrepareResult> {
  const errors = validateDraft(draft);
  if (errors.length > 0) throw new CliError(errors[0], "draft_invalid", 2);
  return apiRequest<PrepareResult>(config.apiUrl, "/api/agents/register/prepare", {
    method: "POST",
    body: { draft, owner: options.owner, mode: options.mode ?? "call" },
    timeoutMs: 60_000,
  });
}

export interface ConfirmResult {
  success?: boolean;
  agentId?: string;
  listingUrl?: string;
  status?: string;
  error?: string;
  [key: string]: unknown;
}

export async function confirmListing(
  config: CliConfig,
  claimId: string,
  agentId: string,
  txHash: string,
): Promise<ConfirmResult> {
  return apiRequest<ConfirmResult>(config.apiUrl, "/api/agents/register/confirm", {
    method: "POST",
    body: { claimId, agentId, txHash },
    timeoutMs: 90_000,
  });
}
