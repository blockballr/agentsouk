// A listing whose last check failed stays on the shelf, so the buyer is warned
// before signing rather than after paying. The warning names what the check
// found and when, and a delivered or unchecked listing carries none.
import { describe, expect, it } from "vitest";
import { preHireWarning } from "../apps/web/src/pages/AgentDetailPage";

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
});
