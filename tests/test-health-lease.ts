// The lease is what keeps two watchers from repaying the same buyer at once.
// These cover the in-process store, which is the shape every deployment uses
// until a database is present.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { memoryLeaseStore } from "../src/lib/lease-store";

describe("the buyer lease", () => {
  it("lets one holder in and turns the second away", async () => {
    const store = memoryLeaseStore();
    expect(await store.acquire("buyer", "run-a", 60_000, 1_000)).toBe(true);
    expect(await store.acquire("buyer", "run-b", 60_000, 1_000)).toBe(false);
  });

  it("lets the second run in once the first releases", async () => {
    const store = memoryLeaseStore();
    await store.acquire("buyer", "run-a", 60_000, 1_000);
    await store.release("buyer", "run-a");
    expect(await store.acquire("buyer", "run-b", 60_000, 1_000)).toBe(true);
  });

  it("ignores a release from a holder that does not own it", async () => {
    const store = memoryLeaseStore();
    await store.acquire("buyer", "run-a", 60_000, 1_000);
    await store.release("buyer", "run-b");
    expect(await store.acquire("buyer", "run-b", 60_000, 1_000)).toBe(false);
  });

  it("re-acquires for the same holder, so one run can retry", async () => {
    const store = memoryLeaseStore();
    expect(await store.acquire("buyer", "run-a", 60_000, 1_000)).toBe(true);
    expect(await store.acquire("buyer", "run-a", 60_000, 2_000)).toBe(true);
  });

  it("lets a new holder in after the lease expires", async () => {
    const store = memoryLeaseStore();
    await store.acquire("buyer", "run-a", 60_000, 1_000);
    expect(await store.acquire("buyer", "run-b", 60_000, 61_001)).toBe(true);
  });

  it("keeps buyers independent", async () => {
    const store = memoryLeaseStore();
    expect(await store.acquire("buyer-1", "run-a", 60_000, 1_000)).toBe(true);
    expect(await store.acquire("buyer-2", "run-b", 60_000, 1_000)).toBe(true);
  });
});
