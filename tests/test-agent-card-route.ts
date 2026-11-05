// the card read behind the listing wizard: a pasted link is tried as given, an
// /a2a messaging link also as its origin's well-known card, a private or plain
// http address is refused before the server dials, and an unread link stays
// unread with a 404 shape the web app reads as keep the form as it was
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextRequest } from "next/server";
import { GET, cardUrlCandidates } from "../src/app/api/agent-card/route";

const get = async (url: string) => {
  const res = await GET(
    new NextRequest(`https://api.agentsouk.xyz/api/agent-card?url=${encodeURIComponent(url)}`),
  );
  return { status: res.status, body: await res.json() };
};

const card = {
  name: "Flux LP Bot",
  description: "Rebalances liquidity positions",
  image: "https://fluxlp.agentsouk.xyz/favicon.png",
};

afterEach(() => vi.unstubAllGlobals());

describe("cardUrlCandidates", () => {
  it("asks an /a2a link at the well-known card path of its origin", () => {
    expect(cardUrlCandidates("https://fluxlp.agentsouk.xyz/a2a")).toEqual([
      "https://fluxlp.agentsouk.xyz/a2a",
      "https://fluxlp.agentsouk.xyz/.well-known/agent-card.json",
    ]);
  });

  it("tries a pasted card path only once, and puts a card beside a deeper path", () => {
    expect(cardUrlCandidates("https://agent.example/.well-known/agent-card.json")).toEqual([
      "https://agent.example/.well-known/agent-card.json",
    ]);
    expect(cardUrlCandidates("https://agent.example/rebalance/a2a/")).toEqual([
      "https://agent.example/rebalance/a2a",
      "https://agent.example/rebalance/.well-known/agent-card.json",
      "https://agent.example/.well-known/agent-card.json",
    ]);
  });

  it("sees a bare origin as the root and no url at all as nothing", () => {
    expect(cardUrlCandidates("https://agent.example")).toEqual([
      "https://agent.example/",
      "https://agent.example/.well-known/agent-card.json",
    ]);
    expect(cardUrlCandidates("not a url")).toBeNull();
  });
});

describe("the agent card route", () => {
  it("refuses a loopback, a private range and plain http before any dial", async () => {
    const fetchUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        fetchUrls.push(String(input));
        return new Response("{}", { status: 200 });
      }),
    );
    for (const url of [
      "https://localhost/.well-known/agent-card.json",
      "https://127.0.0.1/a2a",
      "https://192.168.1.10/agent-card.json",
      "http://agent.example/.well-known/agent-card.json",
    ]) {
      const { status, body } = await get(url);
      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(typeof body.error).toBe("string");
    }
    expect(fetchUrls).toEqual([]);
  });

  it("fills name, description and image from the well-known card an /a2a paste is standing in for", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        new URL(input).pathname === "/.well-known/agent-card.json"
          ? new Response(JSON.stringify({ ...card }), { status: 200 })
          : new Response(null, { status: 404 }),
      ),
    );
    const { status, body } = await get("https://fluxlp.agentsouk.xyz/a2a");
    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      url: "https://fluxlp.agentsouk.xyz/.well-known/agent-card.json",
      name: card.name,
      description: card.description,
      image: card.image,
    });
  });

  it("answers a 404 shape when no candidate carries a card", async () => {
    const fetchUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        fetchUrls.push(String(input));
        return new Response("not json", { status: 404 });
      }),
    );
    const { status, body } = await get("https://fluxlp.agentsouk.xyz/a2a");
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: "no agent card at that link" });
    expect(fetchUrls).toHaveLength(2);
  });

  it("will not read a card a redirect carried onto a loopback", async () => {
    // a stubbed response object, since Response init cannot name the redirect it followed
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, url: "https://127.0.0.1/card.json", json: async () => card })),
    );
    const { status, body } = await get("https://fluxlp.agentsouk.xyz/a2a");
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });
});
