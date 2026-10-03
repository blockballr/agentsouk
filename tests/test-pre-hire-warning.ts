// A listing whose last check failed stays on the shelf, so the buyer is warned
// before signing rather than after paying. The warning names what the check
// found and when, and a delivered or unchecked listing carries none.
import { describe, expect, it } from "vitest";
import { freshnessLine, preHireWarning } from "../apps/web/src/pages/AgentDetailPage";

const checkedAt = "2026-09-29T06:40:00.000Z";

describe("pre-hire warning from the last verification", () => {
  it("warns on a stale listing with the date it was checked", () => {
    const text = preHireWarning({ status: "dead", checkedAt });
    expect(text).toContain("2026-09-29");
    expect(text).toContain("no usable answer");
  });

  it("warns when there is no endpoint the marketplace can call", () => {
    expect(preHireWarning({ status: "unreachable", checkedAt })).toContain("no endpoint");
  });

  it("warns when the endpoint sits behind its own access gate", () => {
    expect(preHireWarning({ status: "gated", checkedAt })).toContain("access gate");
  });

  it("says payment settles before the agent is asked for anything", () => {
    expect(preHireWarning({ status: "dead", checkedAt })).toContain("settles to the agent's wallet when you sign");
  });

  it("stays silent for a delivered listing or one never checked", () => {
    expect(preHireWarning({ status: "delivered", checkedAt })).toBeNull();
    expect(preHireWarning(undefined)).toBeNull();
  });

  it("says the check behind the warning is the marketplace's own", () => {
    expect(preHireWarning({ status: "unreachable", checkedAt })).toMatch(/^The marketplace last checked this agent on 2026-09-29 and/);
  });
});

// the registry's health probe and our own check run at different times, and a page
// that dated both as "last checked" read as contradicting itself
describe("freshness line names whose check each date is", () => {
  const ago = (iso: string) => `ago(${iso.slice(0, 10)})`;

  it("names 8004scan's probe and the marketplace's check separately", () => {
    expect(freshnessLine("2026-09-29T00:31:03Z", "2026-09-29T23:35:05Z", "2026-09-28T06:58:01Z", ago)).toBe(
      "Registry record last updated ago(2026-09-29). Endpoint probed by the registry index ago(2026-09-29), and by the marketplace on 2026-09-28.",
    );
  });

  it("keeps each check out when it never ran", () => {
    expect(freshnessLine("2026-09-29T00:31:03Z", null, "2026-09-28T06:58:01Z", ago)).toBe(
      "Registry record last updated ago(2026-09-29). Endpoint checked by the marketplace on 2026-09-28.",
    );
    expect(freshnessLine(null, "2026-09-29T23:35:05Z", undefined, ago)).toBe(
      "Registry record last updated unknown. Endpoint probed by the registry index ago(2026-09-29).",
    );
    expect(freshnessLine(undefined, null, null, ago)).toBe("Registry record last updated unknown.");
  });
});
