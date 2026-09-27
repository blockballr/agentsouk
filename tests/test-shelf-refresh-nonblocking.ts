// The browse read must never wait on 8004scan. Before the fix queryAgents
// awaited a live top up inside the request; now it schedules one and returns.
// These pin the scheduling: the response comes back while the registry call is
// still open, the cooldown still admits at most one pull, the result carries the
// last completed top up time, and the sanctioned after() is what gets the work.
// No real network here.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

interface FetchResponse {
  ok: boolean;
  json: () => Promise<unknown>;
}

// A fetch whose settlement the test controls, so it can observe the read path
// finishing while the registry call is still unresolved.
function controlledFetch() {
  const calls: string[] = [];
  let settled = false;
  let settle!: (value: FetchResponse) => void;
  const pending = new Promise<FetchResponse>((resolve) => {
    settle = (value) => {
      settled = true;
      resolve(value);
    };
  });
  const fetchMock = vi.fn((input: unknown) => {
    calls.push(String(input));
    return pending;
  });
  return {
    fetchMock,
    calls,
    wasSettled: () => settled,
    settle: (value: FetchResponse) => settle(value),
  };
}

const EMPTY_PAGE: FetchResponse = {
  ok: true,
  json: async () => ({
    success: true,
    data: [],
    meta: { pagination: { page: 1, limit: 100, total: 0, hasMore: false } },
  }),
};

// A fresh module instance per test resets the in-memory index and its clocks.
async function freshScanner() {
  vi.resetModules();
  return import("../src/lib/scanner");
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("next/server");
});

describe("browse read no longer awaits the shelf top up", () => {
  it("returns the snapshot while the live top up is still unresolved", async () => {
    const { fetchMock, calls, wasSettled, settle } = controlledFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { queryAgents } = await freshScanner();

    const result = await queryAgents({ limit: 5 });

    // The snapshot served the page, the registry call is open, and the response
    // still came back, so the read path cannot have awaited it.
    expect(result.items.length).toBeGreaterThan(0);
    expect(calls.length).toBe(1);
    expect(wasSettled()).toBe(false);

    settle(EMPTY_PAGE);
    await flush();
  });

  it("pulls the registry at most once inside the cooldown", async () => {
    const { fetchMock, calls, settle } = controlledFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { queryAgents } = await freshScanner();

    await Promise.all([
      queryAgents({ limit: 5 }),
      queryAgents({ limit: 5 }),
      queryAgents({ limit: 5 }),
    ]);
    await flush();

    expect(calls.length).toBe(1);

    settle(EMPTY_PAGE);
    await flush();
  });

  it("reports when the shelf was last topped up", async () => {
    const { fetchMock, settle } = controlledFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { queryAgents } = await freshScanner();

    // The top up was scheduled but has not completed, so nothing is claimed yet.
    const before = await queryAgents({ limit: 5 });
    expect(before.indexStatus.lastTopUpAt).toBeNull();

    settle(EMPTY_PAGE);
    await flush();

    const after = await queryAgents({ limit: 5 });
    expect(typeof after.indexStatus.lastTopUpAt).toBe("number");
  });
});

describe("the sanctioned after() path", () => {
  it("hands the top up to after() rather than a floating promise", async () => {
    const scheduled: (() => unknown)[] = [];
    vi.doMock("next/server", () => ({
      after: (task: () => unknown) => {
        scheduled.push(task);
      },
    }));
    const { fetchMock, calls, settle } = controlledFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { queryAgents } = await freshScanner();

    await queryAgents({ limit: 5 });

    // after() holds the work and has not run it, so the registry is untouched.
    expect(scheduled.length).toBe(1);
    expect(calls.length).toBe(0);

    // Running the scheduled callback performs the top up.
    void scheduled[0]();
    await flush();
    expect(calls.length).toBe(1);

    settle(EMPTY_PAGE);
    await flush();
  });
});
