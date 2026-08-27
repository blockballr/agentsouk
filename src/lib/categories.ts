import {
  CategoryKey,
  CATEGORY_KEYS,
  CategoryDef,
  CATEGORIES,
  AgentSummary,
} from "./types";

// keyword signals per category: precise phrases carry weight 2 because one
// unambiguous mention is enough, generic words weight 1 and need a second signal
// classification runs over the agent's name + description + tags, so real BSC
// agents land in the right bucket without manual curation
const SIGNALS: Record<CategoryKey, { terms: { t: string; w: number; stem?: boolean }[] }> = {
  "health-factor": {
    terms: [
      { t: "health factor", w: 2 },
      { t: "healthfactor", w: 2 },
      { t: "liquidation", w: 2 },
      { t: "liquidate", w: 2 },
      { t: "liquidation price", w: 2 },
      { t: "borrow position", w: 2 },
      { t: "lending position", w: 2 },
      { t: "position protection", w: 2 },
      { t: "liquidation guard", w: 2 },
      { t: "collateral", w: 1 },
      { t: "aave", w: 1 },
      { t: "venus", w: 1 },
      { t: "overcollateral", w: 1 },
    ],
  },
  "grid-trading": {
    terms: [
      { t: "grid trading", w: 2 },
      { t: "grid bot", w: 2 },
      { t: "grid order", w: 2 },
      { t: "grid strategy", w: 2 },
      { t: "accumulation grid", w: 2 },
      { t: "dca grid", w: 2 },
      { t: "trading grid", w: 2 },
      { t: "automated grid", w: 2 },
      { t: "spot grid", w: 2 },
      { t: "grid trading bot", w: 2 },
      { t: "dca", w: 1 },
      { t: "grid", w: 1 },
    ],
  },
  rebalancing: {
    terms: [
      { t: "rebalanc", w: 2, stem: true },
      { t: "lp range", w: 2 },
      { t: "liquidity range", w: 2 },
      { t: "concentrated liquidity", w: 2 },
      { t: "auto rebalance", w: 2 },
      { t: "position reset", w: 2 },
      { t: "range reset", w: 2 },
      { t: "amm rebalance", w: 2 },
      { t: "lp management", w: 1 },
      { t: "liquidity provision", w: 1 },
      { t: "pool position", w: 1 },
      { t: "liquidity provider", w: 1 },
    ],
  },
  yield: {
    terms: [
      { t: "yield", w: 2 },
      { t: "apr", w: 2 },
      { t: "apy", w: 2 },
      { t: "staking optimizer", w: 2 },
      { t: "auto compound", w: 2 },
      { t: "best yield", w: 2 },
      { t: "highest apr", w: 2 },
      { t: "liquidity mining", w: 2 },
      { t: "farming", w: 1 },
      { t: "vault", w: 1 },
      { t: "reward optimizer", w: 1 },
      { t: "earn", w: 1 },
    ],
  },
};

export interface Classification {
  category: CategoryKey | "general";
  scores: Partial<Record<CategoryKey, number>>;
}

export function classifyAgent(text: string): Classification {
  const hay = text.toLowerCase();
  const scores: Partial<Record<CategoryKey, number>> = {};

  for (const key of CATEGORY_KEYS) {
    const { terms } = SIGNALS[key];
    let score = 0;
    for (const { t, w, stem } of terms) {
      const hit = stem
        ? hay.includes(t)
        : t.includes(" ")
          ? hay.includes(t)
          : new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`, "i").test(hay);
      if (hit) score += w;
    }
    if (score > 0) scores[key] = score;
  }

  const best = CATEGORY_KEYS.reduce<{ key: CategoryKey; score: number } | null>(
    (acc, key) => {
      const s = scores[key] ?? 0;
      if (s <= 0) return acc;
      if (!acc || s > acc.score) return { key, score: s };
      return acc;
    },
    null,
  );

  // a threshold of 2 keeps a generic "trading agent" out of the specialist
  // buckets, landing it in general (still hireable, just not one of the four
  // headline categories)
  const category =
    best && best.score >= 2 ? best.key : "general";

  return { category, scores };
}

export function categoryDef(key: CategoryKey): CategoryDef {
  return CATEGORIES.find((c) => c.key === key) as CategoryDef;
}

// how well an agent fits a category, for ranking
// category relevance dominates because the registry rewards age (total_score)
// more than fit, and a fresh, precisely-matched agent must beat an old generic
// persona agent
// x402-capable agents edge ahead (they are the hireable ones), then reputation
export function relevanceScore(a: AgentSummary, category: string): number {
  const rel = (a.categoryScores?.[category as CategoryKey] ?? 0) * 10;
  const x402 = a.x402_supported ? 2 : 0;
  const reputation =
    Math.min(a.total_score, 30) / 10 + a.total_feedbacks / 100;
  return rel + x402 + reputation;
}
