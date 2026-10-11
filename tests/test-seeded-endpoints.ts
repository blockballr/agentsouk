// A rebuild regenerates the snapshot from a list payload that has no endpoint
// field, so the only copy of a seeded endpoint is the one a rebuild would discard.
// These pin the merge: a seed fills a gap, never overwrites a live registry answer,
// and never reaches across a chain.
import { describe, expect, it } from "vitest";
import {
  applySeededEndpoints,
  pickSeededEndpoints,
  seededKey,
  type SeededEndpointRow,
} from "../src/lib/seeded-endpoints";

const CARD = "https://agent.example.com/.well-known/agent-card.json";

function row(tokenId: string, chainId = 56, a2aEndpoint = CARD): SeededEndpointRow {
  return { chainId, tokenId, a2aEndpoint, source: "operator card" };
}

function agent(tokenId: string, a2aEndpoint: string | null = null) {
  return { token_id: tokenId, a2a_endpoint: a2aEndpoint };
}

describe("seeded endpoint lookup", () => {
  it("keys by chain and token, so two chains cannot claim each other's listing", () => {
    const map = pickSeededEndpoints([row("302257", 56), row("302257", 97, "https://t97.example/card")], new Map());
    expect(map.size).toBe(2);
    expect(map.get(seededKey(56, "302257"))?.a2aEndpoint).toBe(CARD);
    expect(map.get(seededKey(97, "302257"))?.a2aEndpoint).toBe("https://t97.example/card");
  });

  it("takes the database whenever it answers", () => {
    const memory = new Map([[seededKey(56, "1"), row("1", 56, "https://memory.example/card")]]);
    const map = pickSeededEndpoints([row("2", 56)], memory);
    expect([...map.keys()]).toEqual([seededKey(56, "2")]);
  });

  it("falls back to memory only when there is no database answer", () => {
    const memory = new Map([[seededKey(56, "1"), row("1")]]);
    expect(pickSeededEndpoints(null, memory).size).toBe(1);
  });
});

describe("reapplying seeds to a rebuilt shelf", () => {
  it("fills an endpoint the build did not find", () => {
    const seeded = new Map([[seededKey(56, "302257"), row("302257")]]);
    const shelf = [agent("302257")];
    expect(applySeededEndpoints(shelf, seeded, 56)).toBe(1);
    expect(shelf[0].a2a_endpoint).toBe(CARD);
  });

  it("never overwrites an endpoint the registry itself supplied", () => {
    const seeded = new Map([[seededKey(56, "1"), row("1")]]);
    const shelf = [agent("1", "https://live.example/card")];
    expect(applySeededEndpoints(shelf, seeded, 56)).toBe(0);
    expect(shelf[0].a2a_endpoint).toBe("https://live.example/card");
  });

  it("leaves a listing on another chain alone even when the token id matches", () => {
    const seeded = new Map([[seededKey(97, "1"), row("1", 97)]]);
    const shelf = [agent("1")];
    expect(applySeededEndpoints(shelf, seeded, 56)).toBe(0);
    expect(shelf[0].a2a_endpoint).toBeNull();
  });

  it("touches nothing when the store is empty, which is the no-database case", () => {
    const shelf = [agent("1"), agent("2")];
    expect(applySeededEndpoints(shelf, new Map(), 56)).toBe(0);
    expect(shelf.map((a) => a.a2a_endpoint)).toEqual([null, null]);
  });

  it("skips a stored row with no endpoint rather than blanking the field", () => {
    const seeded = new Map([[seededKey(56, "1"), row("1", 56, "")]]);
    const shelf = [agent("1")];
    expect(applySeededEndpoints(shelf, seeded, 56)).toBe(0);
    expect(shelf[0].a2a_endpoint).toBeNull();
  });
});
