// Confirmation runs on one instance and the wizard's probe can land on another
// that loaded its shelf before the admission. That instance has no cached entry,
// so it must ask the shared shelf before a not-found from the index evicts, and
// it must never delete the row the confirming instance just wrote.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const stored = vi.hoisted(() => ({ row: null as unknown, deletes: 0 }));

vi.mock("../src/lib/shelf-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/shelf-store")>();
  return {
    ...actual,
    readShelfAgent: async () => stored.row,
    deleteShelfAgent: async () => {
      stored.deletes += 1;
    },
  };
});

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: () => {} };
});

import { getAgentByToken, summaryFromRegistration } from "../src/lib/scanner";

function admitted(tokenId: string, admittedAt: string) {
  return {
    ...summaryFromRegistration({
      chainId: 97,
      tokenId,
      owner: "0x84fedaBd1b83443aD86796C15619494878B64180",
      registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      draft: {
        name: "Venus Fleet Sentinel",
        description: "Watches a wallet health factor and acts before liquidation on Venus.",
        category: "health-factor",
        endpoint: "https://sentinel.example/.well-known/agent-card.json",
        endpointKind: "A2A",
      },
      createdAt: admittedAt,
    }),
    admitted_at: admittedAt,
  };
}

beforeEach(() => {
  stored.deletes = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a fresh admission read from another instance", () => {
  it("serves the shared row and leaves it in place", async () => {
    stored.row = admitted("4260", new Date(Date.now() - 60_000).toISOString());
    const read = await getAgentByToken(97, "4260");
    expect(read?.token_id).toBe("4260");
    expect(stored.deletes).toBe(0);
  });

  it("still evicts an admission the index has had a day to see", async () => {
    stored.row = admitted("4261", new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
    expect(await getAgentByToken(97, "4261")).toBeNull();
    expect(stored.deletes).toBe(1);
  });
});
