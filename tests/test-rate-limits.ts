import { beforeEach, describe, expect, it, vi } from "vitest";

// The rate limiter, the facilitator and their imports carry the "server-only"
// marker, which throws outside a server bundle; the marker is a build guard,
// not part of the logic under test.
vi.mock("server-only", () => ({}));

// Both the limiter and the nonce claim import postgres lazily. A stub whose
// statements always fail exercises the store-unavailable paths without a
// database; the memory paths never reach it.
vi.mock("postgres", () => ({
  default: () => ({
    unsafe: async () => {
      throw new Error("store unavailable");
    },
  }),
}));

import {
  clientIpFrom,
  enforceRateLimit,
  resetRateLimitsForTests,
  type RateLimitPolicy,
} from "../src/lib/rate-limit";
import { claimProdNonce, resetProdNoncesForTests } from "../src/lib/facilitator";

const POLICY: RateLimitPolicy = {
  table: "test_rate_limits",
  limit: 5,
  windowMs: 60 * 60 * 1000,
};

describe("rate limit", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetRateLimitsForTests();
  });

  it("allows the limit and refuses the next hit", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await enforceRateLimit(POLICY, { keys: ["ip:203.0.113.7"] })).allowed).toBe(true);
    }
    const blocked = await enforceRateLimit(POLICY, { keys: ["ip:203.0.113.7"] });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps each key's allowance separate", async () => {
    for (let i = 0; i < 5; i++) {
      await enforceRateLimit(POLICY, { keys: ["ip:198.51.100.1"] });
    }
    expect((await enforceRateLimit(POLICY, { keys: ["ip:198.51.100.1"] })).allowed).toBe(false);
    expect((await enforceRateLimit(POLICY, { keys: ["ip:198.51.100.2"] })).allowed).toBe(true);
  });

  it("keeps each table's allowance separate", async () => {
    const other: RateLimitPolicy = { ...POLICY, table: "other_rate_limits" };
    for (let i = 0; i < 5; i++) {
      await enforceRateLimit(POLICY, { keys: ["ip:203.0.113.9"] });
    }
    expect((await enforceRateLimit(POLICY, { keys: ["ip:203.0.113.9"] })).allowed).toBe(false);
    expect((await enforceRateLimit(other, { keys: ["ip:203.0.113.9"] })).allowed).toBe(true);
  });

  it("counts every key and returns the tightest verdict", async () => {
    for (let i = 0; i < 5; i++) {
      await enforceRateLimit(POLICY, { keys: ["ip:203.0.113.11", "payment:abc"] });
    }
    const blocked = await enforceRateLimit(POLICY, {
      keys: ["ip:203.0.113.12", "payment:abc"],
    });
    expect(blocked.allowed).toBe(false);
  });

  it("fails closed when a configured store cannot be reached", async () => {
    process.env.DATABASE_URL = "postgres://example.invalid/agora";
    await expect(enforceRateLimit(POLICY, { keys: ["ip:1.2.3.4"] })).rejects.toThrow(
      /unavailable/,
    );
  });

  it("rejects a policy with an unsafe table name", async () => {
    await expect(
      enforceRateLimit({ ...POLICY, table: "bad; drop table x" }, { keys: ["ip:1.2.3.4"] }),
    ).rejects.toThrow();
  });

  it("extracts the client ip from proxy headers", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
    expect(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});

describe("prod nonce claim", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.RECEIPTS_STORE;
    resetProdNoncesForTests();
  });

  it("claims an unseen nonce once and refuses the replay", async () => {
    const nonce = `0x${"ab".repeat(32)}`;
    expect(await claimProdNonce(nonce)).toBe(true);
    expect(await claimProdNonce(nonce)).toBe(false);
  });

  it("keeps different nonces independent", async () => {
    expect(await claimProdNonce(`0x${"01".repeat(32)}`)).toBe(true);
    expect(await claimProdNonce(`0x${"02".repeat(32)}`)).toBe(true);
  });

  it("releases the local guard on reset", async () => {
    const nonce = `0x${"cd".repeat(32)}`;
    expect(await claimProdNonce(nonce)).toBe(true);
    resetProdNoncesForTests();
    expect(await claimProdNonce(nonce)).toBe(true);
  });
});
