// Pins the two catalogue sizes the marketplace reports so they cannot collapse
// back into one number. The snapshot total is how many agents the committed
// snapshot holds; the registry total is how many the registry reports for the
// served chain. The committed snapshot never recorded the latter, so it stays
// null on every instance instead of flickering to whatever a live read saw.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));

// No database in this file, so the durable shelf read stays a no-op and cannot
// slow the reader tests below.
delete process.env.DATABASE_URL;

import { resolveShelfCounts } from "../src/lib/scanner";

interface SnapshotShape {
  source: {
    fetched?: number;
    upstreamTotal?: number;
    deduped?: number;
    scoutAdded?: number;
    registryTotal?: number;
  };
  agents: unknown[];
}

function committed(file: string): SnapshotShape {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "data", file), "utf8"),
  ) as SnapshotShape;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TARGET_CHAIN;
});

describe("splitting the snapshot total from the registry total", () => {
  it("reports both when the snapshot recorded the registry total", () => {
    expect(
      resolveShelfCounts({
        snapshotAgents: 21,
        snapshotRegistryTotal: 2462,
        liveUpstreamTotal: 9999,
      }),
    ).toEqual({ snapshotTotal: 21, registryTotal: 2462 });
  });

  // The committed snapshot case: the snapshot is served, but it never recorded
  // how many agents the registry holds, so the denominator is unknown. The live
  // reading must not leak in, or a topped-up instance would disagree with a fresh
  // one and the line would flicker.
  it("reports the registry total as unknown when the snapshot did not record one", () => {
    expect(
      resolveShelfCounts({
        snapshotAgents: 21,
        snapshotRegistryTotal: null,
        liveUpstreamTotal: 2462,
      }),
    ).toEqual({ snapshotTotal: 21, registryTotal: null });
  });

  it("uses the live upstream total only when there is no snapshot", () => {
    expect(
      resolveShelfCounts({
        snapshotAgents: null,
        snapshotRegistryTotal: null,
        liveUpstreamTotal: 2462,
      }),
    ).toEqual({ snapshotTotal: null, registryTotal: 2462 });
  });

  it("reports both as unknown with no snapshot and no live reading", () => {
    expect(
      resolveShelfCounts({
        snapshotAgents: null,
        snapshotRegistryTotal: null,
        liveUpstreamTotal: null,
      }),
    ).toEqual({ snapshotTotal: null, registryTotal: null });
  });

  it("treats a zero or invalid registry total as unknown, never as of 0", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveShelfCounts({
          snapshotAgents: 21,
          snapshotRegistryTotal: value,
          liveUpstreamTotal: null,
        }),
      ).toEqual({ snapshotTotal: 21, registryTotal: null });
    }
  });

  it("treats a zero live total as unknown", () => {
    expect(
      resolveShelfCounts({
        snapshotAgents: null,
        snapshotRegistryTotal: null,
        liveUpstreamTotal: 0,
      }),
    ).toEqual({ snapshotTotal: null, registryTotal: null });
  });

  it("keeps an empty snapshot at zero rather than calling it absent", () => {
    expect(
      resolveShelfCounts({
        snapshotAgents: 0,
        snapshotRegistryTotal: null,
        liveUpstreamTotal: null,
      }),
    ).toEqual({ snapshotTotal: 0, registryTotal: null });
  });
});

// The committed files are what a fresh instance actually reads, so the unknown
// denominator is asserted against them rather than only against the pure helper.
describe("what the committed snapshots record", () => {
  it("records no registry total, so the denominator stays unknown", () => {
    for (const file of ["agents.json", "agents-97.json"]) {
      const snap = committed(file);
      expect(snap.source.registryTotal).toBeUndefined();
      expect(
        resolveShelfCounts({
          snapshotAgents: snap.agents.length,
          snapshotRegistryTotal: snap.source.registryTotal ?? null,
          liveUpstreamTotal: 2462,
        }),
      ).toEqual({ snapshotTotal: snap.agents.length, registryTotal: null });
    }
  });

  // The field the defect leaned on counts the build's own selection, so it is not
  // a registry total and never stands in for one.
  it("shows upstreamTotal matching the curated shelf size on chain 97", () => {
    const snap = committed("agents-97.json");
    expect(snap.source.fetched).toBe(21);
    expect(snap.source.upstreamTotal).toBe(21);
    expect(snap.agents.length).toBe(21);
  });
});

// The reader path: a fresh instance and a just-topped-up instance must report the
// same denominator, which for the committed snapshot is unknown on both.
describe("the served chain-97 snapshot keeps one denominator", () => {
  async function freshScanner() {
    process.env.TARGET_CHAIN = "97";
    vi.resetModules();
    return import("../src/lib/scanner");
  }

  function page(total: number) {
    return vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: [],
        meta: { pagination: { page: 1, limit: 100, total, hasMore: false } },
      }),
    }));
  }

  it("reports its own size and leaves the registry total unknown", async () => {
    vi.stubGlobal("fetch", page(2462));
    const { queryAgents } = await freshScanner();

    const result = await queryAgents({ limit: 1 });

    expect(result.indexStatus.snapshotTotal).toBe(21);
    expect(result.indexStatus.registryTotal).toBeNull();
  });

  it("does not adopt the live total after a top up", async () => {
    vi.stubGlobal("fetch", page(2462));
    const { queryAgents, refreshIndexFromLive } = await freshScanner();

    const before = await queryAgents({ limit: 1 });
    expect(before.indexStatus.registryTotal).toBeNull();

    await refreshIndexFromLive(1);

    const after = await queryAgents({ limit: 1 });
    expect(after.indexStatus.snapshotTotal).toBe(21);
    expect(after.indexStatus.registryTotal).toBeNull();
  });
});
