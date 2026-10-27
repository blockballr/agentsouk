// Whether a listing may be offered as a quest pick. Kept apart from the shelf read so
// the rule can be tested without a database, a chain, or a network call.

export const ANSWERING_WITHIN_MS = 36 * 60 * 60 * 1000;

interface Check {
  status: string;
  checkedAt: string;
}

// A pick must be known to answer. Three outcomes:
// - no check at all: unknown, so it is not excluded. The shelf already shows a listing
//   nobody has probed as "not checked yet", and hiding every unpicked listing would
//   empty a category the moment the sweep falls behind.
// - any status other than online: the last check failed, so it is not offered.
// - online but older than the window: the answer no longer describes the listing.
export function answeringPick(check: Check | undefined, now = Date.now()): boolean {
  if (!check) return true;
  if (check.status !== "online") return false;
  const at = Date.parse(check.checkedAt);
  return Number.isFinite(at) && now - at <= ANSWERING_WITHIN_MS;
}

// The price a listing declares for itself, carried as written. A quote-only seller has
// none, and saying so is better than printing a number nobody agreed to.
export function declaredPrice(skills: readonly unknown[] | undefined): string | null {
  for (const skill of skills ?? []) {
    const price = (skill as { price?: unknown } | null)?.price;
    if (typeof price === "string" && price.trim()) return price.trim();
  }
  return null;
}
