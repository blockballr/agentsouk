// A token can be registered and owned while its shelf summary never landed: the
// confirm call failed, the ingest skipped it, or it was admitted before a change.
// This rebuilds the summary from the live record for tokens the house owns, and
// reports a token an owner deliberately delisted instead of fighting that choice.

import "server-only";
import {
  ENDPOINT_KINDS,
  LISTABLE_CATEGORIES,
  type EndpointKind,
  type ListableCategory,
  type RegistrationDraft,
} from "@agora/core";
import { firstPartyAgentsFor } from "./first-party-copy";
import { loadDelisted } from "./delist-store";
import { registryAddress } from "./registry-write";
import {
  admitConfirmedAgent,
  getAgentByToken,
  shelfHasToken,
  summaryFromRegistration,
} from "./scanner";
import { BSC_CHAIN_ID, type AgentDetail } from "./types";

export type ReconcileState = "present" | "admitted" | "delisted" | "failed";

export interface ReconcileRow {
  tokenId: string;
  name: string | null;
  state: ReconcileState;
  reason?: string;
}

function categoryFor(fallback: string | null): ListableCategory | null {
  const fromFile = (fallback ?? "").trim();
  if ((LISTABLE_CATEGORIES as readonly string[]).includes(fromFile)) {
    return fromFile as ListableCategory;
  }
  return null;
}

export async function admitHouseToken(
  chainId: number,
  tokenId: string,
  fallbackCategory: string | null,
): Promise<{ admitted: boolean; reason?: string }> {
  const detail = await getAgentByToken(chainId, tokenId);
  if (!detail) return { admitted: false, reason: "the registry did not answer for this token" };

  const category = categoryFor(fallbackCategory);
  if (!category) return { admitted: false, reason: "no shelf category for this token" };

  const kinds: EndpointKind[] = [];
  if (detail.web_endpoint) kinds.push("web");
  if (detail.a2a_endpoint) kinds.push("A2A");
  if (detail.mcp_server) kinds.push("MCP");
  const endpoint = detail.a2a_endpoint ?? detail.web_endpoint ?? detail.mcp_server ?? "";
  if (!endpoint) return { admitted: false, reason: "the token publishes no endpoint" };

  const draft: RegistrationDraft = {
    name: detail.name,
    description: detail.description ?? "",
    category,
    endpoint,
    endpointKinds: kinds.filter((k) => (ENDPOINT_KINDS as readonly string[]).includes(k)),
    ...(detail.image_url ? { image: detail.image_url } : {}),
    x402Support:
      detail.x402_supported ||
      (detail as unknown as AgentDetail).raw_metadata?.offchain_content?.x402Support === true,
    ...("agent_wallet" in detail && detail.agent_wallet ? { agentWallet: detail.agent_wallet } : {}),
  };

  const summary = summaryFromRegistration({
    chainId,
    tokenId,
    owner: detail.owner_address,
    registry: registryAddress(chainId),
    draft,
    createdAt: detail.created_at ?? new Date().toISOString(),
  });
  if (detail.a2a_endpoint) summary.a2a_endpoint = detail.a2a_endpoint;
  if (detail.mcp_server) summary.mcp_server = detail.mcp_server;

  const admission = await admitConfirmedAgent(summary);
  return admission.admitted ? { admitted: true } : { admitted: false, reason: admission.reason };
}

export async function reconcileFirstPartyShelf(chainId: number): Promise<ReconcileRow[]> {
  if (chainId !== BSC_CHAIN_ID) return [];
  const delisted = await loadDelisted().catch(() => new Set<string>());
  const rows: ReconcileRow[] = [];

  for (const agent of firstPartyAgentsFor(chainId)) {
    const tokenId = String(agent.tokenId);
    if (await shelfHasToken(chainId, tokenId)) {
      rows.push({ tokenId, name: agent.name ?? null, state: "present" });
      continue;
    }
    if (delisted.has(tokenId)) {
      rows.push({ tokenId, name: agent.name ?? null, state: "delisted" });
      continue;
    }
    const result = await admitHouseToken(chainId, tokenId, agent.category ?? null);
    rows.push({
      tokenId,
      name: agent.name ?? null,
      state: result.admitted ? "admitted" : "failed",
      ...(result.reason ? { reason: result.reason } : {}),
    });
  }
  return rows;
}
