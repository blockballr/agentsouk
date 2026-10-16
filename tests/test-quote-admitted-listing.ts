// The negotiate gate reads the listing the agent page reads: a registration the
// index has not caught up with still negotiates on its admitted endpoint, a card
// without the ERC-8183 protocol still refuses, and a missing agent still 404s.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  delete process.env.DATABASE_URL;
  delete process.env.RELAY_PRIVATE_KEY;
  process.env.TARGET_CHAIN = "97";
});

vi.mock("server-only", () => ({}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: () => {} };
});

vi.mock("../src/lib/scanner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/scanner")>();
  return { ...actual, getAgentByToken: vi.fn() };
});

vi.mock("../src/lib/delivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/delivery")>();
  return { ...actual, fetchAgentCardSkills: vi.fn() };
});

vi.mock("../src/lib/delist-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/delist-store")>();
  return { ...actual, loadDelisted: vi.fn(async () => new Set<string>()) };
});

vi.mock("../src/lib/jobs8183", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/jobs8183")>();
  return { ...actual, negotiateQuote: vi.fn() };
});

import { NextRequest } from "next/server";
import { POST as quoteRoute } from "../src/app/api/jobs8183/quote/route";
import { getAgentByToken, summaryFromRegistration } from "../src/lib/scanner";
import { fetchAgentCardSkills, type AgentCardSkill } from "../src/lib/delivery";
import { negotiateQuote } from "../src/lib/jobs8183";

const CARD = "https://api.agentsouk.xyz/api/house-agent/.well-known/agent-card.json";
const OWNER = "0x52DA44aB471455437fc17979c52E501f6b8d0EAF";

// the house card's shape where the gate looks: a negotiate step that names 8183
// and a notify_funded step after it
const DECLARED: AgentCardSkill[] = [
  { id: "negotiate", description: "ERC-8183 job selling: answers a negotiate step." },
  { id: "notify_funded", description: "ERC-8183 job selling: starts work once funded." },
];
const FLAT: AgentCardSkill[] = [
  { id: "compute-health-factor", description: "Computes the health factor of a position." },
];

function listing() {
  return summaryFromRegistration({
    chainId: 97,
    tokenId: "9901",
    owner: OWNER,
    registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    draft: {
      name: "Souk Health Guard",
      description: "Computes the health factor of a lending position from caller-supplied values.",
      category: "health-factor",
      endpoint: CARD,
      endpointKind: "A2A",
      x402Support: false,
    },
    createdAt: new Date().toISOString(),
  });
}

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/jobs8183/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(getAgentByToken).mockReset();
  vi.mocked(fetchAgentCardSkills).mockReset();
  vi.mocked(negotiateQuote).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the quote gate on a listing the index has not caught up with", () => {
  it("reads the card on the admitted endpoint and reaches negotiate", async () => {
    vi.mocked(getAgentByToken).mockResolvedValue(listing());
    vi.mocked(fetchAgentCardSkills).mockResolvedValue(DECLARED);
    vi.mocked(negotiateQuote).mockResolvedValue({
      ok: false,
      error: "the negotiate step was reached",
    });

    const res = await quoteRoute(
      request({ chainId: 97, tokenId: "9901", task: "rebalance the position" }),
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.notAJobSeller).toBeUndefined();
    expect(body.error).toBe("the negotiate step was reached");
    expect(fetchAgentCardSkills).toHaveBeenCalledWith(CARD, 4000);
    expect(negotiateQuote).toHaveBeenCalledWith(
      97,
      CARD,
      "rebalance the position",
      OWNER,
    );
  });

  it("still refuses a card without the protocol", async () => {
    vi.mocked(getAgentByToken).mockResolvedValue(listing());
    vi.mocked(fetchAgentCardSkills).mockResolvedValue(FLAT);

    const res = await quoteRoute(
      request({ chainId: 97, tokenId: "9901", task: "rebalance the position" }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.notAJobSeller).toBe(true);
    expect(negotiateQuote).not.toHaveBeenCalled();
  });

  it("still 404s when the agent does not exist", async () => {
    vi.mocked(getAgentByToken).mockResolvedValue(null);

    const res = await quoteRoute(
      request({ chainId: 97, tokenId: "9902", task: "rebalance the position" }),
    );

    expect(res.status).toBe(404);
  });
});
