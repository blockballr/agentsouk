// The marketplace path sent a text part only; three chain-97 reference agents
// read a structured data part instead and reject JSON placed in text, so a hire
// could settle but never complete. These pin the A2A message construction and
// the plain-object guard. No network call is made here.
import { describe, expect, it, vi } from "vitest";

// delivery.ts is server-only; the marker package throws outside a server bundle
vi.mock("server-only", () => ({}));

import { buildA2aParts, normalizeDeliverInput } from "../src/lib/delivery";

describe("A2A message parts", () => {
  it("sends only the text part when no input is given", () => {
    const parts = buildA2aParts("scan yields");
    expect(parts).toEqual([{ kind: "text", text: "scan yields" }]);
  });

  it("adds a data part shaped { input } while keeping the text part", () => {
    const parts = buildA2aParts("scan yields", { walletAddress: "0xabc" });
    expect(parts).toEqual([
      { kind: "text", text: "scan yields" },
      { kind: "data", data: { input: { walletAddress: "0xabc" } } },
    ]);
  });

  it("carries a tokenId for the rebalancing agent", () => {
    const parts = buildA2aParts("analyze position", { tokenId: "1" });
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({ kind: "data", data: { input: { tokenId: "1" } } });
  });

  it("keeps the text part first so a text-only agent still works", () => {
    const parts = buildA2aParts("task", { walletAddress: "0xabc" });
    expect(parts[0].kind).toBe("text");
  });
});

describe("structured input validation", () => {
  it("treats an absent input as text only", () => {
    expect(normalizeDeliverInput(undefined)).toEqual({ ok: true });
  });

  it("accepts a plain object", () => {
    expect(normalizeDeliverInput({ walletAddress: "0xabc" })).toEqual({
      ok: true,
      input: { walletAddress: "0xabc" },
    });
  });

  it("refuses null, an array, string, number or boolean rather than sending it", () => {
    for (const bad of [null, [{ walletAddress: "0xabc" }], "0xabc", 42, true]) {
      const verdict = normalizeDeliverInput(bad);
      expect(verdict.ok, JSON.stringify(bad)).toBe(false);
      if (!verdict.ok) expect(verdict.error).toMatch(/JSON object/i);
    }
  });

  it("leaves the message text-only when an input was refused", () => {
    // the route refuses before construction, so a malformed input can never
    // become a data part; this is what would be sent without it
    expect(normalizeDeliverInput(["not", "an", "object"]).ok).toBe(false);
    expect(buildA2aParts("task")).toEqual([{ kind: "text", text: "task" }]);
  });
});
