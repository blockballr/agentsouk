// the passport's own logic: which stamps a progress reading earns, the titles points reach, which
// quest link belongs to which agent, and state that survives a browser with no storage at all
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QUEST_STEPS,
  questPicks,
  questStepFor,
  rankFor,
  questModeFor,
  readQuestMode,
  readSeenPoints,
  readSeenStamps,
  stampsFrom,
  writeQuestMode,
  writeSeenPoints,
  writeSeenStamps,
  type QuestProgress,
} from "../apps/web/src/lib/quest";

function progress(over: Partial<QuestProgress> = {}): QuestProgress {
  return {
    wallet: "0xabc",
    categories: {},
    hiredAllFour: false,
    listedOne: false,
    completed: false,
    hires: [],
    listings: [],
    points: 0,
    awards: [],
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stamps", () => {
  it("reads each category, the listing and the full set", () => {
    const s = stampsFrom(progress({ categories: { "health-factor": true, "grid-trading": true }, listedOne: true }));
    expect(s).toEqual({ health: true, yield: false, stall: true, grid: true, rebalancing: false, seal: false });
    expect(stampsFrom(progress({ completed: true })).seal).toBe(true);
    expect(stampsFrom(null)).toEqual({ health: false, yield: false, stall: false, grid: false, rebalancing: false, seal: false });
  });

  it("adds up to the thousand points the passport shows", () => {
    expect(QUEST_STEPS.reduce((sum, s) => sum + s.points, 0)).toBe(1000);
  });
});

describe("titles", () => {
  it("follow the points and name the next one", () => {
    expect(rankFor(0)).toEqual({ title: "Adventurer", next: { at: 100, title: "Trader" } });
    expect(rankFor(250).title).toBe("Merchant");
    expect(rankFor(549).title).toBe("Merchant");
    expect(rankFor(550).title).toBe("Stallholder");
    expect(rankFor(1000)).toEqual({ title: "Master of the Souk", next: null });
  });
});

describe("quest links", () => {
  it("open a hire step for any agent, with the task only where it is known", () => {
    expect(questStepFor("health", 97, "2504")?.agent.task).toBeTruthy();
    expect(questStepFor("health", 97, "2238")?.agent.name).toBe("Keel");
    // an agent the step does not know still opens the step, with nothing filled in
    expect(questStepFor("health", 97, "9999")).toEqual({
      step: QUEST_STEPS.find((s) => s.key === "health"),
      agent: { tokenId: "9999", name: "" },
    });
    expect(questStepFor("health", 56, "2504")?.agent.task).toBeUndefined();
    expect(questStepFor("stall", 97, "2504")).toBeNull();
    expect(questStepFor("seal", 97, "2504")).toBeNull();
    expect(questStepFor(null, 97, "2504")).toBeNull();
  });

  it("fill in the structured input for the agents that need it", () => {
    for (const key of ["health", "grid", "rebalancing"] as const) {
      const step = QUEST_STEPS.find((s) => s.key === key)!;
      expect(step.agents?.[97]?.primary.input).toBeTruthy();
    }
  });
});

describe("quest picks", () => {
  const health = QUEST_STEPS.find((s) => s.key === "health")!;
  const agent = (tokenId: string, name: string, owner = "0xowner") => ({ tokenId, name, owner });
  const guard = agent("2504", "Souk Health Guard");
  const keel = agent("2238", "Keel");

  it("offers agents a job has completed on first, in the shelf's order", () => {
    const picks = questPicks(health, 97, { confirmed: [agent("7001", "Newcomer"), guard], working: [guard, keel] }, null);
    expect(picks.map((p) => p.tokenId)).toEqual(["7001", "2504"]);
    // the featured pick is the confirmed one the shelf rotated to the front
    expect(questPicks(health, 97, { confirmed: [keel, agent("7001", "Newcomer")], working: [] }, null)[0].tokenId).toBe("2238");
  });

  it("keeps a place for a working agent whose task is filled in", () => {
    const picks = questPicks(
      health,
      97,
      { confirmed: [agent("7001", "A"), agent("7002", "B")], working: [agent("7001", "A"), agent("7002", "B"), guard] },
      null,
    );
    expect(picks.map((p) => p.tokenId)).toEqual(["7001", "2504"]);
    expect(picks[1].task).toBeTruthy();
  });

  it("offers the working agents it has a task for while none is confirmed", () => {
    const picks = questPicks(health, 97, { confirmed: [], working: [agent("7001", "Unproven"), keel, guard] }, null);
    expect(picks.map((p) => p.tokenId)).toEqual(["2238", "2504"]);
  });

  it("never offers the visitor's own agent", () => {
    const picks = questPicks(health, 97, { confirmed: [agent("7001", "Mine", "0xME"), keel], working: [] }, "0xme");
    expect(picks.map((p) => p.tokenId)).toEqual(["2238"]);
  });

  it("falls back to the written picks only when the shelf cannot be read", () => {
    expect(questPicks(health, 97, undefined, null).map((p) => p.tokenId)).toEqual(["2504", "2238"]);
    expect(questPicks(health, 56, undefined, null)).toEqual([]);
    // a shelf that was read and offers nothing is believed, so no dead agent is suggested
    expect(questPicks(health, 97, { confirmed: [], working: [] }, null)).toEqual([]);
    expect(questPicks(health, 97, { confirmed: [], working: [agent("7001", "Unproven")] }, null)).toEqual([]);
  });
});

describe("state in the browser", () => {
  it("does without storage, and asks again next time", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readQuestMode("0xAbC")).toBeNull();
    expect(() => writeQuestMode("0xAbC", "active")).not.toThrow();
    expect(readSeenStamps("0xabc")).toEqual([]);
    expect(readSeenPoints("0xabc")).toBe(0);
  });

  it("ties a started quest to the wallet that started it, never to the browser", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    // with no wallet connected there is nothing to start, so the invitation stays
    writeQuestMode(null, "active");
    expect(questModeFor(null)).toBeNull();
    expect(data.size).toBe(0);

    writeQuestMode("0xAbC", "active");
    expect(questModeFor("0xabc")).toBe("active");
    // the same browser with no wallet, or with another wallet, is still invited
    expect(questModeFor(null)).toBeNull();
    expect(questModeFor("0xdef")).toBeNull();

    // a value an older build left for the browser as a whole no longer counts as started
    data.set("souk.quest.v1.mode.anon", "active");
    expect(questModeFor(null)).toBeNull();
    expect(questModeFor("0xdef")).toBeNull();
  });

  it("remembers a turned-down invitation for the browser, until a wallet starts", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    const noon = Date.parse("2026-10-01T12:00:00Z");
    writeQuestMode(null, "dismissed", noon);
    expect(questModeFor(null, noon + 1000)).toBe("dismissed");
    expect(questModeFor("0xabc", noon + 1000)).toBe("dismissed");
    writeQuestMode("0xabc", "active");
    expect(questModeFor("0xabc", noon + 1000)).toBe("active");
    expect(questModeFor(null, noon + 1000)).toBe("dismissed");
  });

  it("brings the invitation back the day after it was turned down", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    const noon = Date.parse("2026-10-01T12:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    writeQuestMode("0xabc", "dismissed", noon);
    expect(questModeFor("0xabc", noon + day - 1)).toBe("dismissed");
    expect(questModeFor("0xabc", noon + day)).toBeNull();
    // one a visitor turned down before the time was kept has no date, so it is asked again
    data.clear();
    data.set("souk.quest.v1.mode.anon", "dismissed");
    expect(questModeFor(null, noon)).toBeNull();
  });

  it("keeps the mode per wallet, and remembers what was shown", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    writeQuestMode("0xAbC", "quit");
    expect(readQuestMode("0xabc")).toBe("quit");
    expect(readQuestMode(null)).toBeNull();
    writeSeenStamps("0xabc", ["health", "yield"]);
    expect(readSeenStamps("0xabc")).toEqual(["health", "yield"]);
    writeSeenPoints("0xabc", 250);
    expect(readSeenPoints("0xabc")).toBe(250);
    data.set("souk.quest.v1.seen.0xabc", '["health","nonsense"]');
    expect(readSeenStamps("0xabc")).toEqual(["health"]);
  });
});
