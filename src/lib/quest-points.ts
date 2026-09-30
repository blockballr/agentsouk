// Set and Earn points, from settled activity only: an agent listed is worth 300, each category's
// first hire earns by the order the categories were reached, and a complete set adds a bonus

export const HIRE_POINTS = [100, 150, 100, 100] as const;
export const LISTING_POINTS = 300;
export const FINISH_BONUS = 250;

export interface QuestAward {
  key: string;
  points: number;
  at: string | null;
}

export function questAwards(
  hires: readonly { category: string | null; createdAt?: string | null }[],
  categories: readonly string[],
  listedOne: boolean,
): { points: number; awards: QuestAward[] } {
  const firstAt = new Map<string, string | null>();
  for (const hire of hires) {
    if (!hire.category || !categories.includes(hire.category)) continue;
    const at = hire.createdAt ?? null;
    const seen = firstAt.get(hire.category);
    if (seen === undefined || (at !== null && (seen === null || at < seen))) firstAt.set(hire.category, at);
  }
  // undated hires sort after dated ones, then by the fixed category order, so the result is stable
  const reached = categories
    .filter((c) => firstAt.has(c))
    .sort((a, b) => {
      const x = firstAt.get(a) ?? null;
      const y = firstAt.get(b) ?? null;
      if (x === y) return categories.indexOf(a) - categories.indexOf(b);
      if (x === null) return 1;
      if (y === null) return -1;
      return x < y ? -1 : 1;
    });
  const awards: QuestAward[] = reached.map((category, i) => ({
    key: category,
    points: HIRE_POINTS[i] ?? 0,
    at: firstAt.get(category) ?? null,
  }));
  if (listedOne) awards.push({ key: "listing", points: LISTING_POINTS, at: null });
  if (listedOne && reached.length === categories.length) {
    awards.push({ key: "bonus", points: FINISH_BONUS, at: null });
  }
  return { points: awards.reduce((sum, a) => sum + a.points, 0), awards };
}
