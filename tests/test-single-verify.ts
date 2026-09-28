// A single listing earns its first probe from the wizard, but the route must
// never spend a hire it was not asked for: unadmitted tokens, unknown tokens
// and freshly probed ones all stop before any money moves.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  verifyAndRecord: vi.fn(),
  verifications: new Map<string, unknown>(),
}));

vi.mock("../src/lib/verify-candidate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/verify-candidate")>();
  return {
    ...actual,
    fetchJson: store.fetchJson,
    verifyAndRecord: store.verifyAndRecord,
  };
});

vi.mock("../src/lib/verifications", () => ({
  loadVerifications: vi.fn(async () => store.verifications),
}));

process.env.TARGET_CHAIN = "97";

import { NextRequest } from "next/server";
import { POST } from "../src/app/api/agents/[chainId]/[tokenId]/verify/route";

function post(chainId: string, tokenId: string) {
  return new NextRequest(`http://localhost/api/agents/${chainId}/${tokenId}/verify`, {
    method: "POST",
  });
}

function params(chainId: string, tokenId: string) {
  return { params: Promise.resolve({ chainId, tokenId }) } as never;
}

const admitted = {
  data: { name: "T", category: "yield", a2a_endpoint: "https://a.example/card" },
};

beforeEach(() => {
  store.fetchJson.mockReset();
  store.verifyAndRecord.mockReset();
  store.verifications.clear();
});

describe("single listing probe", () => {
  it("refuses another chain without spending", async () => {
    const res = await POST(post("56", "1"), params("56", "1"));
    expect(res.status).toBe(400);
    expect(store.verifyAndRecord).not.toHaveBeenCalled();
  });

  it("refuses a malformed token without spending", async () => {
    const res = await POST(post("97", "abc"), params("97", "abc"));
    expect(res.status).toBe(400);
    expect(store.verifyAndRecord).not.toHaveBeenCalled();
  });

  it("returns 404 when the agent is unknown", async () => {
    store.fetchJson.mockResolvedValueOnce({ status: 404, body: {} });
    const res = await POST(post("97", "999"), params("97", "999"));
    expect(res.status).toBe(404);
    expect(store.verifyAndRecord).not.toHaveBeenCalled();
  });

  it("refuses an unadmitted token without spending", async () => {
    store.fetchJson.mockResolvedValueOnce({
      status: 200,
      body: { data: { name: "G", category: "general", a2a_endpoint: null, mcp_server: null } },
    });
    const res = await POST(post("97", "7"), params("97", "7"));
    expect(res.status).toBe(409);
    expect(store.verifyAndRecord).not.toHaveBeenCalled();
  });

  it("skips a recently probed token without spending again", async () => {
    store.fetchJson.mockResolvedValueOnce({ status: 200, body: admitted });
    store.verifications.set("8", {
      status: "delivered",
      checkedAt: new Date().toISOString(),
    });
    const res = await POST(post("97", "8"), params("97", "8"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { skipped?: boolean }).skipped).toBe(true);
    expect(store.verifyAndRecord).not.toHaveBeenCalled();
  });

  it("probes an admitted token with no record exactly once", async () => {
    store.fetchJson.mockResolvedValueOnce({ status: 200, body: admitted });
    store.verifyAndRecord.mockResolvedValueOnce({
      status: "delivered",
      detail: "ok",
      persisted: true,
    });
    const res = await POST(post("97", "9"), params("97", "9"));
    expect(res.status).toBe(200);
    expect(store.verifyAndRecord).toHaveBeenCalledTimes(1);
    expect(store.verifyAndRecord).toHaveBeenCalledWith({
      chainId: 97,
      tokenId: "9",
      name: "T",
      category: "yield",
    });
  });
});
