// A short-lived in-process cache for read paths. A value is held for at most
// ttlMs, and concurrent misses for one key share a single load, so a burst of
// pollers cannot stampede the durable store.

import "server-only";

interface Entry<T> {
  value?: T;
  expiresAt: number;
  pending?: Promise<T>;
}

const store = new Map<string, Entry<unknown>>();

// Key builders live here so the write route that changes a wallet's state can
// drop the read key for the same wallet without re-deriving its shape.
export const cacheKeys = {
  sessionsPrefix: "sessions:",
  hiresPrefix: "hires:",
  sessions: (client: string): string =>
    `${cacheKeys.sessionsPrefix}${client.toLowerCase() || "*"}`,
  hires: (wallet: string): string =>
    `${cacheKeys.hiresPrefix}${wallet.toLowerCase()}`,
  categoryMap: (chainId: number): string => `category-map:${chainId}`,
};

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T> | T,
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  // A load already in flight is shared even if its own window has elapsed, so
  // many simultaneous misses become one durable read.
  if (hit?.pending) return hit.pending;
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const pending = (async () => {
    const value = await load();
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  })();
  store.set(key, { expiresAt: Date.now() + ttlMs, pending });
  try {
    return await pending;
  } catch (e) {
    // A failed load is never cached, or one failure would outlive the request.
    const current = store.get(key) as Entry<T> | undefined;
    if (current?.pending === pending) store.delete(key);
    throw e;
  }
}

export function invalidate(key: string): void {
  store.delete(key);
}

export function invalidatePrefix(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
