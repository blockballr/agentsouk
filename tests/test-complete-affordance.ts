// The buyer attests a delivered ERC-8183 job where the delivery happened, not on
// a page a newcomer has to find. The offer is a pure function of the job status,
// so it can only appear for a state the server has confirmed: Submitted offers
// completion, Funded offers nothing but the refund path, terminal offers nothing.
import { describe, expect, it } from "vitest";
import { completionOffer, jobClosed } from "../apps/web/src/pages/AgentDetailPage";

describe("completion affordance from the job status", () => {
  it("offers complete while the job is Submitted", () => {
    expect(completionOffer("Submitted")).toBe("complete");
  });

  it("offers nothing but the refund path while the job is Funded", () => {
    expect(completionOffer("Funded")).toBe("refund");
  });

  it("offers nothing once the job is Completed", () => {
    expect(completionOffer("Completed")).toBe("none");
  });

  it("never offers a completion the server has not confirmed", () => {
    for (const status of [null, undefined, "Open", "Rejected", "Expired", ""]) {
      expect(completionOffer(status), String(status)).toBe("none");
    }
  });
});

describe("a closed hire", () => {
  it("closes on a completed, rejected or expired job and hands back the hire button", () => {
    for (const status of ["Completed", "Rejected", "Expired"]) expect(jobClosed(status), status).toBe(true);
  });

  it("keeps the run open while the job is still in flight or unknown", () => {
    for (const status of [null, undefined, "", "Open", "Funded", "Submitted"]) expect(jobClosed(status), String(status)).toBe(false);
  });
});
