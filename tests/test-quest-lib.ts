// the passport's own logic: which stamps a progress reading earns, how many of them finish a
// passport, which quest link belongs to which agent, and state that survives a browser with no
// storage at all
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QUEST_STEPS,
  questPicks,
  questStepFor,
  requiredDone,
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
    agentsHired: 0,
    requiredHires: 2,
    team: false,
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
  it("reads the hires by how many agents were hired and the listing", () => {
    const s = stampsFrom(progress({ agentsHired: 1, listedOne: true }));
    expect(s).toEqual({ first: true, stall: true, second: false });
    expect(stampsFrom(progress({ agentsHired: 3 }))).toMatchObject({ first: true, second: true });
    expect(stampsFrom(null)).toEqual({ first: false, stall: false, second: false });
  });

  it("counts the stamps that finish a passport", () => {
    expect(requiredDone(progress({ agentsHired: 2, listedOne: true }))).toBe(3);
    expect(requiredDone(progress({ agentsHired: 1 }))).toBe(1);
    expect(requiredDone(null)).toBe(0);
  });
});

describe("quest links", () => {
  it("open a hire step for any agent, with the task only where it is known", () => {
    expect(questStepFor("first", 97, "2504")?.agent.task).toBeTruthy();
    expect(questStepFor("first", 97, "2238")?.agent.name).toBe("Keel");
    // an agent the step does not know still opens the step, with nothing filled in
    expect(questStepFor("first", 97, "9999")).toEqual({
      step: QUEST_STEPS.find((s) => s.key === "first"),
      agent: { tokenId: "9999", name: "" },
    });
    expect(questStepFor("first", 56, "2504")?.agent.task).toBeUndefined();
    expect(questStepFor("stall", 97, "2504")).toBeNull();
    expect(questStepFor("seal", 97, "2504")).toBeNull();
    expect(questStepFor(null, 97, "2504")).toBeNull();
  });

  it("fill in the structured input for the agents that need it", () => {
    const first = QUEST_STEPS.find((s) => s.key === "first")!;
    const second = QUEST_STEPS.find((s) => s.key === "second")!;
    expect(first.agents?.[97]?.primary.input).toBeTruthy();
    expect(second.agents?.[97]?.alternate?.input).toBeTruthy();
  });
});

describe("quest picks", () => {
  const health = QUEST_STEPS.find((s) => s.key === "first")!;
  const agent = (tokenId: string, name: string, owner = "0xowner") => ({ tokenId, name, owner });
  const guard = agent("2504", "Souk Health Guard");
  const keel = agent("2238", "Keel");

  it("offers the agent a job has completed on first, in the shelf's order", () => {
    const picks = questPicks(health, 97, { confirmed: [agent("7001", "Newcomer"), guard], working: [guard, keel] }, null);
    expect(picks.map((p) => p.tokenId)).toEqual(["7001"]);
    // the featured pick is the confirmed one the shelf rotated to the front
    expect(questPicks(health, 97, { confirmed: [keel, agent("7001", "Newcomer")], working: [] }, null)[0].tokenId).toBe("2238");
  });

  it("serves one agent per card, not a pair", () => {
    const picks = questPicks(
      health,
      97,
      { confirmed: [agent("7001", "A"), agent("7002", "B")], working: [agent("7001", "A"), guard] },
      null,
    );
    expect(picks.map((p) => p.tokenId)).toEqual(["7001"]);
  });

  it("offers the first working agent while none is confirmed", () => {
    const picks = questPicks(health, 97, { confirmed: [], working: [agent("7001", "Unproven"), keel, guard] }, null);
    expect(picks.map((p) => p.tokenId)).toEqual(["7001"]);
  });

  it("never offers the visitor's own agent", () => {
    const picks = questPicks(health, 97, { confirmed: [agent("7001", "Mine", "0xME"), keel], working: [] }, "0xme");
    expect(picks.map((p) => p.tokenId)).toEqual(["2238"]);
  });

  it("skips an agent the wallet has already hired", () => {
    const picks = questPicks(health, 97, { confirmed: [keel, guard], working: [guard] }, null, new Set(["2238"]));
    expect(picks.map((p) => p.tokenId)).toEqual(["2504"]);
  });

  it("falls back to the written picks only when the shelf cannot be read", () => {
    expect(questPicks(health, 97, undefined, null).map((p) => p.tokenId)).toEqual(["2504"]);
    expect(questPicks(health, 56, undefined, null)).toEqual([]);
    // a shelf that was read and offers nothing is believed, so no dead agent is suggested
    expect(questPicks(health, 97, { confirmed: [], working: [] }, null)).toEqual([]);
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
    writeSeenStamps("0xabc", ["first", "second"]);
    expect(readSeenStamps("0xabc")).toEqual(["first", "second"]);
    writeSeenPoints("0xabc", 250);
    expect(readSeenPoints("0xabc")).toBe(250);
    data.set("souk.quest.v1.seen.0xabc", '["first","nonsense"]');
    expect(readSeenStamps("0xabc")).toEqual(["first"]);
  });
});
