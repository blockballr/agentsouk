// a built agent over A2A: the three sample agents answer a task correctly, a question about
// the agent gets its capabilities, and a short request is told what is missing, in the same
// reply shapes the marketplace and the verifier already read from the reference agents
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { answerBuiltAgent, builtAgentCard, capabilityReply, inputsFromText, pickSkill } from "../src/lib/builder/a2a";
import { validateBlueprint, type Blueprint } from "../src/lib/builder/blueprint";
import type { DataReader } from "../src/lib/builder/run";
import { extractA2aDeliverable } from "../src/lib/delivery";
import { asksForSecrets } from "../src/lib/quest-eligibility";
import samples from "./fixtures/builder-samples.json";

function sample(name: keyof typeof samples): Blueprint {
  const check = validateBlueprint(samples[name]);
  if (!check.ok) throw new Error(check.errors.join("; "));
  return check.blueprint;
}

const POOL = {
  pair: "WBNB/USDT",
  pool: "0x0000000000000000000000000000000000000abc",
  feeTier: 500,
  price: 9.885312,
  blockNumber: 123,
  sqrtPriceX96: "25198607551688324341071279158",
  tickSpacing: 10,
  baseIsToken0: false,
  decimals0: 18,
  decimals1: 18,
};
const read: DataReader = async () => ({ ...POOL });

// the verifier's own question; an agent has to answer it to be recorded as working
const STATUS_QUESTION = "report your status in one sentence";

describe("the three sample agents answer a task", () => {
  it("health factor watcher, from a data part", async () => {
    const reply = await answerBuiltAgent(sample("healthWatcher"), {
      task: "Check my loan",
      input: { collateral: 10000, debt: 6500, threshold: 0.8 },
    });
    expect(reply.state).toBe("completed");
    expect(reply.text).toContain("Health factor 1.2308 (caution)");
    expect(reply.artifact).toMatchObject({
      capability: "health-factor",
      skill: "check-health",
      status: "ok",
      inputs: { collateral: 10000, debt: 6500, threshold: 0.8 },
      result: { hf: { healthFactor: 1.2308, collateralDropPercent: 18.75 } },
      readOnly: true,
    });
  });

  it("health factor watcher, from a sentence", async () => {
    const reply = await answerBuiltAgent(sample("healthWatcher"), {
      task: "What is my health factor with collateral $10,000 and debt 6500?",
    });
    expect(reply.state).toBe("completed");
    expect(reply.text).toContain("Health factor 1.2308 (caution)");
  });

  it("PancakeSwap range planner, with the pool it read named in the answer", async () => {
    const reply = await answerBuiltAgent(sample("rangePlanner"), { task: "Plan a range", input: { widthPercent: 10, deposit: 100 } }, { read });
    expect(reply.state).toBe("completed");
    expect(reply.text).toMatch(/^WBNB is at 9\.89 USDT at block 123\. A 10% range runs from /);
    expect(reply.artifact.sources).toEqual({ pool: { price: 9.885312, feeTier: 500, blockNumber: 123, pool: POOL.pool } });
  });

  it("yield comparer", async () => {
    const reply = await answerBuiltAgent(sample("yieldComparer"), {
      task: "Which is better?",
      input: { principal: 10000, apyA: 8, apyB: 9.5, feeBpsA: 50, feeBpsB: 200 },
    });
    expect(reply.state).toBe("completed");
    expect(reply.text).toContain("The better one is option B, by 0.1248 percentage points.");
  });
});

describe("a message that is not a task", () => {
  it("answers the verifier's status question with what the agent does and how to call it", async () => {
    for (const name of ["healthWatcher", "rangePlanner", "yieldComparer"] as const) {
      const bp = sample(name);
      const reply = await answerBuiltAgent(bp, { task: STATUS_QUESTION });
      expect(reply).toEqual(capabilityReply(bp));
      expect(reply.state).toBe("completed");
      expect(reply.text.startsWith(`${bp.name}. ${bp.description}`)).toBe(true);
      expect(reply.text).toContain(JSON.stringify({ kind: "data", data: { input: bp.skills[0].example } }));
      expect(asksForSecrets(reply.text)).toBe(false);
    }
  });

  it("asks for what is missing when only some inputs came, and guesses nothing", async () => {
    const reply = await answerBuiltAgent(sample("healthWatcher"), { task: "collateral is 1000" });
    expect(reply.state).toBe("input-required");
    expect(reply.text).toContain("Provide debt.");
    expect(reply.artifact).toMatchObject({ status: "input-required", missing: ["debt"], received: { collateral: 1000 } });
  });

  it("says a value is wrong in the caller's word for it", async () => {
    const reply = await answerBuiltAgent(sample("healthWatcher"), { task: "", input: { collateral: -5, debt: 10 } });
    expect(reply.state).toBe("input-required");
    expect(reply.text).toContain("Fix: collateral must be a number above 0.");
  });

  it("fails without a figure when its data cannot be read", async () => {
    const reply = await answerBuiltAgent(sample("rangePlanner"), { task: "", input: { widthPercent: 10 } }, {
      read: async () => ({ error: "Could not read PancakeSwap on chain 97: no answer within 6 seconds" }),
    });
    expect(reply.state).toBe("failed");
    expect(reply.text).toBe(
      "I could not complete this, so I have not given a figure: Could not read PancakeSwap on chain 97: no answer within 6 seconds.",
    );
  });
});

describe("reading values out of a sentence", () => {
  const skill = sample("yieldComparer").skills[0];

  it("finds an input by its id, its id in words, or its label", () => {
    expect(inputsFromText(skill, "principal 5,000 with apyA = 8 and APY of option B: 9.5")).toEqual({
      principal: 5000,
      apyA: 8,
      apyB: 9.5,
    });
    expect(inputsFromText(sample("rangePlanner").skills[0], "use a width percent of 12")).toEqual({ widthPercent: 12 });
  });

  it("does not read a number out of the middle of another word", () => {
    expect(inputsFromText(sample("healthWatcher").skills[0], "indebted 500")).toEqual({});
  });

  it("scans a long hostile message in no time", () => {
    const skill = sample("yieldComparer").skills[0];
    for (const filler of [" ".repeat(200_000), " : = ".repeat(40_000), "\t\n ".repeat(60_000)]) {
      const started = Date.now();
      expect(inputsFromText(skill, `principal${filler}x apyA${filler}x`)).toEqual({});
      expect(Date.now() - started).toBeLessThan(250);
    }
  });

  it("reads through ordinary spacing and line breaks", () => {
    expect(inputsFromText(sample("healthWatcher").skills[0], "collateral:   10,000\n debt\tis 6500")).toEqual({
      collateral: 10000,
      debt: 6500,
    });
  });

  it("lets a data part win over the sentence", async () => {
    const reply = await answerBuiltAgent(sample("healthWatcher"), {
      task: "collateral 1 and debt 1",
      input: { collateral: 10000, debt: 6500 },
    });
    expect(reply.text).toContain("Health factor 1.2308");
  });
});

describe("choosing a skill", () => {
  const two = sample("healthWatcher");
  two.skills.push({ ...sample("yieldComparer").skills[0] });

  it("takes the one the message names, else the one whose inputs it carries", () => {
    expect(pickSkill(two, { task: "", input: { skill: "compare-yields" } })?.id).toBe("compare-yields");
    expect(pickSkill(two, { task: "", input: { principal: 1, apyA: 2 } })?.id).toBe("compare-yields");
    expect(pickSkill(two, { task: "", input: { collateral: 1 } })?.id).toBe("check-health");
    expect(pickSkill(two, { task: STATUS_QUESTION })).toBeNull();
  });

  it("tells a caller how to name a skill when the agent has more than one", () => {
    expect(capabilityReply(two).text).toContain('To pick a skill by name, add "skill" to the data part with one of check-health, compare-yields.');
    expect(capabilityReply(sample("healthWatcher")).text).not.toContain("To pick a skill");
  });

  it("ignores a skill name that only an object's prototype has", () => {
    const inherited = Object.create({ skill: "compare-yields" }) as Record<string, unknown>;
    expect(pickSkill(two, { task: "", input: inherited })).toBeNull();
  });
});

describe("the agent card", () => {
  const card = builtAgentCard(sample("healthWatcher"), { origin: "https://api.agentsouk.xyz/", id: "ab12" });

  it("points at the hosted endpoint and carries what the agent page shows a buyer", () => {
    expect(card.url).toBe("https://api.agentsouk.xyz/api/built/ab12/a2a");
    expect(card.supportedInterfaces).toEqual([{ url: card.url, transport: "JSONRPC" }]);
    expect(card.skills[0].inputSchema).toEqual({
      type: "object",
      properties: {
        collateral: { type: "number", description: "current value of the collateral in USD" },
        debt: { type: "number", description: "current value of the debt in USD" },
        threshold: { type: "number", description: "fraction above 0 and at most 1, such as 0.8" },
      },
      required: ["collateral", "debt"],
      examples: [{ collateral: 10000, debt: 6500, threshold: 0.8 }],
    });
    expect(card.skills[0].examples).toEqual(["Health factor check for collateral 10000, debt 6500, threshold 0.8"]);
    expect(card.skills[0].tags).toEqual(["health-factor"]);
  });

  it("gives an example sentence the agent itself can answer", async () => {
    const reply = await answerBuiltAgent(sample("healthWatcher"), { task: card.skills[0].examples[0] });
    expect(reply.state).toBe("completed");
    expect(reply.text).toContain("Health factor 1.2308");
  });
});

describe("what the marketplace reads from a reply", () => {
  it("finds the agent's words in the task envelope the runtime will send", async () => {
    const reply = await answerBuiltAgent(sample("healthWatcher"), { task: "", input: { collateral: 10000, debt: 6500 } });
    const envelope = {
      task: {
        kind: "task",
        status: { state: reply.state, message: { role: "agent", parts: [{ kind: "text", text: reply.text }] } },
        artifacts: [{ parts: [{ kind: "data", data: reply.artifact }] }],
      },
    };
    const extracted = extractA2aDeliverable(envelope);
    expect(extracted.found).toBe(true);
    expect(extracted.state).toBe("completed");
    expect(extracted.text.startsWith("Health factor 1.2308 (caution)")).toBe(true);
  });
});
