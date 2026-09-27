// The team's read of the listing review queue. The point of the route is that the
// claim on the page, that a human reads every request, is something the team can
// actually act on. The gate is the index secret and it fails closed, which is the
// failure this codebase already had once and should not repeat.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No database, so the store stays on its in-memory list and the test does not
// need a driver.
const env = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  return { SECRET: "listing-read-secret" };
});

import { NextRequest } from "next/server";
import { recordListingRequest } from "../src/lib/listing-request-store";
import { GET } from "../src/app/api/listings/requests/route";

function call(headers: Record<string, string> = {}, query = "") {
  const req = new NextRequest(`http://localhost/api/listings/requests${query}`, {
    method: "GET",
    headers,
  });
  return GET(req);
}

beforeEach(() => {
  delete process.env.INDEX_SECRET;
});

afterEach(() => {
  delete process.env.INDEX_SECRET;
});

describe("reading the listing review queue", () => {
  it("refuses rather than opens when no secret is configured", async () => {
    const res = await call({ authorization: `Bearer ${env.SECRET}` });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/);
  });

  it("refuses a plausible header when the secret is unset, so it never fails open", async () => {
    // the exact regression this guards: an absent secret must not mean everyone
    process.env.INDEX_SECRET = "";
    const res = await call({ authorization: `Bearer ${env.SECRET}` });
    expect(res.status).toBe(503);
  });

  it("rejects a missing or wrong secret", async () => {
    process.env.INDEX_SECRET = env.SECRET;
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer nope" })).status).toBe(401);
    expect((await call({}, "?secret=nope")).status).toBe(401);
  });

  it("returns the queue newest first to a bearer or a query secret", async () => {
    process.env.INDEX_SECRET = env.SECRET;
    await recordListingRequest({
      tokenId: "45381",
      contact: "builder@example.com",
      note: "fixed the endpoint",
      createdAt: "2026-09-27T08:00:00.000Z",
    });
    await recordListingRequest({
      tokenId: "2044",
      contact: "@handler",
      note: "",
      createdAt: "2026-09-27T09:00:00.000Z",
    });

    const res = await call({ authorization: `Bearer ${env.SECRET}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(2);
    expect(body.requests[0].tokenId).toBe("2044");
    expect(body.requests[0].createdAt).toBe("2026-09-27T09:00:00.000Z");
    expect(body.requests[1].tokenId).toBe("45381");

    const viaQuery = await call({}, `?secret=${env.SECRET}&limit=1`);
    expect(viaQuery.status).toBe(200);
    expect((await viaQuery.json()).requests).toHaveLength(1);
  });
});
