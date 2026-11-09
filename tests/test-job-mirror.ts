// The marketplace row and the kernel can disagree while a sweep catches up. The
// chain wins; these pin the divergence and the actions that follow from it.
import { describe, expect, it } from "vitest";
import { deriveJobMirror } from "../packages/core/src/machines/job-mirror";

const NOW = 1_800_000_000_000;

describe("the job mirror", () => {
  it("lets the chain override a stale record", () => {
    const view = deriveJobMirror({ mirrorStatus: "Funded", chainStatus: 2, now: NOW });
    expect(view.status).toBe("Submitted");
    expect(view.mirrorStatus).toBe("Funded");
    expect(view.chainStatus).toBe("Submitted");
    expect(view.divergence).toBe(true);
    expect(view.source).toBe("chain");
    expect(view.allowedActions).toEqual(["complete", "reject", "wait"]);
    expect(view.reason).toMatch(/chain says Submitted/);
  });

  it("agrees when both sides say the same thing", () => {
    const view = deriveJobMirror({ mirrorStatus: "Funded", chainStatus: 1, now: NOW });
    expect(view.divergence).toBe(false);
    expect(view.status).toBe("Funded");
    expect(view.reason).toMatch(/agree/);
  });

  it("falls back to the record when the chain cannot be read", () => {
    const view = deriveJobMirror({ mirrorStatus: "Funded", chainStatus: null, now: NOW });
    expect(view.status).toBe("Funded");
    expect(view.source).toBe("store");
    expect(view.divergence).toBe(true);
    expect(view.reason).toMatch(/did not answer/);
  });

  it("has no status when neither side answers", () => {
    const view = deriveJobMirror({ mirrorStatus: null, chainStatus: null, now: NOW });
    expect(view.status).toBeNull();
    expect(view.source).toBe("none");
    expect(view.allowedActions).toEqual(["wait"]);
  });

  it("offers a refund only after expiry", () => {
    const past = new Date(NOW - 60_000).toISOString();
    const future = new Date(NOW + 60_000).toISOString();
    expect(deriveJobMirror({ mirrorStatus: "Funded", chainStatus: 1, expiredAt: past, now: NOW }).allowedActions).toContain("claim-refund");
    expect(deriveJobMirror({ mirrorStatus: "Funded", chainStatus: 1, expiredAt: future, now: NOW }).allowedActions).not.toContain("claim-refund");
  });

  it("offers a refund on an expired submission too", () => {
    const past = new Date(NOW - 60_000).toISOString();
    expect(deriveJobMirror({ mirrorStatus: "Submitted", chainStatus: 2, expiredAt: past, now: NOW }).allowedActions).toContain("claim-refund");
  });

  it("closes the actions on a terminal verdict", () => {
    const view = deriveJobMirror({ mirrorStatus: "Submitted", chainStatus: 3, now: NOW });
    expect(view.status).toBe("Completed");
    expect(view.allowedActions).toEqual(["wait"]);
  });

  it("names an unrecognised chain status instead of inventing one", () => {
    const view = deriveJobMirror({ mirrorStatus: "Funded", chainStatus: 9, now: NOW });
    expect(view.status).toBe("Funded");
    expect(view.chainStatus).toBeNull();
    expect(view.reason).toMatch(/does not recognise/);
  });

  it("ignores an unknown record status", () => {
    const view = deriveJobMirror({ mirrorStatus: "Canceled", chainStatus: 1, now: NOW });
    expect(view.status).toBe("Funded");
    expect(view.mirrorStatus).toBeNull();
    expect(view.divergence).toBe(true);
  });
});
