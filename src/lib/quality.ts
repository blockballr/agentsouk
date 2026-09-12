// lightweight quality check on a delivery text
// deterministic, no model call: empty or error-shaped output scores low

export interface QualityResult {
  score: number;
  grade: "good" | "partial" | "poor";
  reason: string;
}

export function scoreDelivery(text: string | undefined | null): QualityResult {
  const raw = (text ?? "").trim();
  if (!raw) {
    return { score: 0, grade: "poor", reason: "empty deliverable" };
  }
  if (raw.length < 20) {
    return { score: 0.2, grade: "poor", reason: "deliverable is too short to judge" };
  }

  let score = 0.45;
  const lower = raw.toLowerCase();
  if (
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("unauthorized") ||
    lower.includes("not found")
  ) {
    score -= 0.3;
  }
  if (raw.length >= 60) score += 0.2;
  if (raw.length >= 160) score += 0.15;
  if (raw.startsWith("{") || raw.startsWith("[")) score += 0.15;
  if (/\d/.test(raw)) score += 0.1;

  score = Math.max(0, Math.min(1, score));
  const grade = score >= 0.65 ? "good" : score >= 0.35 ? "partial" : "poor";
  return {
    score: Number(score.toFixed(2)),
    grade,
    reason: grade === "good" ? "substantive deliverable" : grade === "partial" ? "thin but non-empty" : "weak or error-shaped",
  };
}
