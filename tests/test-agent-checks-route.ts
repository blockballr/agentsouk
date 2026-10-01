// the check record a listing's strip is drawn from: recent checks per token, newest first,
// for the tokens asked for and nothing else. Runs without a database, where history is in memory
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
});
vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { GET } from "../src/app/api/agents/checks/route";
import { recordCheck, resetHistoryForTests } from "../src/lib/history-store";
import { resetRateLimitsForTests } from "../src/lib/rate-limit";

const get = async (query: string) => {
  const res = await GET(new NextRequest(`https://api.agentsouk.xyz/api/agents/checks${query}`));
  return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
};

beforeEach(() => {
  resetHistoryForTests();
  resetRateLimitsForTests();
});

describe("the check record", () => {
  it("may be held at the edge for a minute, and a refusal never is", async () => {
    expect((await get("?tokens=2504")).cache).toContain("s-maxage=60");
    expect((await get("?tokens=")).cache).toBe("no-store");
  });

  it("stops one caller after sixty requests in a minute", async () => {
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await get(`?tokens=${i + 1}`)).status;
    expect(last).toBe(429);
  });

  it("lists each token's checks newest first, and an empty record for one never checked", async () => {
    await recordCheck("2504", "delivered", 800);
    await recordCheck("2504", "dead", null);
    await recordCheck("2238", "gated", 300);
    const { status, body } = await get("?tokens=2504,9999");
    expect(status).toBe(200);
    expect(Object.keys(body.checks)).toEqual(["2504", "9999"]);
    expect(body.checks["2504"].map((c: { status: string }) => c.status)).toEqual(["dead", "delivered"]);
    expect(body.checks["9999"]).toEqual([]);
  });

  it("keeps to thirty checks a token", async () => {
    for (let i = 0; i < 35; i++) await recordCheck("2504", "delivered", i);
    const { body } = await get("?tokens=2504");
    expect(body.checks["2504"]).toHaveLength(30);
    expect(body.checks["2504"][0].responseMs).toBe(34);
  });

  it("asks for token ids, and takes nothing that is not a number", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?tokens=../97/2504,abc")).status).toBe(400);
    const { body } = await get("?tokens=2504,%20x,2504");
    expect(Object.keys(body.checks)).toEqual(["2504"]);
  });

  it("reads no more than forty tokens in one call", async () => {
    const many = Array.from({ length: 60 }, (_, i) => String(1000 + i)).join(",");
    const { body } = await get(`?tokens=${many}`);
    expect(Object.keys(body.checks)).toHaveLength(40);
  });
});
