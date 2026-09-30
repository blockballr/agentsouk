// the passport's own logic: which stamps a progress reading earns, the titles points reach, which
// quest link belongs to which agent, and state that survives a browser with no storage at all
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QUEST_STEPS,
  questStepFor,
  rankFor,
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
    expect(rankFor(0)).toEqual({ title: "Visitor", next: { at: 100, title: "Trader" } });
    expect(rankFor(250).title).toBe("Merchant");
    expect(rankFor(549).title).toBe("Merchant");
    expect(rankFor(550).title).toBe("Stallholder");
    expect(rankFor(1000)).toEqual({ title: "Master of the Souk", next: null });
  });
});

describe("quest links", () => {
  it("open the step only for the agent the step suggests, on its chain", () => {
    expect(questStepFor("health", 97, "2504")?.agent.name).toBe("Souk Health Guard");
    expect(questStepFor("health", 97, "2238")?.agent.name).toBe("Keel");
    expect(questStepFor("health", 97, "2237")).toBeNull();
    expect(questStepFor("health", 56, "2504")).toBeNull();
    expect(questStepFor("stall", 97, "2504")).toBeNull();
    expect(questStepFor(null, 97, "2504")).toBeNull();
  });

  it("fill in the structured input for the agents that need it", () => {
    for (const key of ["health", "grid", "rebalancing"] as const) {
      const step = QUEST_STEPS.find((s) => s.key === key)!;
      expect(step.agents?.[97]?.primary.input).toBeTruthy();
    }
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

  it("keeps the mode per wallet and for the browser, and remembers what was shown", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    writeQuestMode("0xAbC", "quit");
    expect(readQuestMode("0xabc")).toBe("quit");
    expect(readQuestMode(null)).toBe("quit");
    writeSeenStamps("0xabc", ["health", "yield"]);
    expect(readSeenStamps("0xabc")).toEqual(["health", "yield"]);
    writeSeenPoints("0xabc", 250);
    expect(readSeenPoints("0xabc")).toBe(250);
    data.set("souk.quest.v1.seen.0xabc", '["health","nonsense"]');
    expect(readSeenStamps("0xabc")).toEqual(["health"]);
  });
});
