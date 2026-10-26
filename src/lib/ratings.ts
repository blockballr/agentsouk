// richer ratings for job sellers: a score, a comment and the verifier score
// that the delivery earned, keyed to the payment that funded the job.
// durable-backed when postgres is configured, in-memory otherwise.

import "server-only";

import { getAddress, verifyMessage } from "viem";
import { durableMode, loadRatings as loadDurableRatings, saveRating as saveDurableRating } from "./durable-store";

export interface Rating {
  id: string;
  chainId: number;
  tokenId: string;
  paymentId: string;
  rater: string;
  score: number; // 1..5
  comment: string;
  verifierScore: number; // 0..100
  createdAt: string;
}

const ratings = new Map<string, Rating[]>();
const loaded = new Set<string>();

function ratingKey(chainId: number, tokenId: string): string {
  return `${chainId}:${tokenId}`;
}

async function ensureLoaded(chainId: number, tokenId: string): Promise<void> {
  const key = ratingKey(chainId, tokenId);
  if (loaded.has(key)) return;
  loaded.add(key);
  if (durableMode() === "postgres") {
    const durable = await loadDurableRatings(chainId, tokenId).catch(() => []);
    if (durable.length > 0) {
      ratings.set(key, durable);
    }
  }
}

export async function ratingsFor(chainId: number, tokenId: string): Promise<Rating[]> {
  await ensureLoaded(chainId, tokenId);
  return [...(ratings.get(ratingKey(chainId, tokenId)) ?? [])];
}

export async function ratingSummary(chainId: number, tokenId: string): Promise<{ count: number; average: number; verifierAverage: number }> {
  const list = await ratingsFor(chainId, tokenId);
  if (list.length === 0) return { count: 0, average: 0, verifierAverage: 0 };
  const score = list.reduce((a, r) => a + r.score, 0) / list.length;
  const v = list.reduce((a, r) => a + r.verifierScore, 0) / list.length;
  return { count: list.length, average: Math.round(score * 100) / 100, verifierAverage: Math.round(v * 100) / 100 };
}

export function ratingMessage(input: {
  chainId: number;
  tokenId: string;
  paymentId: string;
  score: number;
  comment: string;
  verifierScore: number;
}): string {
  return [
    "Agent Souk rating",
    `chainId: ${input.chainId}`,
    `tokenId: ${input.tokenId}`,
    `paymentId: ${input.paymentId}`,
    `score: ${input.score}`,
    `comment: ${input.comment}`,
    `verifierScore: ${input.verifierScore}`,
  ].join("\n");
}

export async function verifyRatingSignature(input: {
  chainId: number;
  tokenId: string;
  paymentId: string;
  score: number;
  comment: string;
  verifierScore: number;
  rater: string;
  signature: string;
}): Promise<boolean> {
  try {
    const ok = await verifyMessage({
      address: getAddress(input.rater),
      message: ratingMessage(input),
      signature: input.signature as `0x${string}`,
    });
    return ok;
  } catch {
    return false;
  }
}

export async function addRating(r: Rating): Promise<Rating> {
  const key = ratingKey(r.chainId, r.tokenId);
  await ensureLoaded(r.chainId, r.tokenId);
  const list = ratings.get(key) ?? [];
  if (list.some((x) => x.paymentId === r.paymentId)) {
    throw new Error("this payment has already been rated");
  }
  list.push(r);
  ratings.set(key, list);
  await saveDurableRating(r).catch(() => {});
  return r;
}

export async function hasRated(chainId: number, tokenId: string, paymentId: string): Promise<boolean> {
  const list = await ratingsFor(chainId, tokenId);
  return list.some((x) => x.paymentId === paymentId);
}
