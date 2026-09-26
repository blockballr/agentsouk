// The cap was written twice with different values (sandbox 10, production 5) and the panel
// hardcoded 10; these pin the shared values and the one source for them.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SESSION_HOURS, SESSION_SPEND_CAP_USD } from "../packages/core/src/session";

describe("session terms", () => {
  it("exposes a single cap and duration", () => {
    expect(SESSION_SPEND_CAP_USD).toBe(5);
    expect(SESSION_HOURS).toBe(24);
  });

  it("is the only place the facilitator gets them from", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src", "lib", "facilitator.ts"),
      "utf8",
    );
    // any literal session cap left in the facilitator means a second opinion
    // exists again, which is the bug this replaced
    expect(src).not.toMatch(/spendCapUsd:\s*\d/);
    expect(src).not.toMatch(/export const SESSION_SPEND_CAP_USD/);
    expect(src).toMatch(/from "@agora\/core"/);
  });

  it("is not hardcoded in the hire panel any more", () => {
    const panel = readFileSync(
      path.join(process.cwd(), "apps", "web", "src", "pages", "AgentDetailPage.tsx"),
      "utf8",
    );
    expect(panel).not.toMatch(/\$10 cap/);
    expect(panel).toMatch(/SESSION_SPEND_CAP_USD/);
  });
});
