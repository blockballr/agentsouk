// Set and Earn points, from settled activity only: each new agent hired earns by the order it
// was hired in, an agent listed is worth 300, and a finished passport adds a bonus

// the second hire is the one that finishes the passport, so it is the best paid
// the third is an extra
export const HIRE_POINTS = [100, 200, 150] as const;
export const LISTING_POINTS = 300;
export const FINISH_BONUS = 250;
// the passport asks for two hires here: the campaign wants a wallet's hires spread over at least
// two marketplaces, so a third on this one is a bonus and never a requirement
export const REQUIRED_HIRES = 2;

export interface QuestAward {
  key: string;
  points: number;
  at: string | null;
}

// a passport is finished by hiring two different agents and listing one
export function passportFinished(agentsHired: number, listedOne: boolean): boolean {
  return listedOne && agentsHired >= REQUIRED_HIRES;
}

// one award per different agent, in the order each was first hired; hiring the same agent
// again earns nothing, and neither does a fourth
export function questAwards(
  hires: readonly { agent: string; createdAt?: string | null }[],
  listedOne: boolean,
): { points: number; awards: QuestAward[]; agentsHired: number; finished: boolean } {
  const firstAt = new Map<string, string | null>();
  for (const hire of hires) {
    const at = hire.createdAt ?? null;
    const seen = firstAt.get(hire.agent);
    if (seen === undefined || (at !== null && (seen === null || at < seen))) firstAt.set(hire.agent, at);
  }
  // undated hires sort after dated ones, then by agent, so the result is stable
  const order = [...firstAt.keys()].sort((a, b) => {
    const x = firstAt.get(a) ?? null;
    const y = firstAt.get(b) ?? null;
    if (x === y) return a.localeCompare(b);
    if (x === null) return 1;
    if (y === null) return -1;
    return x < y ? -1 : 1;
  });
  const awards: QuestAward[] = order.slice(0, HIRE_POINTS.length).map((agent, i) => ({
    key: `hire-${i + 1}`,
    points: HIRE_POINTS[i],
    at: firstAt.get(agent) ?? null,
  }));
  const finished = passportFinished(order.length, listedOne);
  if (listedOne) awards.push({ key: "listing", points: LISTING_POINTS, at: null });
  if (finished) awards.push({ key: "bonus", points: FINISH_BONUS, at: null });
  return { points: awards.reduce((sum, a) => sum + a.points, 0), awards, agentsHired: order.length, finished };
}
