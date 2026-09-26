// Grading an A2A reply structurally: a failed task state is poor however verbose.

export interface QualityResult {
  score: number;
  grade: "good" | "partial" | "poor";
  reason: string;
}

/** A2A task states that mean the agent did not produce a result. */
const FAILED_STATES = new Set(["failed", "rejected", "canceled", "cancelled"]);
/** States that mean it is waiting on the client, which is not a delivery. */
const PENDING_STATES = new Set(["submitted", "working", "input-required", "unknown"]);

export interface A2AEnvelope {
  state?: string;
  text: string;
  parts: number;
  isJson: boolean;
}

/** Pull the state and text out of the shapes of A2A reply we have actually seen. */
export function parseA2A(raw: unknown): A2AEnvelope {
  const empty: A2AEnvelope = { state: undefined, text: "", parts: 0, isJson: false };
  let value = raw;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return empty;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        value = JSON.parse(trimmed);
      } catch {
        return { state: undefined, text: trimmed, parts: 1, isJson: false };
      }
    } else {
      // not JSON and not empty: could be prose or could be an HTML error page
      return { state: undefined, text: trimmed, parts: 1, isJson: false };
    }
  }

  if (!value || typeof value !== "object") return empty;
  const obj = value as Record<string, unknown>;

  const status = obj.status as Record<string, unknown> | undefined;
  const state =
    (typeof status?.state === "string" && status.state) ||
    (typeof obj.state === "string" && obj.state) ||
    undefined;

  const parts: string[] = [];
  const collect = (input: unknown): void => {
    if (!input) return;
    if (Array.isArray(input)) {
      input.forEach(collect);
      return;
    }
    if (typeof input === "string") {
      parts.push(input);
      return;
    }
    if (typeof input !== "object") return;
    const part = input as Record<string, unknown>;
    // A2A parts: { kind: "text", text }, { kind: "data", data }, or older { type: "text", value }
    if (typeof part.text === "string") parts.push(part.text);
    else if (typeof part.value === "string") parts.push(part.value);
    else if (part.data !== undefined) parts.push(JSON.stringify(part.data));
    else if (part.parts !== undefined) collect(part.parts);
  };

  const result = obj.result as Record<string, unknown> | undefined;
  if (result) {
    if (Array.isArray(result.artifacts)) result.artifacts.forEach(collect);
    collect(result.status);
  }
  collect(obj.artifacts);
  collect(obj.message);
  collect(obj.parts);
  collect(obj.content);
  if (typeof obj.text === "string") parts.push(obj.text);

  const text = parts.map((p) => p.trim()).filter(Boolean).join("\n").trim();
  const isJson =
    typeof raw === "string"
      ? raw.trim().startsWith("{") || raw.trim().startsWith("[")
      : Boolean(result?.artifacts || obj.artifacts);

  return { state, text, parts: parts.length, isJson };
}

/** Score a delivery deterministically and structurally. */
export function scoreDelivery(raw: unknown): QualityResult {
  const reply = parseA2A(raw);
  const state = reply.state?.toLowerCase();

  if (state && FAILED_STATES.has(state)) {
    return { score: 0, grade: "poor", reason: `agent reported ${state}` };
  }
  if (state && PENDING_STATES.has(state)) {
    return {
      score: 0.15,
      grade: "poor",
      reason: `agent returned ${state} rather than a result`,
    };
  }

  const text = reply.text.trim();
  if (!text) {
    return { score: 0, grade: "poor", reason: "no artifact or text in the reply" };
  }

  // an HTML document is a web page, not an answer
  if (/^\s*<(!doctype|html)/i.test(text)) {
    return { score: 0, grade: "poor", reason: "reply was an HTML page, not an answer" };
  }

  let score = 0.4;

  if (reply.parts > 0) score += 0.2;
  if (reply.isJson) score += 0.15;
  if (state === "completed") score += 0.15;

  if (text.length >= 40) score += 0.08;
  if (text.length >= 120) score += 0.07;
  if (/\d/.test(text)) score += 0.05;
  if (/\b(error|failed|unauthorized|not found|exception)\b/i.test(text)) score -= 0.25;

  score = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  const grade = score >= 0.65 ? "good" : score >= 0.35 ? "partial" : "poor";
  const reason =
    grade === "good"
      ? reply.parts > 0
        ? `completed with ${reply.parts} artifact part${reply.parts === 1 ? "" : "s"}`
        : "completed with a substantive reply"
      : grade === "partial"
        ? "answered, but thinly"
        : "weak, empty or error-shaped";
  return { score, grade, reason };
}
