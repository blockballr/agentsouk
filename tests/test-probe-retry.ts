// a failed probe retries a bounded number of times, then rests so a permanently
// dead listing cannot cost a hire on every sweep
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { shouldRetryProbe, MAX_PROBE_ATTEMPTS } from "@/lib/verify-candidate";

describe("probe retry budget", () => {
  it("retries a failure while attempts remain", () => {
    expect(shouldRetryProbe("dead", 0)).toBe(true);
    expect(shouldRetryProbe("unreachable", 1)).toBe(true);
    expect(shouldRetryProbe("gated", MAX_PROBE_ATTEMPTS - 1)).toBe(true);
  });

  it("stops once the budget is spent", () => {
    expect(shouldRetryProbe("dead", MAX_PROBE_ATTEMPTS)).toBe(false);
    expect(shouldRetryProbe("unreachable", MAX_PROBE_ATTEMPTS + 5)).toBe(false);
  });

  it("never retries a pass", () => {
    expect(shouldRetryProbe("online", 0)).toBe(false);
    expect(shouldRetryProbe("delivered", 0)).toBe(false);
  });
});
