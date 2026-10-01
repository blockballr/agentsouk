// what an owner signs to take a listing off the market or put it back, bound to the token,
// the owner and the action so a captured signature cannot flip a different listing.
// apps/web/src/lib/listing-control.ts builds the same text, and a test keeps them equal

export type ListingAction = "delist" | "relist";

export function listingControlMessage(
  chainId: number,
  tokenId: string,
  owner: string,
  action: ListingAction,
): string {
  return [
    "Agent Souk listing control",
    `chainId: ${chainId}`,
    `tokenId: ${tokenId}`,
    `owner: ${owner.toLowerCase()}`,
    `action: ${action}`,
  ].join("\n");
}

export interface DelistedRow {
  tokenId: string;
  reason: string | null;
  delistedAt: string | null;
}

// the database is the truth whenever it answers: a relist on one instance must not be
// undone by another instance still holding the token in memory. Memory stands in only
// when there is no database or the read failed
export function pickDelisted(
  dbRows: DelistedRow[] | null,
  memory: Iterable<string>,
): Map<string, DelistedRow> {
  if (dbRows) return new Map(dbRows.map((r) => [r.tokenId, r]));
  return new Map([...memory].map((tokenId) => [tokenId, { tokenId, reason: null, delistedAt: null }]));
}
