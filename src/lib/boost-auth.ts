// ownership proof for listing boosts
// only the registered owner (or agent wallet) may pay to boost

import { getAddress, verifyMessage } from "viem";

export function boostAuthMessage(input: {
  chainId: number;
  tokenId: string;
  owner: string;
  days: number;
  nonce: string;
}): string {
  return [
    "Agent Souk boost",
    `chainId: ${input.chainId}`,
    `tokenId: ${input.tokenId}`,
    `owner: ${input.owner}`,
    `days: ${input.days}`,
    `nonce: ${input.nonce}`,
  ].join("\n");
}

export function normalizeAddr(a: string): string {
  try {
    return getAddress(a).toLowerCase();
  } catch {
    return a.trim().toLowerCase();
  }
}

export function isAgentOwner(
  signer: string,
  detail: { owner_address?: string | null; agent_wallet?: string | null } | null | undefined,
): boolean {
  if (!detail) return false;
  const s = normalizeAddr(signer);
  const owners = [detail.owner_address, detail.agent_wallet]
    .filter((x): x is string => Boolean(x))
    .map(normalizeAddr);
  return owners.includes(s);
}

export async function verifyBoostOwnership(input: {
  message: string;
  signature: string;
  expectedOwner: string;
}): Promise<{ ok: boolean; recovered?: string; error?: string }> {
  try {
    const recovered = await verifyMessage({
      address: input.expectedOwner as `0x${string}`,
      message: input.message,
      signature: input.signature as `0x${string}`,
    });
    if (!recovered) {
      return { ok: false, error: "signature does not match the registered owner" };
    }
    return { ok: true, recovered: normalizeAddr(input.expectedOwner) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
