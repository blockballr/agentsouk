// A failed verification write once vanished silently, so a sweep could report
// a verdict the agent page never showed. upsertVerification now returns false
// instead of swallowing the failure. No Postgres is touched here; the live-DB
// success path is verified-by-cron, not by this file.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("verification persist reporting", () => {
  it("returns false when no database is configured", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { upsertVerification } = await import("../src/lib/verifications-store");
    await expect(
      upsertVerification(
        "2173",
        "Grid Runner",
        "general",
        "unreachable",
        1,
        undefined,
        "no callable endpoint registered",
      ),
    ).resolves.toBe(false);
  });
});
