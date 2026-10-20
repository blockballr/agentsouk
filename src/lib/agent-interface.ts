import "server-only";

import { privateEndpointReason } from "./endpoint";
import { fetchMcpSkills } from "./mcp-skills";
import type { AgentCardSkill } from "./types";

// What an agent declares about how it is called, read at admission so any
// listing, third-party ones the sweep picks up included, can show it without a
// fetch per view. Both protocols carry it: an A2A agent in its card, an MCP
// agent in the tools its server lists, so one is read and then the other. The
// card's access declaration rides along with the skills: a seller that gates
// its endpoint behind credentials it issues is labelled, since the marketplace
// holds none for it.
// Self-contained on purpose: scanner imports this, and routing it through
// delivery would make scanner and delivery circular and drag the whole
// settlement stack into every browse test.
export interface AgentInterface {
  skills: AgentCardSkill[] | null;
  accessGated: boolean;
}

export async function captureAgentSkills(agent: {
  mcp_server?: string | null;
  a2a_endpoint?: string | null;
  agent_url?: string | null;
  raw_metadata?: { offchain_uri?: string | null } | null;
}): Promise<AgentInterface | null> {
  // the card lives at the registry document (offchain_uri / agent_url), not
  // always at the a2a messaging endpoint, so prefer those when present
  const cardUrl =
    (typeof agent.agent_url === 'string' && agent.agent_url) ||
    (typeof agent.raw_metadata?.offchain_uri === 'string' && agent.raw_metadata.offchain_uri) ||
    agent.a2a_endpoint ||
    null;
  const card = cardUrl;
  if (card && !privateEndpointReason(card)) {
    const fromCard = await readCard(card);
    if (fromCard.skills) return fromCard;
    // a gated card is shown as gated even when it lists no skills of its own
    if (fromCard.accessGated) return fromCard;
  }
  if (!agent.mcp_server) return null;
  return { skills: await fetchMcpSkills(agent.mcp_server), accessGated: false };
}

// A card that declares its own access: the seller gates the endpoint behind
// credentials it issues, so the marketplace holds none and any call comes back
// in the seller's own words. The declaration is the signal; whether an
// unauthenticated call still slips through is the seller runtime's business.
export function cardRequiresAccess(card: unknown): boolean {
  if (!card || typeof card !== "object" || Array.isArray(card)) return false;
  const declared = card as { security?: unknown; securitySchemes?: unknown };
  const schemes = declared.securitySchemes;
  const declaresSchemes =
    Boolean(schemes) &&
    typeof schemes === "object" &&
    !Array.isArray(schemes) &&
    Object.keys(schemes as object).length > 0;
  const declaresSecurity = Array.isArray(declared.security)
    ? declared.security.length > 0
    : Boolean(declared.security) && typeof declared.security === "object";
  return declaresSchemes || declaresSecurity;
}

// the card read, kept local to this module for the reason above
async function readCard(endpoint: string): Promise<AgentInterface> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: ctl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { skills: null, accessGated: false };
    const body = (await res.json()) as { skills?: AgentCardSkill[] };
    return {
      skills: body.skills?.length ? body.skills : null,
      accessGated: cardRequiresAccess(body),
    };
  } catch {
    return { skills: null, accessGated: false };
  }
}
