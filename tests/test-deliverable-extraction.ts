// A completed hire once stored the raw A2A envelope, so the buyer saw a wall of
// JSON and the grader scored the wrapper. These pin the extraction to the real
// replies recorded in the two chain-97 evidence files: the agent's own message
// and the artifact payload, never the envelope.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// delivery.ts is server-only; the marker package throws outside a server bundle
vi.mock("server-only", () => ({}));

import { A2A_DELIVERABLE_MAX_CHARS, extractA2aDeliverable } from "../src/lib/delivery";
import { scoreDelivery } from "../src/lib/quality";

const categoryHires = JSON.parse(
  readFileSync(new URL("../scripts/chain97-category-hires.json", import.meta.url), "utf8"),
) as { categories: Record<string, { agent: string; delivery: { deliverable: string } }> };

const realHire = JSON.parse(
  readFileSync(new URL("../scripts/chain97-real-hire.json", import.meta.url), "utf8"),
) as { agent: string; deliverable: string };

// Markers that only ever appear in the envelope, never in the deliverable.
const ENVELOPE_MARKERS = ["TASK_STATE_COMPLETED", "ROLE_AGENT", "mediaType", '"artifactId"', '"ref-task'];

// The evidence files store the real deliverable as the artifact JSON then the
// agent's message. Rebuild the task envelope the agents actually returned.
function envelopeFor(deliverable: string) {
  const cut = deliverable.lastIndexOf("\n");
  const artifactJson = cut >= 0 ? deliverable.slice(0, cut) : deliverable;
  const message = cut >= 0 ? deliverable.slice(cut + 1) : "";
  let artifact: unknown = artifactJson;
  try {
    artifact = JSON.parse(artifactJson);
  } catch {
    // keep the raw text when an agent returned a non-JSON artifact
  }
  return {
    task: {
      id: "ref-task:test",
      status: {
        state: "TASK_STATE_COMPLETED",
        message: {
          role: "ROLE_AGENT",
          parts: message ? [{ kind: "text", text: message, mediaType: "text/plain" }] : [],
        },
      },
      artifacts: [{ artifactId: "artifact-1", name: "result", parts: [{ kind: "data", data: artifact }] }],
    },
  };
}

function expectNoEnvelope(text: string) {
  for (const marker of ENVELOPE_MARKERS) expect(text).not.toContain(marker);
}

describe("A2A deliverable extraction", () => {
  it("reads the YieldPilot message first and its Venus artifact after, never the envelope", () => {
    const out = extractA2aDeliverable(envelopeFor(realHire.deliverable));
    expect(out.found).toBe(true);
    expect(out.text).toContain("YieldPilot completed scan_opportunities");
    expect(out.text).toContain("23.44435");
    expect(out.text).toContain('"capability": "yield"');
    expect(out.text.indexOf("YieldPilot completed")).toBeLessThan(out.text.indexOf('"capability"'));
    expectNoEnvelope(out.text);
  });

  it("reads the other two chain-97 agents from the category sweep", () => {
    const health = extractA2aDeliverable(envelopeFor(categoryHires.categories["health-factor"].delivery.deliverable));
    expect(health.found).toBe(true);
    expect(health.text).toContain("VenusGuard completed inspect_health");
    expect(health.text).toContain("inspect_health");
    expectNoEnvelope(health.text);

    const rebalancing = extractA2aDeliverable(envelopeFor(categoryHires.categories["rebalancing"].delivery.deliverable));
    expect(rebalancing.found).toBe(true);
    expect(rebalancing.text).toContain("RangeKeeper completed analyze_position");
    expect(rebalancing.text).toContain("NEAR_LOWER");
    expectNoEnvelope(rebalancing.text);
  });

  it("reads a plain message reply from result.parts", () => {
    const out = extractA2aDeliverable({
      parts: [{ kind: "text", text: "Allocated 40% to Aave, 60% to Lista at 14% APY" }],
    });
    expect(out.found).toBe(true);
    expect(out.text).toBe("Allocated 40% to Aave, 60% to Lista at 14% APY");
  });

  it("keeps an artifact-only reply as pretty JSON and still grades it", () => {
    const out = extractA2aDeliverable({
      task: {
        status: { state: "TASK_STATE_COMPLETED" },
        artifacts: [
          {
            artifactId: "a1",
            parts: [{ kind: "data", data: { capability: "yield", currentSupplyApyPercent: "23.44435" } }],
          },
        ],
      },
    });
    expect(out.found).toBe(true);
    expect(out.text).toBe('{\n  "capability": "yield",\n  "currentSupplyApyPercent": "23.44435"\n}');
    expect(scoreDelivery(out.text).grade).toBe("good");
  });

  it("says plainly when nothing usable is found instead of stringifying the envelope", () => {
    // Hevo Grid's real reply is an ERC-8183 price quote, not a deliverable
    const quote = JSON.parse(categoryHires.categories["grid-trading"].delivery.deliverable) as Record<string, unknown>;
    const out = extractA2aDeliverable(quote);
    expect(out.found).toBe(false);
    expect(out.text).toMatch(/without a deliverable/i);
    expect(out.text).not.toContain("negotiation_hash");
    expect(out.text).not.toBe(JSON.stringify(quote));
  });

  it("bounds the total so a huge artifact cannot bloat the result", () => {
    const out = extractA2aDeliverable({
      status: { state: "TASK_STATE_COMPLETED", message: { parts: [{ kind: "text", text: "scan complete" }] } },
      artifacts: [
        { artifactId: "a1", parts: [{ kind: "data", data: { blob: "x".repeat(A2A_DELIVERABLE_MAX_CHARS * 2) } }] },
      ],
    });
    const marker = `\n[truncated: deliverable over ${A2A_DELIVERABLE_MAX_CHARS} characters]`;
    expect(out.found).toBe(true);
    expect(out.text.startsWith("scan complete")).toBe(true);
    expect(out.text).toContain(`[truncated: deliverable over ${A2A_DELIVERABLE_MAX_CHARS} characters]`);
    expect(out.text.length).toBeLessThanOrEqual(A2A_DELIVERABLE_MAX_CHARS + marker.length);
  });

  it("grades the extracted content well, not the envelope", () => {
    const out = extractA2aDeliverable(envelopeFor(realHire.deliverable));
    const quality = scoreDelivery(out.text);
    expect(quality.grade).toBe("good");
    expect(quality.reason).toMatch(/artifact part/);
  });
});
