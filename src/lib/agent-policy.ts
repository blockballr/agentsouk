import "server-only";

import { firstPartyPolicy } from "./first-party-copy";

export function policyForWallet(chainId: number, wallet: string): { policy: string; tokenId: string } | null {
  return firstPartyPolicy(chainId, wallet);
}
