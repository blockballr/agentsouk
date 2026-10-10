import "server-only";

import { privateEndpointReason } from "./endpoint";
import { fetchMcpSkills } from "./mcp-skills";
import type { AgentCardSkill } from "./types";

// What an agent declares about how it is called, read at admission so any
// listing, third-party ones the sweep picks up included, can show it without a
// fetch per view. Both protocols carry it: an A2A agent in its card, an MCP
// agent in the tools its server lists, so one is read and then the other.
// Self-contained on purpose: scanner imports this, and routing it through
// delivery would make scanner and delivery circular and drag the whole
// settlement stack into every browse test.
export async function captureAgentSkills(agent: {
  mcp_server?: string | null;
  a2a_endpoint?: string | null;
}): Promise<AgentCardSkill[] | null> {
  const card = agent.a2a_endpoint;
  if (card && !privateEndpointReason(card)) {
    const fromCard = await readCardSkills(card);
    if (fromCard) return fromCard;
  }
  if (!agent.mcp_server) return null;
  return await fetchMcpSkills(agent.mcp_server);
}

// the card read, kept local to this module for the reason above
async function readCardSkills(endpoint: string): Promise<AgentCardSkill[] | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(endpoint, {
      headers: { accept: "application/json" },
      signal: ctl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const body = (await res.json()) as { skills?: AgentCardSkill[] };
    return body.skills?.length ? body.skills : null;
  } catch {
    return null;
  }
}
