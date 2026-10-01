// the one-day test's pass mark, against the real models: three prompts each become an agent
// that answers its own example over A2A. It calls a paid model and a live RPC, so it only
// runs when asked for: BUILDER_LIVE=1 npx vitest run tests/test-builder-live.ts
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { answerBuiltAgent } from "../src/lib/builder/a2a";
import { builderChatFromEnv, composeBlueprint } from "../src/lib/builder/compose";
import { liveReader } from "../src/lib/builder/sources";

const LIVE = process.env.BUILDER_LIVE === "1";

// the model settings live in .env.local beside the API's other keys; only the four
// BUILDER_LLM names are read, and no value is ever printed
function modelSettings(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
      const m = /^(BUILDER_LLM_[A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no file: the settings must come from the environment
  }
  return env;
}

const PROMPTS = [
  { name: "health factor watcher", category: "health-factor", prompt: "Watch my lending position: tell me my health factor and how far my collateral can drop before I get liquidated." },
  { name: "PancakeSwap range planner", category: null, prompt: "Plan a PancakeSwap v3 liquidity range around the current WBNB/USDT price for a width I choose, and show how my deposit splits." },
  { name: "yield comparer", category: "yield", prompt: "Compare two yield options on the same principal after compounding and fees, and tell me which one nets more." },
];

describe.skipIf(!LIVE)("three prompts become agents that answer over A2A", () => {
  // a skipped suite still runs this body, so nothing is read from disk unless the run was asked for
  const settings = LIVE ? builderChatFromEnv(modelSettings()) : null;
  const read = liveReader(Number(process.env.TARGET_CHAIN ?? 97));

  it("has its model settings", () => {
    expect(settings, "set BUILDER_LLM_BASE_URL, BUILDER_LLM_API_KEY and BUILDER_LLM_MODEL in .env.local").not.toBeNull();
  });

  it.each(PROMPTS)("$name", async ({ prompt, category }) => {
    if (!settings) throw new Error("model settings missing");
    const out = await composeBlueprint(prompt, { ...settings, read });
    if (!out.ok) throw new Error(`not built (${out.reason}): ${"errors" in out ? out.errors.join("; ") : out.message}`);
    if (category) expect(out.blueprint.category).toBe(category);

    const skill = out.blueprint.skills[0];
    const reply = await answerBuiltAgent(out.blueprint, { task: skill.name, input: skill.example }, { read });
    console.log(`${out.blueprint.name} | ${out.model}, ${out.attempts} call(s) | blocks: ${skill.steps.map((s) => s.block).join(", ")}\n  ${reply.text}`);
    expect(reply.state).toBe("completed");

    const status = await answerBuiltAgent(out.blueprint, { task: "report your status in one sentence" }, { read });
    expect(status.state).toBe("completed");
  }, 180_000);
});
