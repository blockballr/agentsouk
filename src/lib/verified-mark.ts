// "Verified by Agent Souk": a signed statement that an agent passed our checks.
// Listing needs only the behaviour check; the mark is the tier above it. It is
// signed fresh on every read and expires within a week, so an agent that stops
// qualifying loses it without a revocation list: we simply stop signing.

import { privateKeyToAccount } from "viem/accounts";
import { verifyTypedData, type Address, type Hex } from "viem";

export type MarkBasis = "house" | "hosted" | "delivered";

export interface MarkInput {
  /** the verifier's latest status for the token, if any */
  status: string | null;
  delisted: boolean;
  /** an agent Agent Souk builds and runs */
  house: boolean;
  /** an agent built and hosted with the Agent Souk builder */
  hosted: boolean;
}

export type MarkDecision =
  | { verified: true; basis: MarkBasis; reason: string }
  | { verified: false; reason: string };

const LIVE = new Set(["online", "delivered"]);

export function decideMark(input: MarkInput): MarkDecision {
  if (input.delisted) return { verified: false, reason: "the listing is delisted" };
  const status = (input.status ?? "").trim().toLowerCase();
  if (!LIVE.has(status)) {
    return { verified: false, reason: status ? `the last check reads ${status}` : "the agent has not been checked yet" };
  }
  if (input.house) return { verified: true, basis: "house", reason: "built and run by Agent Souk, and answering" };
  if (input.hosted) return { verified: true, basis: "hosted", reason: "built with the Agent Souk builder, and answering" };
  // an answer alone is the listing bar; the mark needs a paid delivery we watched
  if (status === "delivered") return { verified: true, basis: "delivered", reason: "a paid delivery was observed" };
  return { verified: false, reason: "answering, but no paid delivery has been observed yet" };
}

export const MARK_TTL_SECONDS = 7 * 24 * 60 * 60;

export const MARK_TYPES = {
  VerifiedAgent: [
    { name: "registry", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "basis", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export interface MarkMessage {
  registry: Address;
  tokenId: bigint;
  basis: MarkBasis;
  issuedAt: bigint;
  expiresAt: bigint;
}

export function markDomain(chainId: number) {
  return { name: "Agent Souk", version: "1", chainId } as const;
}

export function markMessage(registry: Address, tokenId: string, basis: MarkBasis, nowSeconds: number): MarkMessage {
  return {
    registry,
    tokenId: BigInt(tokenId),
    basis,
    issuedAt: BigInt(nowSeconds),
    expiresAt: BigInt(nowSeconds + MARK_TTL_SECONDS),
  };
}

export async function signMark(key: Hex, chainId: number, message: MarkMessage): Promise<{ signer: Address; signature: Hex }> {
  const account = privateKeyToAccount(key);
  const signature = await account.signTypedData({
    domain: markDomain(chainId),
    types: MARK_TYPES,
    primaryType: "VerifiedAgent",
    message,
  });
  return { signer: account.address, signature };
}

/** What any other site runs to check a mark: the signer must be the published attestor and the mark unexpired. */
export async function checkMark(
  chainId: number,
  message: MarkMessage,
  signature: Hex,
  attestor: Address,
  nowSeconds: number,
): Promise<boolean> {
  if (BigInt(nowSeconds) >= message.expiresAt) return false;
  return verifyTypedData({
    address: attestor,
    domain: markDomain(chainId),
    types: MARK_TYPES,
    primaryType: "VerifiedAgent",
    message,
    signature,
  });
}
