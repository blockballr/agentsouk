import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LLM_API_KEY = process.env.LLM_EVAL_API_KEY ?? "";
const PRIMARY_MODEL = process.env.LLM_EVAL_MODEL ?? "gemini-2.5-flash";
const FALLBACK_MODEL = process.env.LLM_EVAL_FALLBACK_MODEL ?? "gemini-2.0-flash";
// last resort: the free tier only allows 20 requests PER DAY per model, so
// when both configured models have burned their daily allowance, this lite
// sibling still has its own untouched bucket
const LAST_RESORT_MODEL = "gemini-3.5-flash-lite";
const BASE_URL =
  process.env.LLM_EVAL_BASE_URL ??
  "https://generativelanguage.googleapis.com/v1beta/openai";

const SYSTEM_PROMPT =
  "You are the marketplace's analyst. You receive only the metrics below - the same numbers the buyer sees in the comparison table. In 2-4 sentences explain the outcome: why the winner won, what the closest competitor's numbers mean as risk, one caveat. Never invent prices, PnL, performance data, or facts not in the metrics. Plain prose, no markdown.";

interface AgentMetrics {
  name: unknown;
  category: unknown;
  score: unknown;
  feedbacks: unknown;
  verified: unknown;
  verification?: {
    status?: unknown;
    quality?: { grade?: unknown; reason?: unknown };
  };
  pcs?: unknown;
  fee?: unknown;
}

interface CommentaryBody {
  agents: AgentMetrics[];
  winners: { category: unknown; name: unknown }[];
  language?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// strict shape check: only accept what the compare table actually shows,
// and never more than 8 agents
function parseBody(raw: unknown): CommentaryBody | null {
  if (!isRecord(raw)) return null;
  const agentsRaw = raw.agents;
  const winnersRaw = raw.winners;
  if (!Array.isArray(agentsRaw) || !Array.isArray(winnersRaw)) return null;
  if (agentsRaw.length < 1 || agentsRaw.length > 8) return null;
  if (winnersRaw.length > 8) return null;

  const agents: AgentMetrics[] = [];
  for (const a of agentsRaw) {
    if (!isRecord(a)) return null;
    if (typeof a.name !== "string" || !a.name.trim()) return null;
    if (typeof a.category !== "string") return null;
    if (typeof a.score !== "number" || !Number.isFinite(a.score)) return null;
    if (typeof a.feedbacks !== "number" || !Number.isFinite(a.feedbacks)) return null;
    if (typeof a.verified !== "boolean") return null;
    const agent: AgentMetrics = {
      name: a.name.slice(0, 120),
      category: a.category,
      score: a.score,
      feedbacks: a.feedbacks,
      verified: a.verified,
    };
    if (isRecord(a.verification)) {
      const verification: AgentMetrics["verification"] = {};
      if (typeof a.verification.status === "string") {
        verification.status = a.verification.status;
      }
      if (isRecord(a.verification.quality)) {
        verification.quality = {
          grade:
            typeof a.verification.quality.grade === "string"
              ? a.verification.quality.grade
              : undefined,
          reason:
            typeof a.verification.quality.reason === "string"
              ? a.verification.quality.reason.slice(0, 300)
              : undefined,
        };
      }
      agent.verification = verification;
    }
    if (typeof a.pcs === "boolean") agent.pcs = a.pcs;
    if (typeof a.fee === "string" || typeof a.fee === "number") agent.fee = a.fee;
    agents.push(agent);
  }

  const winners: CommentaryBody["winners"] = [];
  for (const w of winnersRaw) {
    if (!isRecord(w)) return null;
    if (typeof w.category !== "string" || typeof w.name !== "string") return null;
    winners.push({ category: w.category, name: w.name });
  }

  const language = typeof raw.language === "string" ? raw.language : "en";
  return { agents, winners, language };
}

async function llmChat(model: string, userContent: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  }).catch((e) => {
    throw new Error(`llm fetch failed: ${e?.message ?? e}`);
  });
  const rawText = await res.text();
  if (!res.ok) throw new Error(`llm http ${res.status}: ${rawText.slice(0, 200)}`);
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    throw new Error("llm non-json response");
  }
  const content = (body as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("llm no message content");
  const fenced = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(fenced);
  const obj = parsed as { commentary?: unknown; analysis?: unknown };
  // the lite model answers with "analysis"; accept both keys
  const commentary = typeof obj.commentary === "string" ? obj.commentary : obj.analysis;
  if (typeof commentary !== "string" || !commentary.trim()) {
    throw new Error("llm unparseable commentary");
  }
  return commentary.trim().slice(0, 1200);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// model chain: configured primary, configured fallback, then the lite model
// whose separate daily bucket usually still has room. no waits: the free
// tier quota that actually binds is per-day, and waiting never frees it
async function generateCommentary(userContent: string): Promise<{ commentary: string; model: string }> {
  let lastError: unknown;
  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL, LAST_RESORT_MODEL]) {
    try {
      const commentary = await llmChat(model, userContent);
      return { commentary, model };
    } catch (e) {
      lastError = e;
      console.error(`[compare/commentary] ${model}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
      await sleep(1500);
    }
  }
  throw lastError;
}

export async function POST(request: Request) {
  let parsed: CommentaryBody | null = null;
  try {
    parsed = parseBody(await request.json());
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return NextResponse.json({ success: false }, { status: 200 });
  }
  if (!LLM_API_KEY) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  // only the numbers the buyer sees in the table go to the model
  const userContent = JSON.stringify({
    language: parsed.language,
    winners: parsed.winners,
    agents: parsed.agents,
  });

  try {
    const { commentary, model } = await generateCommentary(userContent);
    return NextResponse.json({ success: true, commentary, model });
  } catch {
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
