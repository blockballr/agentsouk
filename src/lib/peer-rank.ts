// choosing an agent's closest peers from registry search results, and how
// complete each one's published card is. pure, so it can be tested without the
// registry

export interface PeerCandidate {
  token_id: string;
  chain_id: number;
  name: string;
  description: string | null;
  owner_address: string;
  x402_supported?: boolean;
  total_score?: number;
  total_feedbacks?: number;
  category?: string;
  categoryScores?: Record<string, number>;
}

export const PEER_SEARCH_TERMS: Record<string, string[]> = {
  rebalancing: ["rebalancing", "liquidity range", "concentrated liquidity", "tokenized stock"],
  "grid-trading": ["grid trading", "grid bot", "trading bot"],
  yield: ["yield optimizer", "yield", "staking"],
  "health-factor": ["health factor", "liquidation", "lending"],
};

const STOP = new Set(["agent", "the", "and", "for", "bot", "souk", "with", "ai", "on", "bnb", "chain"]);

// terms for the registry search: the category's own, else the name's longer words
export function searchTermsFor(category: string | undefined, name: string): string[] {
  const own = category ? PEER_SEARCH_TERMS[category] : undefined;
  if (own) return own;
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
    .slice(0, 3);
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

// a candidate scores for sharing the category, sharing description words, and
// taking paid calls the same way; same-owner listings and exact duplicates of a
// name are left out, since they are the subject again rather than an alternative
export function rankPeers(subject: PeerCandidate, candidates: PeerCandidate[], limit = 5): PeerCandidate[] {
  const subjectWords = words(`${subject.name} ${subject.description ?? ""}`);
  const seenNames = new Set([subject.name.trim().toLowerCase()]);
  const scored: { c: PeerCandidate; score: number }[] = [];
  const seenIds = new Set<string>([`${subject.chain_id}:${subject.token_id}`]);
  for (const c of candidates) {
    const id = `${c.chain_id}:${c.token_id}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    if (c.owner_address?.toLowerCase() === subject.owner_address?.toLowerCase()) continue;
    const name = c.name.trim().toLowerCase();
    if (!name || seenNames.has(name)) continue;
    let score = 0;
    if (subject.category && c.category === subject.category) score += 10;
    if (subject.category) score += Math.min(10, c.categoryScores?.[subject.category] ?? 0);
    const theirs = words(`${c.name} ${c.description ?? ""}`);
    let shared = 0;
    for (const w of theirs) if (subjectWords.has(w)) shared++;
    score += Math.min(8, shared);
    if (Boolean(c.x402_supported) === Boolean(subject.x402_supported)) score += 1;
    if (score < 10) continue;
    seenNames.add(name);
    scored.push({ c, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || (b.c.total_feedbacks ?? 0) - (a.c.total_feedbacks ?? 0))
    .slice(0, limit)
    .map((s) => s.c);
}

export interface CardFacts {
  name?: string | null;
  description?: string | null;
  image_url?: string | null;
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
  web_endpoint?: string | null;
  skills?: unknown[] | null;
  agent_wallet?: string | null;
}

// five things a buyer needs from a card; the result names what is missing
export function cardCompleteness(card: CardFacts): { have: number; of: number; missing: string[] } {
  const checks: [string, boolean][] = [
    ["a description", Boolean(card.description && card.description.trim().length >= 20)],
    ["an image", Boolean(card.image_url)],
    ["a callable endpoint", Boolean(card.a2a_endpoint || card.mcp_server || card.web_endpoint)],
    ["skills", Boolean(card.skills && card.skills.length > 0)],
    ["a wallet", Boolean(card.agent_wallet)],
  ];
  return {
    have: checks.filter(([, ok]) => ok).length,
    of: checks.length,
    missing: checks.filter(([, ok]) => !ok).map(([label]) => label),
  };
}
