import { NextRequest, NextResponse } from "next/server";
import { answerBuiltAgent } from "@/lib/builder/a2a";
import { builderChatFromEnv, composeBlueprint, type ChatFn } from "@/lib/builder/compose";
import { liveReader } from "@/lib/builder/sources";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const PER_VISITOR = { table: "rl_builder_visitor", limit: 5, windowMs: DAY_MS };
// every build spends model requests the compare commentary also draws on, so the day has a ceiling
const DAILY_BUILDS = Math.max(1, Number.parseInt(process.env.BUILDER_DAILY_BUILDS ?? "", 10) || 30);
const PER_DAY = { table: "rl_builder_total", limit: DAILY_BUILDS, windowMs: DAY_MS };
// the model calls together must end before the platform ends the request
const BUDGET_MS = 50_000;

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

const BUSY = "The builder is busy just now. Try again in a minute, or build with Agent Studio below.";
const UNCLEAR = "We could not turn that into a working agent. Say what it should work out, and from which figures.";

// POST /api/builder/compose  { prompt }
// a description becomes an agent, or one plain reason it could not be built
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { prompt?: unknown } | null;
  if (typeof body?.prompt !== "string") return json({ success: false, reason: "invalid", message: "Describe the agent you want." }, 400);

  const settings = builderChatFromEnv();
  if (!settings) return json({ success: false, reason: "paused", message: "The prompt builder is paused. Build with Agent Studio below." }, 503);

  try {
    const mine = await enforceRateLimit(PER_VISITOR, { keys: [`ip:${clientIpFrom(req.headers)}`] });
    if (!mine.allowed) return json({ success: false, reason: "limit", message: "You have used today's builds. Come back tomorrow, or build with Agent Studio below." }, 429);
    const all = await enforceRateLimit(PER_DAY, { keys: ["all"] });
    if (!all.allowed) return json({ success: false, reason: "limit", message: "Today's builds are used up. Come back tomorrow, or build with Agent Studio below." }, 429);
  } catch {
    return json({ success: false, reason: "unavailable", message: BUSY }, 503);
  }

  const started = Date.now();
  const chat: ChatFn = (model, messages) => {
    const left = BUDGET_MS - (Date.now() - started);
    if (left < 3000) return Promise.reject(new Error("out of time"));
    return Promise.race([
      settings.chat(model, messages),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("out of time")), left)),
    ]);
  };
  const read = liveReader(targetChainId());
  const out = await composeBlueprint(body.prompt, {
    chat,
    models: settings.models,
    read,
    log: (line) => console.error("[builder]", line.slice(0, 300)),
  });

  if (!out.ok) {
    if ("message" in out) return json({ success: false, reason: out.reason, message: out.message });
    if (out.reason === "unavailable") return json({ success: false, reason: "unavailable", message: BUSY }, 503);
    console.error("[builder] not built:", out.errors.slice(0, 6).join("; ").slice(0, 600));
    return json({ success: false, reason: "invalid", message: out.attempts === 0 ? out.errors[0] : UNCLEAR }, 422);
  }

  // each skill's own example, answered as a caller would see it
  const answers = [];
  for (const skill of out.blueprint.skills) {
    const reply = await answerBuiltAgent(out.blueprint, { task: skill.name, input: { ...skill.example, skill: skill.id } }, { read });
    answers.push({ skill: skill.id, text: reply.text });
  }
  return json({ success: true, blueprint: out.blueprint, answers });
}
