// Pins the denominator's precedence: the shared stored total wins, then the
// registry total a snapshot recorded, then unknown. A per-instance live reading
// is never allowed to stand in for a snapshot that lacks one, because that is
// what made the old single field flicker between instances. Also pins the
// absent-database path, where nothing is stored and the total stays unknown.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));

// No database in this file, so the durable reads stay no-ops and the absent
// path is what every real-store test below exercises.
delete process.env.DATABASE_URL;

import {
  loadRegistryTotal,
  saveRegistryTotal,
  shelfStoreMode,
} from "../src/lib/shelf-store";
import { resolveShelfCounts } from "../src/lib/scanner";

// The chain-97 snapshot the reader tests below serve, read from the file rather
// than pinned, so a rebuild that grows the shelf or records a total does not
// break a test that is about two instances agreeing rather than a size.
const chain97 = () =>
  JSON.parse(
    readFileSync(path.join(process.cwd(), "data", "agents-97.json"), "utf8"),
  ) as { agents: unknown[]; source: { registryTotal?: number } };

afterEach(() => {
  delete process.env.TARGET_CHAIN;
  vi.unstubAllGlobals();
  vi.doUnmock("../src/lib/shelf-store");
});

describe("registry total precedence", () => {
  it("prefers the shared stored total over the snapshot and the live reading", () => {
    expect(
      resolveShelfCounts({
        snapshotAgents: 21,
        storedRegistryTotal: 2462,
        snapshotRegistryTotal: 111,
        liveUpstreamTotal: 9999,
      }),
    ).toEqual({ snapshotTotal: 21, registryTotal: 2462 });
  });

  it("falls back to the snapshot's recorded total when nothing is stored", () => {
    expect(
      resolveShelfCounts({
        snapshotAgents: 21,
        storedRegistryTotal: null,
        snapshotRegistryTotal: 2462,
        liveUpstreamTotal: 9999,
      }),
    ).toEqual({ snapshotTotal: 21, registryTotal: 2462 });
  });

  // The committed snapshot case: no stored value and no snapshot value, so the
  // denominator is unknown and the live reading must not leak in.
  it("reports unknown when neither the store nor the snapshot has one", () => {
    expect(
      resolveShelfCounts({
        snapshotAgents: 21,
        storedRegistryTotal: null,
        snapshotRegistryTotal: null,
        liveUpstreamTotal: 2462,
      }),
    ).toEqual({ snapshotTotal: 21, registryTotal: null });
  });

  it("uses the stored total even with no snapshot, ahead of the live reading", () => {
    expect(
      resolveShelfCounts({
        snapshotAgents: null,
        storedRegistryTotal: 2462,
        snapshotRegistryTotal: null,
        liveUpstreamTotal: 9999,
      }),
    ).toEqual({ snapshotTotal: null, registryTotal: 2462 });
  });

  it("treats a zero or invalid stored total as unknown and falls through", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveShelfCounts({
          snapshotAgents: 21,
          storedRegistryTotal: value,
          snapshotRegistryTotal: 2462,
          liveUpstreamTotal: null,
        }),
      ).toEqual({ snapshotTotal: 21, registryTotal: 2462 });
    }
  });
});

describe("no database configured", () => {
  it("reports a per-process shelf rather than a shared one", () => {
    expect(shelfStoreMode()).toBe("per-process");
  });

  it("stores and reads no registry total without throwing", async () => {
    await expect(saveRegistryTotal(97, 2462)).resolves.toBeUndefined();
    await expect(loadRegistryTotal(97)).resolves.toBeNull();
    await expect(loadRegistryTotal(56)).resolves.toBeNull();
  });
});

// The reader path with no store: a fresh instance and a just-topped-up instance
// must report the same denominator. The chain-97 snapshot now records one from
// its own page read, so that recorded value is what both see, and the live
// reading a top up observes must not replace it.
describe("the served snapshot with no shared store", () => {
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

  it("keeps the denominator the snapshot recorded through a live top up", async () => {
    process.env.TARGET_CHAIN = "97";
    vi.resetModules();
    vi.stubGlobal("fetch", page(2462));
    const { queryAgents, refreshIndexFromLive } = await import(
      "../src/lib/scanner"
    );

    const snap = chain97();
    const before = await queryAgents({ limit: 1 });
    expect(before.indexStatus.snapshotTotal).toBe(snap.agents.length);
    expect(before.indexStatus.registryTotal).toBe(snap.source.registryTotal);

    await refreshIndexFromLive(1);

    const after = await queryAgents({ limit: 1 });
    expect(after.indexStatus.snapshotTotal).toBe(snap.agents.length);
    // 2462 is the live reading the top up just saw. It must not replace what the
    // snapshot recorded, or two instances would disagree and the line would flicker.
    expect(after.indexStatus.registryTotal).toBe(snap.source.registryTotal);
    expect(after.indexStatus.registryTotal).not.toBe(2462);
  });
});

// The reader path with a shared store: the stored value is what the page reads,
// not the live total the top up just saw, so both instances agree.
describe("the served snapshot with a shared store", () => {
  it("reports the stored total and never the live one", async () => {
    process.env.TARGET_CHAIN = "97";
    vi.resetModules();
    vi.doMock("../src/lib/shelf-store", () => ({
      deleteShelfAgent: async () => {},
      loadRegistryTotal: async () => 2462,
      loadShelfAgents: async () => [],
      saveRegistryTotal: async () => {},
      saveShelfAgents: async () => {},
      shelfStoreMode: () => "shared",
      summaryFromRow: () => null,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          data: [],
          meta: { pagination: { page: 1, limit: 100, total: 9999, hasMore: false } },
        }),
      })),
    );
    const { queryAgents, refreshIndexFromLive } = await import(
      "../src/lib/scanner"
    );

    const before = await queryAgents({ limit: 1 });
    expect(before.indexStatus.snapshotTotal).toBe(chain97().agents.length);
    expect(before.indexStatus.registryTotal).toBe(2462);

    await refreshIndexFromLive(1);

    const after = await queryAgents({ limit: 1 });
    expect(after.indexStatus.registryTotal).toBe(2462);
  });
});
