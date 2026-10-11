// Seeded a2a endpoints, and the merge that keeps them across a rebuild.
//
// An operator publishes its own agent card and registers its agents on chain, but
// the index's list payload carries no endpoint field at all, so a rebuild writes a
// snapshot in which every listing looks unreachable until a per-agent detail read
// lands. A seed records the operator's own published card against the listing it
// registered, so the rebuild re-applies it instead of discarding the only copy.
//
// Pure, so the merge can be tested without a database. endpoint-store.ts is the
// durable half, and follows the delist store's shape.

export interface SeededEndpointRow {
  chainId: number;
  tokenId: string;
  a2aEndpoint: string;
  source: string | null;
}

export type SeededEndpointKey = `${number}:${string}`;

export function seededKey(chainId: number, tokenId: string): SeededEndpointKey {
  return `${chainId}:${tokenId}`;
}

// The database is the truth whenever it answers, exactly as the delist store does:
// a seed written on one instance must not be undone by another still holding memory.
// Memory stands in only when there is no database or the read failed.
export function pickSeededEndpoints(
  dbRows: SeededEndpointRow[] | null,
  memory: Map<SeededEndpointKey, SeededEndpointRow>,
): Map<SeededEndpointKey, SeededEndpointRow> {
  if (dbRows) {
    const out = new Map<SeededEndpointKey, SeededEndpointRow>();
    for (const r of dbRows) out.set(seededKey(r.chainId, r.tokenId), r);
    return out;
  }
  return new Map(memory);
}

// Re-applies seeds to a freshly selected shelf and returns how many it touched.
// It never overwrites an endpoint the build already found: an endpoint read from
// the registry beats one this marketplace stored, because only the registry can
// notice an operator moved. Mutates in place, because selection hands back the
// very objects the snapshot is about to serialise.
export function applySeededEndpoints<T extends { token_id: string; a2a_endpoint?: string | null }>(
  agents: T[],
  seeded: Map<SeededEndpointKey, SeededEndpointRow>,
  chainId: number,
): number {
  if (seeded.size === 0) return 0;
  let applied = 0;
  for (const a of agents) {
    if (a.a2a_endpoint) continue;
    const row = seeded.get(seededKey(chainId, String(a.token_id)));
    if (!row?.a2aEndpoint) continue;
    a.a2a_endpoint = row.a2aEndpoint;
    applied++;
  }
  return applied;
}
