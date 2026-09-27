// A route that threw answered with a zero-length 500 body, and res.json() reported
// "Unexpected end of JSON input" to the user. readJsonBody reads the body as text
// first, so these pin the status-naming message and keep the parse error from returning.
import { describe, expect, it } from "vitest";
import { readJsonBody } from "../apps/web/src/lib/api";

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected readJsonBody to reject");
}

describe("readJsonBody", () => {
  it("parses a normal JSON body", async () => {
    const res = new Response(JSON.stringify({ ok: true, data: { id: "a1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await expect(readJsonBody(res, "hire")).resolves.toEqual({ ok: true, data: { id: "a1" } });
  });

  it("names 500 when the body is empty", async () => {
    const err = await failure(readJsonBody(new Response("", { status: 500 }), "settle"));
    expect(err.message).toContain("500");
    expect(err.message).not.toMatch(/JSON/i);
    expect(err.message).not.toMatch(/unexpected end/i);
  });

  it("names the status when the body is not JSON", async () => {
    const res = new Response("<html>internal error</html>", {
      status: 500,
      headers: { "content-type": "text/html" },
    });
    const err = await failure(readJsonBody(res, "deliver"));
    expect(err.message).toContain("500");
    expect(err.message).not.toMatch(/JSON/i);
    expect(err.message).not.toMatch(/unexpected end/i);
  });

  it("explains a 502 as a timeout, naming the status", async () => {
    const err = await failure(readJsonBody(new Response("", { status: 502 }), "settle"));
    expect(err.message).toContain("502");
    expect(err.message).toMatch(/timed out/i);
    expect(err.message).not.toMatch(/unexpected end/i);
  });

  it("explains a 504 as a timeout, naming the status", async () => {
    const err = await failure(readJsonBody(new Response("", { status: 504 }), "deliver"));
    expect(err.message).toContain("504");
    expect(err.message).toMatch(/timed out/i);
    expect(err.message).not.toMatch(/unexpected end/i);
  });
});
