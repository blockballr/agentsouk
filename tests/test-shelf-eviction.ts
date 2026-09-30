// Pins the decisions that let a delisted or silent agent leave the shelf, and
// the staleness and snapshot-admission rules that keep the rest honest. These
// are the pure functions scanner.ts will call; no network here.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AgentRemovedError,
  DEFAULT_FRESHNESS_WINDOW,
  FRESH_ADMISSION_MS,
  classifyLiveReadFailure,
  isFreshAdmission,
  shelfActionOnFailure,
  shelfFreshness,
  shouldAdmitSnapshotEntry,
  snapshotEndpointRegime,
} from "../src/lib/agent-index";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// The bug: a delisted agent is served from the snapshot forever. The decision is
// what a failed live read does to the cached entry.
describe("shelf action on a failed live read", () => {
  it("evicts a definitive not-found", () => {
    expect(shelfActionOnFailure({ kind: "not_found", status: 404 })).toBe("evict");
    expect(shelfActionOnFailure({ kind: "not_found", status: 410 })).toBe("evict");
    expect(shelfActionOnFailure({ kind: "not_found", status: null })).toBe("evict");
  });

  // A slow agent is not a dead agent, so a timeout must not evict.
  it("keeps a timed-out entry and marks it stale", () => {
    expect(shelfActionOnFailure({ kind: "timeout" })).toBe("keep_stale");
  });

  // A registry fault is our outage, not the agent's, so it neither evicts nor
  // labels the entry unhealthy.
  it("keeps an entry on any other fault", () => {
    expect(shelfActionOnFailure({ kind: "error" })).toBe("keep");
    expect(shelfActionOnFailure({ kind: "error", message: "8004scan agents 500" })).toBe("keep");
  });
});

// A registration confirmed on chain is shelved before the index has it, so a
// not-found inside the window must not evict it, and one after the window may.
describe("fresh admission window", () => {
  const now = Date.parse("2026-09-30T12:00:00.000Z");

  it("holds a listing admitted moments ago", () => {
    expect(isFreshAdmission(new Date(now - 30_000).toISOString(), now)).toBe(true);
  });

  it("lets go once the window has passed", () => {
    expect(isFreshAdmission(new Date(now - FRESH_ADMISSION_MS).toISOString(), now)).toBe(false);
  });

  it("never holds an entry that was not admitted on confirm", () => {
    expect(isFreshAdmission(undefined, now)).toBe(false);
    expect(isFreshAdmission("not a date", now)).toBe(false);
  });
});

// The classifier is the boundary the scanner calls with whatever it has; its
// overriding safety property is that no unrecognised input can evict.
describe("classifying a live read failure", () => {
  it("reads 404 and 410 as definitive removal", () => {
    expect(classifyLiveReadFailure({ status: 404 })).toEqual({ kind: "not_found", status: 404 });
    expect(classifyLiveReadFailure({ status: 410 })).toEqual({ kind: "not_found", status: 410 });
  });

  it("reads an explicit removal error as not-found", () => {
    expect(classifyLiveReadFailure({ error: new AgentRemovedError(404) })).toEqual({
      kind: "not_found",
      status: 404,
    });
  });

  it("reads a timeout or abort as a timeout", () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifyLiveReadFailure({ error: timeout })).toEqual({ kind: "timeout" });
    expect(classifyLiveReadFailure({ error: abort })).toEqual({ kind: "timeout" });
  });

  it("reads a server fault as an error, not a removal", () => {
    expect(classifyLiveReadFailure({ status: 500 })).toEqual({
      kind: "error",
      message: undefined,
    });
    expect(classifyLiveReadFailure({ status: 429 })).toEqual({
      kind: "error",
      message: undefined,
    });
  });

  it("reads any remaining error as an error", () => {
    expect(classifyLiveReadFailure({ error: new Error("ECONNRESET") })).toEqual({
      kind: "error",
      message: "ECONNRESET",
    });
  });

  // No status and no error is exactly the ambiguous null fetchAgentDetail
  // currently returns; it must never be treated as a removal.
  it("never evicts on a missing signal", () => {
    for (const failure of [
      classifyLiveReadFailure({}),
      classifyLiveReadFailure({ status: null }),
      classifyLiveReadFailure({ status: 200 }),
    ]) {
      expect(shelfActionOnFailure(failure)).toBe("keep");
    }
  });
});

// Where data is stale the page must say so rather than hide it, so the states
// are derived from the last confirmed time alone.
describe("shelf staleness", () => {
  const window = { staleAfterMs: HOUR, overdueAfterMs: DAY };
  const at = 1_000 * DAY;

  it("is unknown when an entry was never confirmed", () => {
    expect(shelfFreshness(null, at, window)).toBe("unknown");
  });

  it("is fresh on a recent confirmation", () => {
    expect(shelfFreshness(at, at, window)).toBe("fresh");
    expect(shelfFreshness(at - (HOUR - 1), at, window)).toBe("fresh");
  });

  it("turns stale exactly at the stale bound", () => {
    expect(shelfFreshness(at - (HOUR - 1), at, window)).toBe("fresh");
    expect(shelfFreshness(at - HOUR, at, window)).toBe("stale");
  });

  it("stays stale until the overdue bound", () => {
    expect(shelfFreshness(at - (DAY - 1), at, window)).toBe("stale");
    expect(shelfFreshness(at - DAY, at, window)).toBe("overdue");
  });

  it("is overdue well past the overdue bound", () => {
    expect(shelfFreshness(at - DAY * 10, at, window)).toBe("overdue");
  });

  // A confirmation from the future is clock skew, not a reason to alarm.
  it("treats a future confirmation as fresh", () => {
    expect(shelfFreshness(at + DAY, at, window)).toBe("fresh");
  });

  it("ships defaults far enough above the refresh cooldown to trust a top-up", () => {
    expect(DEFAULT_FRESHNESS_WINDOW.staleAfterMs).toBeGreaterThan(60_000);
    expect(DEFAULT_FRESHNESS_WINDOW.overdueAfterMs).toBeGreaterThan(
      DEFAULT_FRESHNESS_WINDOW.staleAfterMs,
    );
  });
});

// The chain-56 snapshot predates endpoint capture; gating it on an endpoint
// would wipe it. The regime is decided once for the snapshot.
describe("snapshot endpoint regime", () => {
  const endpoint = "https://agent.example/x";

  it("is endpoint-less for an empty snapshot", () => {
    expect(snapshotEndpointRegime([])).toBe("no-endpoints");
  });

  it("is endpoint-less when almost every entry lacks an endpoint", () => {
    const agents = [
      { a2a_endpoint: endpoint },
      ...Array.from({ length: 99 }, () => ({ a2a_endpoint: null, mcp_server: null })),
    ];
    expect(snapshotEndpointRegime(agents)).toBe("no-endpoints");
  });

  it("is endpoint-bearing when most entries carry an endpoint", () => {
    expect(
      snapshotEndpointRegime([
        { a2a_endpoint: endpoint },
        { mcp_server: endpoint },
        { a2a_endpoint: null, mcp_server: null },
      ]),
    ).toBe("endpoints-available");
  });

  // A strict majority is required, so an even split stays endpoint-less and no
  // shelf is emptied on a coin flip.
  it("does not flip on an exact half", () => {
    expect(
      snapshotEndpointRegime([{ a2a_endpoint: endpoint }, { a2a_endpoint: null }]),
    ).toBe("no-endpoints");
  });

  it("does not count an empty string as an endpoint", () => {
    expect(
      snapshotEndpointRegime([
        { a2a_endpoint: endpoint },
        { a2a_endpoint: "" },
        { mcp_server: "" },
      ]),
    ).toBe("no-endpoints");
  });

  // Read the committed snapshots themselves: the distinction the brief names.
  it("classifies the committed chain-56 snapshot as endpoint-less", () => {
    const snap = JSON.parse(
      readFileSync(path.join(process.cwd(), "data", "agents.json"), "utf8"),
    ) as { agents: { a2a_endpoint?: string | null; mcp_server?: string | null }[] };
    expect(snapshotEndpointRegime(snap.agents)).toBe("no-endpoints");
  });

  it("classifies the committed chain-97 snapshot as endpoint-bearing", () => {
    const snap = JSON.parse(
      readFileSync(path.join(process.cwd(), "data", "agents-97.json"), "utf8"),
    ) as { agents: { a2a_endpoint?: string | null; mcp_server?: string | null }[] };
    expect(snapshotEndpointRegime(snap.agents)).toBe("endpoints-available");
  });
});

describe("snapshot admission", () => {
  const publicEndpoint = "https://agent.example/x";
  const privateEndpoint = "http://localhost:8080/";

  // The point of the regime: a classified entry with no endpoint still sits on
  // an endpoint-less shelf rather than being gated off by a field it lacks.
  it("admits a classified entry without an endpoint when the snapshot is endpoint-less", () => {
    expect(shouldAdmitSnapshotEntry({ category: "yield" }, "no-endpoints")).toBe(true);
    expect(
      shouldAdmitSnapshotEntry(
        { a2a_endpoint: null, mcp_server: null, category: "rebalancing" },
        "no-endpoints",
      ),
    ).toBe(true);
  });

  it("still refuses an unclassified entry when the snapshot is endpoint-less", () => {
    expect(shouldAdmitSnapshotEntry({ category: "general" }, "no-endpoints")).toBe(false);
    expect(
      shouldAdmitSnapshotEntry(
        { a2a_endpoint: publicEndpoint, category: "general" },
        "no-endpoints",
      ),
    ).toBe(false);
    expect(shouldAdmitSnapshotEntry({}, "no-endpoints")).toBe(false);
  });

  // The endpoint is not consulted at all in this regime, so even a private one
  // does not drop a classified entry.
  it("ignores endpoints entirely when the snapshot is endpoint-less", () => {
    expect(
      shouldAdmitSnapshotEntry({ a2a_endpoint: privateEndpoint, category: "yield" }, "no-endpoints"),
    ).toBe(true);
  });

  it("applies the full gate when the snapshot carries endpoints", () => {
    expect(
      shouldAdmitSnapshotEntry(
        { a2a_endpoint: publicEndpoint, category: "yield" },
        "endpoints-available",
      ),
    ).toBe(true);
    expect(
      shouldAdmitSnapshotEntry({ category: "yield" }, "endpoints-available"),
    ).toBe(false);
    expect(
      shouldAdmitSnapshotEntry(
        { a2a_endpoint: privateEndpoint, category: "yield" },
        "endpoints-available",
      ),
    ).toBe(false);
    expect(
      shouldAdmitSnapshotEntry(
        { a2a_endpoint: publicEndpoint, category: "general" },
        "endpoints-available",
      ),
    ).toBe(false);
  });

  // The concrete regression: loading the chain-56 snapshot under its own regime
  // must leave a populated shelf, not an empty one.
  it("does not empty the committed chain-56 shelf", () => {
    const snap = JSON.parse(
      readFileSync(path.join(process.cwd(), "data", "agents.json"), "utf8"),
    ) as {
      agents: { a2a_endpoint?: string | null; mcp_server?: string | null; category?: string }[];
    };
    const regime = snapshotEndpointRegime(snap.agents);
    const admitted = snap.agents.filter((a) => shouldAdmitSnapshotEntry(a, regime));
    expect(admitted.length).toBeGreaterThan(100);
  });
});
