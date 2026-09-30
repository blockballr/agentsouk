// a seller built on BNB Chain's agent SDK takes work only through an on-chain ERC-8183 job, so a
// direct paid hire would settle and deliver nothing; it is refused before anyone signs, and the
// seller reads as gated (alive) rather than dead, which would start the clock that delists it
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  delete process.env.RELAY_PRIVATE_KEY;
  process.env.TARGET_CHAIN = "97";
});

const detail = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/scanner", () => ({
  fetchAgentDetail: async () => detail.current,
}));

import { NextRequest } from "next/server";
import { JOB_SELLER_NOTE, isJobStepSkill, sellsByJob } from "@agora/core";
import { GATED_RE, jobSellerReply } from "../src/lib/delivery";
import { POST as requirementsRoute } from "../src/app/api/x402/requirements/route";
import { verifyCandidate } from "../src/lib/verify-candidate";
import { probeToVerification } from "../src/lib/scout-pipeline-core";

const STUDIO_SKILLS = [
  { name: "negotiate", description: "Returns a signed ERC-8183 price quote for a task" },
  { name: "notify_funded", description: "Notifies the agent that a job is funded on-chain" },
];

const CARD = "https://hevo-agents.fly.dev/rebalance/.well-known/agent-card.json";

// the live registry read carries no skills, as in production; the card holds them
function agent() {
  return {
    token_id: "1865",
    chain_id: 97,
    name: "Hevo Rebalance",
    owner_address: "0x06f757064043e57dbbccd6d95ee1113d9796c715",
    agent_wallet: "0x06f757064043e57dbbccd6d95ee1113d9796c715",
    a2a_endpoint: CARD,
  };
}

function serveCard(skills: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url) === CARD
        ? new Response(JSON.stringify({ name: "Hevo Rebalance", skills }), { status: 200 })
        : new Response("not found", { status: 404 }),
    ),
  );
}

async function requirements() {
  const res = await requirementsRoute(
    new NextRequest("http://localhost/api/x402/requirements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainId: 97, tokenId: "1865", client: "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862" }),
    }),
  );
  return { res, body: await res.json() };
}

describe("recognising a job seller from its card", () => {
  it("reads Agent Studio's two skills, and the SDK example's single skill", () => {
    expect(sellsByJob(STUDIO_SKILLS)).toBe(true);
    expect(sellsByJob([{ id: "negotiate-erc8183-job", description: "Negotiate an ERC-8183 job" }])).toBe(true);
  });

  // Keel sells both ways: its own health factor skills take a direct paid task, and it also quotes
  it("leaves an agent that also declares skills of its own to the direct hire", () => {
    expect(
      sellsByJob([
        { id: "health-factor-read", name: "Read a Venus health factor" },
        { id: "repay-to-target", name: "Exact repayment to restore a target health factor" },
        { id: "negotiate", name: "Negotiate an ERC-8183 job" },
        { id: "notify_funded", name: "Notify the seller a job is funded" },
      ]),
    ).toBe(false);
  });

  it("leaves every other agent alone", () => {
    expect(sellsByJob([{ name: "plan_grid", description: "Plans a grid ladder" }])).toBe(false);
    expect(sellsByJob([{ name: "negotiate", description: "Negotiates a salary" }])).toBe(false);
    expect(sellsByJob([])).toBe(false);
    expect(sellsByJob(undefined)).toBe(false);
    expect(sellsByJob(null)).toBe(false);
  });
});

describe("a job seller's answer to a direct task", () => {
  it("reads a flat quote, as Hevo sends it, as gated", () => {
    const reply = jobSellerReply({
      status: "quoted",
      price: "8000000000000000000",
      currency: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
      negotiation_hash: "0xf6",
      provider_sig: "0xba",
    });
    expect(GATED_RE.test(reply ?? "")).toBe(true);
    expect(reply).toMatch(/price quote/);
  });

  it("reads the SDK's signed negotiation result as gated", () => {
    const reply = jobSellerReply({
      request: { task_description: "rebalance" },
      request_hash: "0x01",
      response: { accepted: true, terms: { price: "1000", currency: "0xc70B" } },
      negotiation_hash: "0x02",
      provider_sig: "0x03",
    });
    expect(GATED_RE.test(reply ?? "")).toBe(true);
  });

  it("reads Agent Studio's list of the skills it accepts as gated", () => {
    const reply = jobSellerReply({
      kind: "message",
      role: "agent",
      parts: [{ kind: "data", data: { error: "unknown skill: undefined", skills: ["negotiate", "notify_funded"] } }],
    });
    expect(GATED_RE.test(reply ?? "")).toBe(true);
    expect(reply).toMatch(/negotiate and notify_funded/);
  });

  it("does not touch an ordinary answer", () => {
    expect(jobSellerReply({ kind: "task", status: { state: "completed" }, artifacts: [] })).toBeNull();
    expect(jobSellerReply({ kind: "message", parts: [{ kind: "text", text: "done" }] })).toBeNull();
    expect(jobSellerReply("quoted")).toBeNull();
  });
});

describe("the hire requirements", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuse a direct hire of a job seller before anyone signs", async () => {
    detail.current = agent();
    serveCard(STUDIO_SKILLS);
    const { res, body } = await requirements();
    expect(res.status).toBe(409);
    expect(body.sellsByJob).toBe(true);
    expect(body.error).toBe(`Hevo Rebalance: ${JOB_SELLER_NOTE}`);
  });

  it("still price an ordinary agent", async () => {
    detail.current = agent();
    serveCard([{ name: "plan_rebalance", description: "Plans a rebalance" }]);
    const { res, body } = await requirements();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe("the verifier", () => {
  beforeEach(() => {
    detail.current = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records a job seller as gated and pays nothing", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        const json = (status: number, body: unknown) =>
          new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
        if (String(url).includes("/api/agents/")) {
          return json(200, { success: true, data: { a2a_endpoint: "https://hevo-agents.fly.dev/rebalance/.well-known/agent-card.json" } });
        }
        return json(409, { success: false, sellsByJob: true, error: "sells by job" });
      }),
    );
    const verdict = await verifyCandidate({ chainId: 97, tokenId: "1865", name: "Hevo Rebalance", category: "rebalancing" });
    expect(verdict.status).toBe("gated");
    expect(GATED_RE.test(verdict.detail)).toBe(true);
    // the agent's details, then the requirements that refused; no settle, so nothing was paid
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/\/api\/x402\/requirements$/);
    expect(calls.some((c) => c.includes("/api/x402/settle"))).toBe(false);
  });
});

describe("the scout's liveness probe", () => {
  const candidate = { token_id: "1", name: "Studio Seller", category: "yield" };

  it("reads a card behind its own login as gated, not dead", () => {
    expect(probeToVerification(candidate, { tokenId: "1", ok: false, detail: "a2a 401", protocol: "a2a" }, 10).status).toBe("gated");
    expect(probeToVerification(candidate, { tokenId: "1", ok: false, detail: "mcp 403", protocol: "mcp" }, 10).status).toBe("gated");
  });

  it("keeps the other verdicts as they were", () => {
    expect(probeToVerification(candidate, { tokenId: "1", ok: true, detail: "a2a card ok", protocol: "a2a" }, 10).status).toBe("delivered");
    expect(probeToVerification(candidate, { tokenId: "1", ok: false, detail: "a2a 500", protocol: "a2a" }, 10).status).toBe("dead");
    expect(probeToVerification(candidate, { tokenId: "1", ok: false, detail: "no callable endpoint", protocol: null }, 10).status).toBe("unreachable");
  });
});

describe("job protocol steps", () => {
  it("counts negotiate as a job step only on a card that runs the job protocol", () => {
    const hybrid = [
      { id: "read-health", name: "Read a Venus health factor" },
      { id: "negotiate", description: "Negotiate an ERC-8183 job" },
      { id: "notify_funded", description: "Notifies the agent that a job is funded" },
    ];
    expect(hybrid.map((s) => isJobStepSkill(s, hybrid))).toEqual([false, true, true]);
    const haggler = [
      { id: "negotiate", description: "Haggles a freight price with the carrier" },
      { id: "quote", description: "Returns a freight quote" },
    ];
    expect(haggler.map((s) => isJobStepSkill(s, haggler))).toEqual([false, false]);
  });
});
