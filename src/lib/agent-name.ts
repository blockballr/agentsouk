import "server-only";

import { getAgentByToken } from "./scanner";
import { cacheKeys, cached } from "./short-cache";

// the registry can answer a brand-new token with a generated label until its
// document is indexed; the listing name is what the buyer saw, so a stored
// placeholder is resolved rather than shown as the agent
const PLACEHOLDER = /^agent\s*#?\s*\d+$/i;

export function isPlaceholderAgentName(name: string | null | undefined): boolean {
  return !name || PLACEHOLDER.test(name.trim());
}

export async function resolveAgentName(
  chainId: number,
  tokenId: string,
  stored: string | null | undefined,
): Promise<string | null> {
  if (stored && !isPlaceholderAgentName(stored)) return stored;
  const name = await cached(
    cacheKeys.agentName(chainId, tokenId),
    5 * 60_000,
    async () => {
      const detail = await getAgentByToken(chainId, tokenId).catch(() => null);
      return detail?.name?.trim() || null;
    },
  );
  return name ?? stored ?? null;
}
