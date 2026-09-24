import type { ScoutCandidate } from "./scout";

export const MAX_PER_CATEGORY = 55;

export function shouldAddCandidate(input: {
  candidate: Pick<ScoutCandidate, "token_id" | "category">;
  verification?: { status?: string } | null;
  existingTokenIds: Set<string>;
  categoryCounts: Record<string, number>;
}): boolean {
  if (input.existingTokenIds.has(input.candidate.token_id)) return false;
  if (!input.verification || input.verification.status !== "delivered") return false;
  if (input.candidate.category === "general") return false;
  return (input.categoryCounts[input.candidate.category] ?? 0) < MAX_PER_CATEGORY;
}

export function scoreFor(verifyStatus: string, responseMs: number): number {
  if (verifyStatus !== "delivered") return 0;
  const speed = responseMs > 0 && responseMs < 4000 ? 8 : responseMs < 10000 ? 4 : 0;
  return 24 + speed;
}
