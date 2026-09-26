// The grader once scored delivery text by length, which graded a long HTML error page as a
// substantive deliverable. These pin the structural behaviour so it cannot regress to a length heuristic.
import { describe, expect, it } from "vitest";
import { parseA2A, scoreDelivery } from "../src/lib/quality";

describe("A2A reply parsing", () => {
  it("reads state and text out of a completed task with artifacts", () => {
    const reply = parseA2A({
      id: "t1",
      status: { state: "completed" },
      result: {
        artifacts: [
          { artifactId: "a1", parts: [{ kind: "text", text: "Rebalanced to 0.3/0.7" }] },
        ],
      },
    });
    expect(reply.state).toBe("completed");
    expect(reply.text).toBe("Rebalanced to 0.3/0.7");
    expect(reply.parts).toBe(1);
  });

  it("reads a bare message with parts", () => {
    const reply = parseA2A({
      message: { role: "agent", parts: [{ kind: "text", text: "Status: healthy" }] },
    });
    expect(reply.text).toBe("Status: healthy");
  });

  it("unwraps a JSON string body as well as an object", () => {
    const reply = parseA2A(
      JSON.stringify({ status: { state: "completed" }, result: { artifacts: [] }, text: "ok" }),
    );
    expect(reply.state).toBe("completed");
    expect(reply.text).toBe("ok");
  });

  it("reports nothing for an empty or unusable reply", () => {
    expect(parseA2A("").text).toBe("");
    expect(parseA2A("   ").text).toBe("");
    expect(parseA2A(null).text).toBe("");
    expect(parseA2A({}).parts).toBe(0);
  });
});

describe("delivery scoring is structural, not length based", () => {
  it("fails a long HTML error page that the old grader called good", () => {
    const html = "<!DOCTYPE html><html><body>" + "error ".repeat(40) + "</body></html>";
    // the old heuristic: >=160 chars, contains a digit-free but long body, and
    // no "error" penalty because "error" appears in an HTML tag context
    const result = scoreDelivery(html);
    expect(result.grade).toBe("poor");
    expect(result.score).toBeLessThan(0.35);
  });

  it("fails a task the agent reported as failed, however long the text", () => {
    const result = scoreDelivery({
      status: { state: "failed" },
      result: { artifacts: [{ parts: [{ kind: "text", text: "x".repeat(400) }] }] },
    });
    expect(result.grade).toBe("poor");
    expect(result.reason).toMatch(/failed/i);
  });

  it("does not count an input-required or working task as a delivery", () => {
    for (const state of ["input-required", "working", "submitted"]) {
      const result = scoreDelivery({ status: { state }, result: { artifacts: [] } });
      expect(result.grade).toBe("poor");
    }
  });

  it("scores a completed task with artifacts as good", () => {
    const result = scoreDelivery({
      status: { state: "completed" },
      result: {
        artifacts: [
          { parts: [{ kind: "text", text: "Allocated 40% to Aave, 60% to Lista" }] },
          { parts: [{ kind: "data", data: {apy: 0.14} }] },
        ],
      },
    });
    expect(result.grade).toBe("good");
    expect(result.reason).toMatch(/artifact part/);
  });

  it("penalises error-shaped prose", () => {
    const bad = scoreDelivery({ status: { state: "completed" }, text: "failed to reach the pool" });
    expect(bad.score).toBeLessThanOrEqual(0.5);
    expect(bad.grade).not.toBe("good");
  });

  it("gives an empty reply a zero with a stated reason", () => {
    const result = scoreDelivery({ status: { state: "completed" } });
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/no artifact or text/i);
  });

  it("keeps every score inside the unit interval", () => {
    const inputs = [
      "",
      "x",
      "a".repeat(500),
      { status: { state: "completed" }, text: "1".repeat(300) },
      { status: { state: "failed" }, text: "y".repeat(500) },
      "<html></html>",
      null,
    ];
    for (const input of inputs) {
      const { score } = scoreDelivery(input);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
