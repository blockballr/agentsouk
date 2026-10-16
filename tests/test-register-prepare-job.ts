// the job branch is decided server-side at prepare: the card is fetched once, bounded, and only a
// card that declares the ERC-8183 protocol gets a claim; the claim's published document carries no
// x402 support, because a job seller refuses a direct paid task by construction
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  delete process.env.RELAY_PRIVATE_KEY;
  process.env.TARGET_CHAIN = "97";
});

vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { POST as prepareRoute } from "../src/app/api/agents/register/prepare/route";
import { GET as claimRoute } from "../src/app/api/agents/register/[claimId]/route";

const CARD = "https://seller.example/.well-known/agent-card.json";

const DECLARED = [
  { name: "negotiate-erc8183-job", description: "negotiate an ERC-8183 job" },
  { name: "notify_funded", description: "report the job funded" },
  { name: "rebalance", description: "rebalance a portfolio" },
];
const FLAT = [{ name: "rebalance", description: "rebalance a portfolio" }];

// each test gets its own owner and ip so the prepare rate limit, which counts both, never lets a
// refusal here look like a pass there
let seq = 0;
function freshKeys(): { owner: string; ip: string } {
  seq += 1;
  return {
    owner: `0x${seq.toString(16).padStart(40, "0")}`,
    ip: `203.0.113.${seq}`,
  };
}

function draft(): Record<string, unknown> {
  return {
    name: "Centreline Grid",
    description:
      "Computes the grid spacing for a position from the range the caller supplies and returns the price levels to place.",
    category: "grid-trading",
    endpoint: CARD,
    endpointKind: "A2A",
    x402Support: true,
    agentWallet: `0x${(seq + 100).toString(16).padStart(40, "0")}`,
  };
}

function request(body: Record<string, unknown>): NextRequest {
  const { ip } = freshKeys();
  return new NextRequest("http://localhost:3000/api/agents/register/prepare", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function stubCard(skills: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const payload = skills === null ? { name: "not a card" } : { skills };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prepare on the job branch", () => {
  it("prepare a job listing when the card declares the protocol", async () => {
    stubCard(DECLARED);
    const { owner } = freshKeys();
    const res = await prepareRoute(request({ draft: draft(), owner, mode: "job" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.cardCheck.state).toBe("verified");
    expect(body.registerCalldata).toMatch(/^0x/);
  });

  it("mint the claim without x402 support, which is what a buyer reads", async () => {
    stubCard(DECLARED);
    const { owner } = freshKeys();
    const res = await prepareRoute(request({ draft: draft(), owner, mode: "job" }));
    const body = await res.json();
    expect(body.success).toBe(true);
    // the claim document handler reads only the claim id, so the request url is a stand-in
    const doc = await claimRoute(new NextRequest("http://localhost:3000/api/agents/register/x"), {
      params: Promise.resolve({ claimId: body.claimId }),
    });
    expect(doc.status).toBe(200);
    const file = await doc.json();
    expect(file.x402Support).toBe(false);
  });

  it("refuse the job branch when the card declares no protocol, minting nothing", async () => {
    stubCard(FLAT);
    const { owner } = freshKeys();
    const res = await prepareRoute(request({ draft: draft(), owner, mode: "job" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.cardCheck.state).toBe("unverified");
    expect(body.error).toMatch(/no ERC-8183 job protocol/i);
    expect(body.claimId).toBeUndefined();
  });

  it("require an agent wallet for the job branch before any fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { owner } = freshKeys();
    const noWallet = draft();
    delete noWallet.agentWallet;
    const res = await prepareRoute(request({ draft: noWallet, owner, mode: "job" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/agent wallet/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("report an unreachable endpoint as itself, not as a pass", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const { owner } = freshKeys();
    const res = await prepareRoute(request({ draft: draft(), owner, mode: "job" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.cardCheck.state).toBe("unreachable");
    expect(body.claimId).toBeUndefined();
  });

  it("leave the call path untouched when no mode is sent", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { owner } = freshKeys();
    const res = await prepareRoute(request({ draft: draft(), owner }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(body.cardCheck).toBeUndefined();
  });
});
