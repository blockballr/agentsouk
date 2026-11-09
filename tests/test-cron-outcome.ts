// A scheduled line is no longer a boolean: a failed job, a refused caller and a
// deployment with no job configured are different facts.
import { describe, expect, it } from "vitest";
import { cronOutcomeForStatus } from "../src/lib/cron-outcome";

describe("the cron outcome", () => {
  it("reads a normal answer as ok", () => {
    expect(cronOutcomeForStatus(200)).toBe("ok");
    expect(cronOutcomeForStatus(204)).toBe("ok");
    expect(cronOutcomeForStatus(304)).toBe("ok");
  });

  it("separates a failure from a refusal", () => {
    expect(cronOutcomeForStatus(500)).toBe("failed");
    expect(cronOutcomeForStatus(409)).toBe("failed");
    expect(cronOutcomeForStatus(401)).toBe("unauthorized");
    expect(cronOutcomeForStatus(403)).toBe("unauthorized");
  });

  it("names an unconfigured deployment instead of calling it failed", () => {
    expect(cronOutcomeForStatus(503)).toBe("not-configured");
  });
});
