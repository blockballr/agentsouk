import type { AgentSummary } from "./types";
import { isTeamWallet } from "./team-wallets";

// "Working first" serves the agents that delivered on their last check in a rotating order,
// so the working agents share the top of each category rather than the highest score
// keeping it for every visitor; the tiers below keep score order, so a broken agent never
// moves ahead of a working one

const RANK: Record<string, number> = { delivered: 4, gated: 3, dead: 2, unreachable: 1 };
const DELIVERED = RANK.delivered;

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

export function workingFirst(items: AgentSummary[], verifications: Verifications, seed: string): AgentSummary[] {
  const rank = (a: AgentSummary) => RANK[verifications?.get(a.token_id)?.status ?? ""] ?? 0;
  return [...items].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return rb - ra;
    if (ra === DELIVERED) {
      return rotationKey(seed, a.token_id) - rotationKey(seed, b.token_id) || a.token_id.localeCompare(b.token_id);
    }
    return b.total_score - a.total_score || b.total_feedbacks - a.total_feedbacks;
  });
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
    if (isTeamWallet(a.owner_address) || verifications?.get(a.token_id)?.status !== "delivered") continue;
    const key = a.category ?? "general";
    working.set(key, (working.get(key) ?? 0) + 1);
  }
  return shelf.filter(
    (a) => !isTeamWallet(a.owner_address) || (working.get(a.category ?? "general") ?? 0) < MIN_THIRD_PARTY_WORKING,
  );
}
