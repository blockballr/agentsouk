import type { AgentSummary } from "./types";
import { isTeamWallet } from "./team-wallets";

// "Working first" serves the agents that answered their last check in a rotating order,
// so the working agents share the top of each category rather than the highest score
// keeping it for every visitor; the tiers below keep score order, so a broken agent never
// moves ahead of a working one

const RANK: Record<string, number> = {
  online: 5,
  gated: 4,
  // the shelf's legend orders the states by what they cost a buyer, so reachability
  // is not "unknown beats known bad": an unchecked listing sits below the ones we
  // have measured, in the order the legend prints
  unreachable: 3,
  dead: 2,
  unchecked: 1,
};

type Verifications = Map<string, { status?: string }> | undefined;

// the visitor's own seed keeps paging stable through one visit; a caller that sends none,
// such as an MCP client, gets an order that turns over every hour
export function rotationSeed(seed: string | null | undefined, now: number = Date.now()): string {
  return seed && /^[A-Za-z0-9_-]{1,64}$/.test(seed) ? seed : `hour-${Math.floor(now / 3_600_000)}`;
}

// FNV-1a over the seed and the token, the same on every instance, then murmur3's finaliser,
// without which neighbouring token ids lead far more often than their share
function rotationKey(seed: string, tokenId: string): number {
  let h = 0x811c9dc5;
  const text = `${seed}:${tokenId}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h;
}

// reachability on its own, with no opinion on order inside a rank. a caller that
// wants the chosen metric to decide within a reachability rank leads with this and
// only falls back to the fuller compare when nothing else separates the two
export function reachabilityRankCompare(a: AgentSummary, b: AgentSummary, verifications: Verifications): number {
  const rank = (x: AgentSummary) => RANK[verifications?.get(x.token_id)?.status ?? "unchecked"] ?? RANK.unchecked;
  return rank(b) - rank(a);
}

// reachability as an ordering of two agents, so it can sit as one link in a
// chain of metrics rather than only owning a whole sort
export function reachabilityCompare(
  a: AgentSummary,
  b: AgentSummary,
  verifications: Verifications,
  seed: string,
): number {
  const rank = (x: AgentSummary) => RANK[verifications?.get(x.token_id)?.status ?? "unchecked"] ?? RANK.unchecked;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return rb - ra;
  // no rotating draw: keep the order deterministic so the same agent does not
  // shuffle to a different spot on every visit
  return b.total_score - a.total_score || b.total_feedbacks - a.total_feedbacks || a.token_id.localeCompare(b.token_id);
}

export function workingFirst(items: AgentSummary[], verifications: Verifications, seed: string): AgentSummary[] {
  return [...items].sort((a, b) => reachabilityCompare(a, b, verifications, seed));
}

// the brief asks for three agents per category, so a house agent leaves a category only
// once that many working agents of other owners are there to take its place
export const MIN_THIRD_PARTY_WORKING = 3;

// HOUSE_AGENTS_LISTED=0 takes the team's own agents off the shelf; their pages and endpoints
// stay up for anyone holding a link, and unset, everything is listed as before
export function withoutHouseAgents(
  shelf: AgentSummary[],
  verifications: Verifications,
  env: Record<string, string | undefined> = process.env,
): AgentSummary[] {
  if (env.HOUSE_AGENTS_LISTED !== "0") return shelf;
  const working = new Map<string, number>();
  for (const a of shelf) {
    if (isTeamWallet(a.owner_address) || verifications?.get(a.token_id)?.status !== "online") continue;
    const key = a.category ?? "general";
    working.set(key, (working.get(key) ?? 0) + 1);
  }
  return shelf.filter(
    (a) => !isTeamWallet(a.owner_address) || (working.get(a.category ?? "general") ?? 0) < MIN_THIRD_PARTY_WORKING,
  );
}
