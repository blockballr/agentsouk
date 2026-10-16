// the job branch's pre-flight: one bounded fetch of the card, answered as itself. a card that
// declares the protocol verifies, a fetched card that does not refuses the branch, a timeout fails
// closed into unverified rather than hanging, and a private address is never fetched at all
import { afterEach, describe, expect, it, vi } from "vitest";

import { jobCardCheck } from "../src/lib/job-card-check";

const CARD = "https://seller.example/.well-known/agent-card.json";

function cardBody(skills: unknown): Response {
  return new Response(JSON.stringify({ skills }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("jobCardCheck", () => {
  it("verify a card that declares the job protocol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        cardBody([
          { name: "negotiate-erc8183-job", description: "negotiate an ERC-8183 job" },
          { name: "notify_funded", description: "report the job funded" },
          { name: "rebalance", description: "rebalance a portfolio" },
        ]),
      ),
    );
    const check = await jobCardCheck(CARD);
    expect(check.state).toBe("verified");
    expect(check.detail).toMatch(/one check at this moment/i);
  });

  it("refuse a fetched card that declares no job protocol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => cardBody([{ name: "rebalance", description: "rebalance a portfolio" }])),
    );
    const check = await jobCardCheck(CARD);
    expect(check.state).toBe("unverified");
    expect(check.detail).toMatch(/no ERC-8183 job protocol/i);
    expect(check.detail).toMatch(/nothing was sent/i);
  });

  it("treat a reply without skills to read as unverified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ name: "not a card" }), { status: 200 })),
    );
    const check = await jobCardCheck(CARD);
    expect(check.state).toBe("unverified");
    expect(check.detail).toMatch(/not an agent card/i);
  });

  it("report an http error as unverified, with the status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 503 })));
    const check = await jobCardCheck(CARD);
    expect(check.state).toBe("unverified");
    expect(check.detail).toContain("HTTP 503");
  });

  it("fail a timeout closed into unverified, inside the bound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: { signal?: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const started = Date.now();
    const check = await jobCardCheck(CARD, 40);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(check.state).toBe("unverified");
    expect(check.detail).toMatch(/no answer within/i);
  });

  it("report a network failure as unreachable, not as a pass", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const check = await jobCardCheck(CARD);
    expect(check.state).toBe("unreachable");
    expect(check.detail).toMatch(/could not reach/i);
  });

  it("never fetch a private address", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const check = await jobCardCheck("https://127.0.0.1/.well-known/agent-card.json");
    expect(check.state).toBe("unreachable");
    expect(check.detail).toMatch(/never fetched/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
