import "server-only";

import { privateEndpointReason } from "./endpoint";
import type { AgentCardSkill } from "./types";

// What an agent declares about how it is called, read at admission so any
// listing, third-party ones the sweep picks up included, can show it without a
// fetch per view. Self-contained on purpose: scanner imports this, and routing it
// through delivery would make scanner and delivery circular and drag the whole
// settlement stack into every browse test.
export async function captureAgentSkills(agent: {
  mcp_server?: string | null;
  a2a_endpoint?: string | null;
}): Promise<AgentCardSkill[] | null> {
  const card = agent.a2a_endpoint;
  if (!card || privateEndpointReason(card)) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(card, {
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
