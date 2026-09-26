import { beforeEach, describe, expect, it, vi } from "vitest";

// prepare-rate-limit.ts carries the "server-only" marker, which throws outside a
// server bundle; the marker is a build guard, not part of the logic under test
vi.mock("server-only", () => ({}));

import {
  enforcePrepareRateLimit,
  prepareRateKeys,
  resetForTests,
} from "../src/lib/prepare-rate-limit";

const OWNER = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";

describe("prepare rate limit", () => {
  beforeEach(() => resetForTests());

  it("allows ten preparations per key and refuses the eleventh", async () => {
    const input = { owner: OWNER, ip: "203.0.113.7" };
    for (let i = 0; i < 10; i++) {
      expect((await enforcePrepareRateLimit(input)).allowed).toBe(true);
    }
    const blocked = await enforcePrepareRateLimit(input);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("also counts the ip, so rotating owner addresses does not reset the window", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 10; i++) {
      const rotated = `0x${i.toString(16).padStart(40, "0")}`;
      await enforcePrepareRateLimit({ owner: rotated, ip });
    }
    const blocked = await enforcePrepareRateLimit({ owner: `0x${"f".repeat(40)}`, ip });
    expect(blocked.allowed).toBe(false);
  });

  it("keeps each ip's allowance separate", async () => {
    for (let i = 0; i < 10; i++) {
      await enforcePrepareRateLimit({ ip: "198.51.100.1" });
    }
    expect((await enforcePrepareRateLimit({ ip: "198.51.100.1" })).allowed).toBe(false);
    expect((await enforcePrepareRateLimit({ ip: "198.51.100.2" })).allowed).toBe(true);
  });

  it("keys on the owner when supplied and the client ip otherwise", () => {
    expect(prepareRateKeys({ owner: OWNER.toUpperCase(), ip: "1.2.3.4" })).toContain(
      `owner:${OWNER.toLowerCase()}`,
    );
    expect(prepareRateKeys({ ip: "1.2.3.4, 5.6.7.8" })).toContain("ip:1.2.3.4");
    expect(prepareRateKeys({ ip: null })).toContain("ip:unknown");
  });

  it("reports the remaining allowance counting down", async () => {
    const input = { owner: OWNER, ip: "203.0.113.20" };
    expect((await enforcePrepareRateLimit(input)).remaining).toBe(9);
    expect((await enforcePrepareRateLimit(input)).remaining).toBe(8);
  });
});
