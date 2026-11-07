import { apiRequest } from "../core/http";
import type { CliConfig } from "../core/config";
import type { LoadedSigner } from "../core/wallet";

export type ListingAction = "delist" | "relist";

// must match src/lib/listing-control.ts, which verifies the signature
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

export interface ControlResult {
  success?: boolean;
  tokenId?: string;
  delisted?: boolean;
  error?: string;
}

// the owner takes a listing off the market, or puts it back. the signature is
// bound to the token, the owner and the action, and never touches the on-chain
// registration.
export async function controlListing(
  config: CliConfig,
  signer: LoadedSigner,
  chainId: number,
  tokenId: string,
  action: ListingAction,
): Promise<ControlResult> {
  const message = listingControlMessage(chainId, tokenId, signer.address, action);
  const signature = await signer.signMessage(message);
  return apiRequest<ControlResult>(config.apiUrl, `/api/agents/${chainId}/${tokenId}/delist`, {
    method: action === "delist" ? "POST" : "DELETE",
    body: { owner: signer.address, signature },
    timeoutMs: 30_000,
  });
}
