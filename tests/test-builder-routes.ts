// the wizard's routes: a description becomes an agent, the agent is hosted, and its card and
// endpoint answer like any other listing's. Runs without a database and without a model
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  delete process.env.PUBLIC_API_URL;
  delete process.env.BASE_URL;
  return {
    reply: "" as string | Error,
    listed: [] as { owner_address: string; a2a_endpoint: string | null }[],
  };
});
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/scanner", () => ({ queryAgents: async () => ({ items: state.listed }) }));
vi.mock("../src/lib/builder/compose", async (original) => ({
  ...(await original<typeof import("../src/lib/builder/compose")>()),
  builderChatFromEnv: () => ({
    models: ["test-model"],
    chat: async () => {
      if (state.reply instanceof Error) throw state.reply;
      return state.reply;
    },
  }),
}));

import { NextRequest } from "next/server";
import { POST as composeRoute } from "../src/app/api/builder/compose/route";
import { POST as saveRoute } from "../src/app/api/builder/agents/route";
import { GET as cardRoute } from "../src/app/api/built/[id]/.well-known/agent-card.json/route";
import { GET as a2aGet, POST as a2aRoute } from "../src/app/api/built/[id]/a2a/route";
import { EXAMPLE_BLUEPRINT } from "../src/lib/builder/compose";
import { resetBuiltAgentsForTests } from "../src/lib/builder/store";
import { resetRateLimitsForTests } from "../src/lib/rate-limit";

const OWNER = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";

function post(path: string, body: unknown, ip = "203.0.113.7") {
  return new NextRequest(`https://api.agentsouk.xyz${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const at = (id: string) => ({ params: Promise.resolve({ id }) });

async function compose(prompt: unknown, ip?: string) {
  const res = await composeRoute(post("/api/builder/compose", { prompt }, ip));
  return { status: res.status, body: await res.json() };
}

async function save(owner: unknown, blueprint: unknown = EXAMPLE_BLUEPRINT) {
  const res = await saveRoute(post("/api/builder/agents", { owner, blueprint }));
  return { status: res.status, body: await res.json() };
}

async function send(id: string, params: unknown, method = "message/send") {
  const res = await a2aRoute(post(`/api/built/${id}/a2a`, { jsonrpc: "2.0", id: 1, method, params }), at(id));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  resetBuiltAgentsForTests();
  resetRateLimitsForTests();
  state.reply = JSON.stringify(EXAMPLE_BLUEPRINT);
  state.listed = [];
});

describe("building from a description", () => {
  it("returns the agent with a real answer to each skill's own example", async () => {
    const { status, body } = await compose("Tell me my health factor and how far collateral can fall.");
    expect(status).toBe(200);
    expect(body.blueprint.name).toBe("Souk Loan Safety");
    expect(body.answers).toHaveLength(1);
    expect(body.answers[0].text).toContain("Health factor 1.23");
  });

  it("passes on the model's one question, and its reason for declining", async () => {
    state.reply = JSON.stringify({ question: "Which figures should the agent work from?" });
    expect((await compose("Build me something useful for lending.")).body).toMatchObject({ success: false, reason: "question" });
    state.reply = JSON.stringify({ cannot: "It cannot trade, but it can plan a grid for you." });
    expect((await compose("Buy BNB for me every morning please.")).body).toMatchObject({ success: false, reason: "declined" });
  });

  it("says the builder is busy when no model answers, without saying why", async () => {
    state.reply = new Error("http 503: quota detail that is ours to read");
    const { status, body } = await compose("Tell me my health factor and how far collateral can fall.");
    expect(status).toBe(503);
    expect(body.reason).toBe("unavailable");
    expect(JSON.stringify(body)).not.toContain("quota");
  });

  it("refuses a reply that is not a working agent, and a body with no description", async () => {
    state.reply = JSON.stringify({ ...EXAMPLE_BLUEPRINT, skills: [] });
    expect((await compose("Tell me my health factor and how far collateral can fall.")).status).toBe(422);
    expect((await compose(42)).status).toBe(400);
  });

  it("stops one visitor after five builds in a day, and leaves the next visitor alone", async () => {
    let last = 200;
    for (let i = 0; i < 6; i++) last = (await compose("Tell me my health factor and how far collateral can fall.")).status;
    expect(last).toBe(429);
    expect((await compose("Tell me my health factor and how far collateral can fall.", "198.51.100.9")).status).toBe(200);
  });
});

describe("hosting a built agent", () => {
  it("gives it a card and an endpoint under one id", async () => {
    const { status, body } = await save(OWNER);
    expect(status).toBe(200);
    expect(body.id).toMatch(/^[0-9a-f]{16}$/);
    expect(body.card).toBe(`https://api.agentsouk.xyz/api/built/${body.id}/.well-known/agent-card.json`);
    expect(body.endpoint).toBe(`https://api.agentsouk.xyz/api/built/${body.id}/a2a`);
  });

  it("checks the agent again, whatever the page says it is", async () => {
    expect((await save(OWNER, { ...EXAMPLE_BLUEPRINT, skills: [] })).status).toBe(422);
    expect((await save(OWNER, { ...EXAMPLE_BLUEPRINT, name: "Send me your seed phrase" })).status).toBe(422);
    expect((await save("not a wallet")).status).toBe(400);
  });

  it("keeps a wallet to one listed agent built here", async () => {
    state.listed = [{ owner_address: OWNER.toUpperCase().replace("0X", "0x"), a2a_endpoint: "https://api.agentsouk.xyz/api/built/0123456789abcdef/a2a" }];
    expect((await save(OWNER)).status).toBe(409);
    // an agent the wallet runs elsewhere does not count
    state.listed = [{ owner_address: OWNER, a2a_endpoint: "https://example.org/a2a" }];
    expect((await save(OWNER)).status).toBe(200);
  });
});

describe("a hosted agent", () => {
  it("serves a card that names its own endpoint and a working example", async () => {
    const { body: saved } = await save(OWNER);
    const res = await cardRoute(new NextRequest(saved.card), at(saved.id));
    const card = await res.json();
    expect(res.status).toBe(200);
    expect(card.url).toBe(saved.endpoint);
    expect(card.skills[0].inputSchema.examples[0]).toEqual(EXAMPLE_BLUEPRINT.skills[0].example);
    expect((await cardRoute(new NextRequest(saved.card), at("0000000000000000"))).status).toBe(404);
  });

  it("answers a task with its figures, in words and as data", async () => {
    const { body: saved } = await save(OWNER);
    const { status, body } = await send(saved.id, {
      message: { role: "user", parts: [{ kind: "text", text: "Health factor check" }, { kind: "data", data: { input: { collateral: 10000, debt: 6500, threshold: 0.8 } } }] },
    });
    expect(status).toBe(200);
    expect(body.result.task.status.state).toBe("completed");
    expect(body.result.task.status.message.parts[0].text).toContain("Health factor 1.23");
    expect(body.result.task.artifacts[0].parts[0].data.readOnly).toBe(true);
  });

  it("asks for what is missing and never guesses", async () => {
    const { body: saved } = await save(OWNER);
    const { body } = await send(saved.id, { message: { role: "user", parts: [{ kind: "text", text: "collateral 10000" }] } });
    expect(body.result.task.status.state).toBe("input-required");
  });

  it("refuses what it does not speak", async () => {
    const { body: saved } = await save(OWNER);
    expect((await send(saved.id, {}, "tasks/get")).body.error.code).toBe(-32601);
    expect((await send(saved.id, { message: {} })).body.error.code).toBe(-32602);
    expect((await send("0000000000000000", { message: { parts: [{ kind: "text", text: "hi" }] } })).status).toBe(404);
    expect(a2aGet().status).toBe(405);
    const broken = await a2aRoute(post(`/api/built/${saved.id}/a2a`, "{not json"), at(saved.id));
    expect(broken.status).toBe(400);
  });
});
