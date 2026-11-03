// Which venue a buffer hire opens against, and which one a sweep may touch.
// The rule is one line: the best rate among the live adapters, unless an operator
// has pinned an address. A hire's own venue is written on chain at open, so a
// sweep always follows the hire rather than this default.

import { venuesFor, type Venue } from "./venue-registry";

export const MOCK_VENUE_ADDRESS = "0x6b81b6fff9f6920b309e511159f737454870f8e8";

function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

// deterministic: the higher rate wins, and a tie falls back to the registry id
export function bestVenue(venues: readonly Venue[]): Venue | null {
  const usable = venues.filter((v) => v.status === "live" && Boolean(v.adapter));
  if (usable.length === 0) return null;
  return [...usable].sort(
    (a, b) => (b.rateBps ?? 0) - (a.rateBps ?? 0) || a.id.localeCompare(b.id),
  )[0];
}

export function defaultVenueFor(chainId: number): string {
  const pinned = process.env[`VENUE_ADDRESS_${chainId}`] ?? "";
  if (isAddress(pinned)) return pinned;
  if (chainId === 97) return MOCK_VENUE_ADDRESS;
  const best = bestVenue(venuesFor(chainId));
  return best?.adapter ?? "";
}
