// the verdict cache re-reads the whole table only when its fingerprint moved, since every full
// read spends the database's monthly transfer allowance and the table rarely changes
import { afterEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  process.env.TARGET_CHAIN = "97";
  return { version: null as string | null, reads: 0 };
});

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/verifications-store", () => ({
  loadVerificationsVersion: async () => store.version,
  loadVerificationsFromDb: async () => {
    store.reads += 1;
    return new Map([["2504", { status: "delivered", responseMs: 10, checkedAt: "2026-09-30T00:00:00.000Z" }]]);
  },
}));

import { loadVerifications } from "../src/lib/verifications";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the verdict cache", () => {
  it("reads in full once, then again only when the fingerprint moves or cannot be read", async () => {
    const now = vi.spyOn(Date, "now");
    let clock = 2_000_000_000;
    now.mockImplementation(() => clock);
    store.version = "40:2026-09-30T00:00:00.000Z";

    const first = await loadVerifications();
    expect(store.reads).toBe(1);
    expect(first.get("2504")?.status).toBe("delivered");

    // inside the window nothing is asked at all
    await loadVerifications();
    expect(store.reads).toBe(1);

    // past it, an unchanged fingerprint keeps the verdicts in hand
    clock += 31_000;
    expect(await loadVerifications()).toBe(first);
    expect(store.reads).toBe(1);

    clock += 31_000;
    store.version = "41:2026-09-30T00:05:00.000Z";
    await loadVerifications();
    expect(store.reads).toBe(2);

    clock += 31_000;
    store.version = null;
    await loadVerifications();
    expect(store.reads).toBe(3);
  });
});
