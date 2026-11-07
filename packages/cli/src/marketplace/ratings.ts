import { CliError } from "../core/errors";
import { apiRequest } from "../core/http";
import type { CliConfig } from "../core/config";
import type { LoadedSigner } from "../core/wallet";

// must match src/lib/ratings.ts, which verifies the signature
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

export interface RateOptions {
  paymentId: string;
  score: number;
  comment?: string;
  verifierScore?: number;
}

export interface RateResult {
  success?: boolean;
  rating?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  error?: string;
}

export async function rateAgent(
  config: CliConfig,
  signer: LoadedSigner,
  chainId: number,
  tokenId: string,
  options: RateOptions,
): Promise<RateResult> {
  if (!Number.isInteger(options.score) || options.score < 1 || options.score > 5) {
    throw new CliError("score must be 1..5", "usage", 2);
  }
  const message = ratingMessage({
    chainId,
    tokenId,
    paymentId: options.paymentId,
    score: options.score,
    comment: options.comment ?? "",
    verifierScore: options.verifierScore ?? 0,
  });
  const signature = await signer.signMessage(message);
  return apiRequest<RateResult>(config.apiUrl, "/api/ratings", {
    method: "POST",
    body: {
      chainId,
      tokenId,
      paymentId: options.paymentId,
      score: options.score,
      comment: options.comment ?? "",
      verifierScore: options.verifierScore ?? 0,
      rater: signer.address,
      signature,
    },
    timeoutMs: 30_000,
  });
}
