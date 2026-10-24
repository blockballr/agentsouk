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
  // the agent's own entry price for a vault hire, when it declares one. the
  // vault floor still applies; this can only raise it.
  vaultMinDepositUsd: number | null;
}

export async function captureAgentSkills(agent: {
  mcp_server?: string | null;
  a2a_endpoint?: string | null;
  agent_url?: string | null;
  raw_metadata?: { offchain_uri?: string | null } | null;
}): Promise<AgentInterface | null> {
  // the card lives at the registry document (offchain_uri / agent_url), not
  // always at the a2a messaging endpoint, so prefer those when present. When only
  // a messaging URL is known (our house agents publish /a2a), derive the card
  // from it so the job-protocol skills are still read.
  const candidates: (string | null | undefined)[] = [
    typeof agent.agent_url === 'string' ? agent.agent_url : null,
    typeof agent.raw_metadata?.offchain_uri === 'string' ? agent.raw_metadata.offchain_uri : null,
    typeof agent.a2a_endpoint === 'string' ? agent.a2a_endpoint : null,
  ];
  // derive a card URL from a messaging URL
  for (const c of [...candidates]) {
    if (typeof c === 'string' && /\/a2a$/.test(c)) {
      candidates.push(c.replace(/\/a2a$/, '/.well-known/agent-card.json'));
    }
  }
  for (const cardUrl of candidates) {
    if (!cardUrl || privateEndpointReason(cardUrl) !== null) continue;
    const fromCard = await readCard(cardUrl);
    if (fromCard.skills) return fromCard;
    if (fromCard.accessGated) return fromCard;
  }
  if (!agent.mcp_server) return null;
  const skills = await fetchMcpSkills(agent.mcp_server);
  return { skills, accessGated: false, vaultMinDepositUsd: null };
}

// the card's own vault terms, when it publishes them. top level is the
// documented place; the skill entry is accepted too so an agent that put its
// terms beside the capability is not ignored.
export function cardVaultMinDeposit(card: unknown): number | null {
  if (!card || typeof card !== "object" || Array.isArray(card)) return null;
  const body = card as {
    vault?: { minDepositUsd?: unknown };
    skills?: { id?: unknown; name?: unknown; minDepositUsd?: unknown }[];
  };
  let raw = body.vault?.minDepositUsd;
  if (raw === undefined && Array.isArray(body.skills)) {
    const vaultSkill = body.skills.find((s) => {
      const id = typeof s?.id === "string" ? s.id : typeof s?.name === "string" ? s.name : "";
      return /^vault[-_]execution$/i.test(id.trim());
    });
    raw = vaultSkill?.minDepositUsd;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  // a card is a claim; a nonsensical entry is ignored rather than shown
  return Number.isFinite(value) && value > 0 && value <= 1_000_000 ? value : null;
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
    if (!res.ok) return { skills: null, accessGated: false, vaultMinDepositUsd: null };
    const body = (await res.json()) as { skills?: AgentCardSkill[] };
    return {
      skills: body.skills?.length ? body.skills : null,
      accessGated: cardRequiresAccess(body),
      vaultMinDepositUsd: cardVaultMinDeposit(body),
    };
  } catch {
    return { skills: null, accessGated: false, vaultMinDepositUsd: null };
  }
}
