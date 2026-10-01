// history is what lets a page show a record over time: every check and every run of a
// scheduled job leaves one line. These run without a database, where the lines live in memory
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
});

vi.mock("server-only", () => ({}));

import { NextResponse } from "next/server";
import {
  checksSince,
  latestCronRuns,
  loggedCronRun,
  recentChecks,
  recordCheck,
  recordCronRun,
  resetHistoryForTests,
} from "../src/lib/history-store";
import { upsertVerification } from "../src/lib/verifications-store";

beforeEach(() => {
  resetHistoryForTests();
});

describe("the history of checks", () => {
  it("keeps every check of a token, newest first, and only the tokens asked for", async () => {
    await recordCheck("2504", "delivered", 800);
    await recordCheck("2238", "dead", null);
    await recordCheck("2504", "dead", 20000);
    const recent = await recentChecks(["2504"]);
    expect([...recent.keys()]).toEqual(["2504"]);
    expect(recent.get("2504")?.map((c) => c.status)).toEqual(["dead", "delivered"]);
    expect(recent.get("2504")?.[1].responseMs).toBe(800);
  });

  it("returns no more than the number asked for per token", async () => {
    for (let i = 0; i < 12; i++) await recordCheck("2504", "delivered", i);
    const recent = await recentChecks(["2504"], 5);
    expect(recent.get("2504")?.map((c) => c.responseMs)).toEqual([11, 10, 9, 8, 7]);
  });

  it("answers with nothing for no tokens, and lists everything since a moment", async () => {
    expect((await recentChecks([])).size).toBe(0);
    const before = new Date(Date.now() - 1000);
    await recordCheck("2504", "delivered", 1);
    expect((await checksSince(before)).map((c) => c.tokenId)).toEqual(["2504"]);
    expect(await checksSince(new Date(Date.now() + 60_000))).toEqual([]);
  });

  it("gets a line from every recorded check, even when the latest-result row cannot be written", async () => {
    // with no database the latest-result write reports false, but the check still happened
    expect(await upsertVerification("3001", "My Agent", "yield", "gated", 432.6)).toBe(false);
    const recent = await recentChecks(["3001"]);
    expect(recent.get("3001")).toMatchObject([{ status: "gated", responseMs: 433 }]);
  });
});

describe("the log of scheduled jobs", () => {
  it("answers with the latest run of each job", async () => {
    await recordCronRun({ name: "verify", startedAt: "2026-10-01T01:00:00.000Z", finishedAt: "2026-10-01T01:03:00.000Z", ok: true, note: null });
    await recordCronRun({ name: "verify", startedAt: "2026-10-01T06:00:00.000Z", finishedAt: "2026-10-01T06:02:00.000Z", ok: false, note: "answered 500" });
    await recordCronRun({ name: "maintenance", startedAt: "2026-10-01T07:00:00.000Z", finishedAt: "2026-10-01T07:00:05.000Z", ok: true, note: null });
    const latest = await latestCronRuns();
    expect(latest.map((r) => [r.name, r.ok, r.note])).toEqual([
      ["maintenance", true, null],
      ["verify", false, "answered 500"],
    ]);
  });

  it("logs a run that happened, with whether it worked", async () => {
    const ok = await loggedCronRun("refresh", async () => NextResponse.json({ success: true }));
    expect(ok.status).toBe(200);
    const failed = await loggedCronRun("pancake", async () => NextResponse.json({ success: false }, { status: 502 }));
    expect(failed.status).toBe(502);
    const latest = await latestCronRuns();
    expect(latest.map((r) => [r.name, r.ok, r.note])).toEqual([
      ["pancake", false, "answered 502"],
      ["refresh", true, null],
    ]);
  });

  it("leaves no line for a caller without the secret or a job that is not configured", async () => {
    await loggedCronRun("verify", async () => NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    await loggedCronRun("verify", async () => NextResponse.json({ error: "not configured" }, { status: 503 }));
    expect(await latestCronRuns()).toEqual([]);
  });

  it("logs a run that threw, and lets the error through", async () => {
    await expect(
      loggedCronRun("maintenance", async () => {
        throw new Error("store unreachable");
      }),
    ).rejects.toThrow("store unreachable");
    expect(await latestCronRuns()).toMatchObject([{ name: "maintenance", ok: false, note: "store unreachable" }]);
  });
});
