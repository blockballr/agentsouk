// The first party escrow keeper: the card must advertise a public messaging
// url, the endpoint must answer from the one deterministic decision function,
// and a missing value must be asked for rather than guessed. The reply is also
// run through the marketplace's own extraction code, so it is readable by the
// market and not only by this endpoint.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ESCROW_DEFAULT_DISPUTE_WINDOW_HOURS,
  ESCROW_DEFAULT_FEE_BPS,
  ESCROW_KEEPER_AGENT_CATEGORY,
  ESCROW_KEEPER_AGENT_DESCRIPTION,
  ESCROW_KEEPER_CARD_PATH,
  ESCROW_KEEPER_AGENT_NAME,
  ESCROW_KEEPER_AGENT_PUBLIC_ORIGIN,
  ESCROW_KEEPER_AGENT_VERSION,
  ESCROW_KEEPER_MESSAGING_PATH,
  decideEscrowKeeperTask,
  extractEscrowInput,
  escrowKeeperAgentCard,
  escrowKeeperMessagingUrl,
  escrowKeeperPickPublicOrigin,
  mergeEscrowInput,
  planEscrow,
} from "../src/lib/reference-escrow";
import { privateEndpointReason } from "../src/lib/endpoint";
import { scoreDelivery } from "../src/lib/quality";

// delivery.ts carries the server-only marker, which throws outside a server bundle
vi.mock("server-only", () => ({}));

import { extractA2aDeliverable } from "../src/lib/delivery";
import { POST as a2aPost } from "../src/app/api/reference/escrow/a2a/route";
import { GET as cardGet } from "../src/app/api/reference/escrow/.well-known/agent-card.json/route";

function send(parts: unknown[]): Promise<Response> {
  return a2aPost(
    new NextRequest("http://localhost/api/reference/escrow/a2a", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { role: "user", kind: "message", messageId: "m1", parts } },
      }),
    }),
  );
}

function sendRaw(body: unknown): Promise<Response> {
  return a2aPost(
    new NextRequest("http://localhost/api/reference/escrow/a2a", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function taskOf(body: Record<string, unknown>): Record<string, unknown> {
  return (body.result as Record<string, unknown>).task as Record<string, unknown>;
}

function statusOf(task: Record<string, unknown>): Record<string, unknown> {
  return task.status as Record<string, unknown>;
}

function textOf(task: Record<string, unknown>): string {
  const parts = (statusOf(task).message as { parts: { text: string }[] }).parts;
  return parts[0].text;
}

function artifactOf(task: Record<string, unknown>): Record<string, unknown> {
  const artifacts = task.artifacts as { parts: { kind: string; data: unknown }[] }[];
  return artifacts[0].parts[0].data as Record<string, unknown>;
}

interface Extracted {
  text: string;
  found: boolean;
}

describe("agent card", () => {
  it("names the escrow keeper and advertises a public messaging url", () => {
    const card = escrowKeeperAgentCard(ESCROW_KEEPER_AGENT_PUBLIC_ORIGIN);
    expect(card.name).toBe(ESCROW_KEEPER_AGENT_NAME);
    expect(card.version).toBe(ESCROW_KEEPER_AGENT_VERSION);
    expect(card.description).toBe(ESCROW_KEEPER_AGENT_DESCRIPTION);
    // the marketplace classifier files on this word
    expect(card.description.toLowerCase()).toContain("escrow");
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe("plan_escrow");

    const messagingUrl = escrowKeeperMessagingUrl(ESCROW_KEEPER_AGENT_PUBLIC_ORIGIN);
    expect(messagingUrl).toBe(
      `${ESCROW_KEEPER_AGENT_PUBLIC_ORIGIN}${ESCROW_KEEPER_MESSAGING_PATH}`,
    );
    expect(card.url).toBe(messagingUrl);
    expect(card.supportedInterfaces[0]).toEqual({ url: messagingUrl, transport: "JSONRPC" });
  });

  it("never advertises a private address, even when one is configured first", () => {
    const origin = escrowKeeperPickPublicOrigin([
      "http://localhost:3000",
      "https://api.agentsouk.xyz",
    ]);
    expect(privateEndpointReason(origin)).toBeNull();
    expect(privateEndpointReason(escrowKeeperMessagingUrl(origin))).toBeNull();
    expect(escrowKeeperMessagingUrl(origin)).toBe(
      "https://api.agentsouk.xyz/api/reference/escrow/a2a",
    );
  });

  it("serves the card that a listing registers on", async () => {
    expect(ESCROW_KEEPER_CARD_PATH).toBe("/api/reference/escrow/.well-known/agent-card.json");
    const card = (await json((await cardGet(
      new NextRequest("http://localhost" + ESCROW_KEEPER_CARD_PATH),
    ) as unknown) as Response)) as unknown as {
      name: string;
      url: string;
      skills: { id: string }[];
    };
    expect(card.name).toBe(ESCROW_KEEPER_AGENT_NAME);
    expect(privateEndpointReason(card.url)).toBeNull();
    expect(card.skills.map((s) => s.id)).toEqual(["plan_escrow"]);
  });
});

describe("planEscrow", () => {
  it("computes fee, net payable, allocation and buffer against hand computed figures", () => {
    // 1000 at 250 bps = 25, net 975; milestones 400 + 600 = 1000, buffer 0
    const result = planEscrow({
      amountUsd: 1000,
      feeBps: 250,
      disputeWindowHours: 72,
      milestones: [400, 600],
    });
    expect(result.heldUsd).toBe(1000);
    expect(result.feeCostUsd).toBe(25);
    expect(result.netPayableUsd).toBe(975);
    expect(result.milestoneCount).toBe(2);
    expect(result.allocatedUsd).toBe(1000);
    expect(result.bufferUsd).toBe(0);
    expect(result.releaseAtHour).toBe(72);
    expect(result.state).toBe("exact");
  });

  it("defaults to no fee and a 72 hour window, and holds everything when no milestones are planned", () => {
    const result = planEscrow({
      amountUsd: 500,
      feeBps: ESCROW_DEFAULT_FEE_BPS,
      disputeWindowHours: ESCROW_DEFAULT_DISPUTE_WINDOW_HOURS,
      milestones: [],
    });
    expect(result.feeCostUsd).toBe(0);
    expect(result.netPayableUsd).toBe(500);
    expect(result.allocatedUsd).toBe(0);
    expect(result.bufferUsd).toBe(500);
    expect(result.state).toBe("buffer-held");
  });
});

describe("input extraction", () => {
  it("reads aliases and unwraps an input wrapper", () => {
    const fields = extractEscrowInput({
      input: { amount: "1,000", fee: "250", window: 48, milestones: "400 600" },
    });
    expect(fields.amountUsd).toBe(1000);
    expect(fields.feeBps).toBe(250);
    expect(fields.disputeWindowHours).toBe(48);
    expect(fields.milestones).toEqual([400, 600]);
  });

  it("reads labelled figures from plain text", () => {
    const fields = mergeEscrowInput(
      undefined,
      "plan an escrow of 1000 with a fee of 250 bps and a dispute window 72 hours with milestones 400 600",
    );
    expect(fields.amountUsd).toBe(1000);
    expect(fields.feeBps).toBe(250);
    expect(fields.disputeWindowHours).toBe(72);
    expect(fields.milestones).toEqual([400, 600]);
  });
});

describe("message/send", () => {
  it("plans the deal from a text part and a structured data part", async () => {
    const res = await send([
      { kind: "text", text: "Plan the escrow for our deal" },
      {
        kind: "data",
        data: { input: { amountUsd: 1000, feeBps: 250, disputeWindowHours: 72, milestones: [400, 600] } },
      },
    ]);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = await json(res);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);

    const task = taskOf(body);
    expect(statusOf(task).state).toBe("completed");
    expect(textOf(task)).toContain("net payable to the seller is 975 USD");
    expect(textOf(task)).toContain("exact");

    const artifact = artifactOf(task);
    expect(String(artifact.formula)).toContain("netPayableUsd = heldUsd - heldUsd * feeBps / 10000");
    const result = artifact.result as Record<string, number | string>;
    expect(result.heldUsd).toBe(1000);
    expect(result.feeCostUsd).toBe(25);
    expect(result.netPayableUsd).toBe(975);
    expect(result.state).toBe("exact");
    expect(ESCROW_KEEPER_AGENT_CATEGORY).toBe("escrow");
  });

  it("uses the defaults when only the amount is supplied", async () => {
    const body = await json(
      await send([{ kind: "text", text: "escrow 1000" }, { kind: "data", data: { input: { amountUsd: 1000, milestones: [400, 600] } } }]),
    );
    const inputs = artifactOf(taskOf(body)).inputs as Record<string, unknown>;
    expect(inputs.feeBps).toBe(ESCROW_DEFAULT_FEE_BPS);
    expect(inputs.disputeWindowHours).toBe(ESCROW_DEFAULT_DISPUTE_WINDOW_HOURS);
    const result = artifactOf(taskOf(body)).result as Record<string, number>;
    expect(result.allocatedUsd).toBe(1000);
    expect(result.state).toBe("exact");
  });

  it("asks for a missing amount instead of guessing it", async () => {
    const res = await send([{ kind: "text", text: "Plan an escrow for a 72 hour window" }]);
    const body = await json(res);
    const task = taskOf(body);
    expect(statusOf(task).state).toBe("input-required");

    const text = textOf(task);
    expect(text).toContain("will not guess");
    expect(text).toContain("amountUsd");

    const artifact = artifactOf(task);
    expect(artifact.status).toBe("input-required");
    expect(artifact.missing).toEqual(["amountUsd"]);
    const received = artifact.received as Record<string, unknown>;
    expect(received.amountUsd).toBeNull();
    expect(received.disputeWindowHours).toBe(72);
  });

  it("refuses milestones that allocate more than the escrow holds", async () => {
    const body = await json(
      await send([
        {
          kind: "data",
          data: { input: { amountUsd: 1000, milestones: [600, 600] } },
        },
      ]),
    );
    const task = taskOf(body);
    expect(statusOf(task).state).toBe("input-required");
    const artifact = artifactOf(task);
    expect(artifact.missing).toEqual([]);
    expect((artifact.problems as string[]).join(" ")).toContain(
      "exceeds the 1000 USD escrow",
    );
  });

  it("refuses an out of range fee and dispute window rather than computing", async () => {
    const body = await json(
      await send([
        { kind: "data", data: { input: { amountUsd: 1000, feeBps: 20000, disputeWindowHours: 0 } } },
      ]),
    );
    const artifact = artifactOf(taskOf(body));
    const problems = (artifact.problems as string[]).join(" ");
    expect(problems).toContain("feeBps must be from 0 to 10000");
    expect(problems).toContain("disputeWindowHours must be from 1 to 8760");
  });

  it("answers the benign capability probe rather than erroring", async () => {
    const res = await send([{ kind: "text", text: "report your status in one sentence" }]);
    expect(res.status).toBe(200);
    const task = taskOf(await json(res));
    expect(statusOf(task).state).toBe("completed");
    expect(textOf(task)).toContain("Souk Escrow Keeper");
    const artifact = artifactOf(task);
    expect(artifact.action).toBe("plan_escrow");
    expect(artifact.required).toEqual(["amountUsd"]);
  });
});

describe("malformed requests", () => {
  it("rejects a body that is not JSON", async () => {
    const res = await a2aPost(
      new NextRequest("http://localhost/api/reference/escrow/a2a", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ this is not json",
      }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.id).toBeNull();
    expect((body.error as { code: number }).code).toBe(-32700);
  });

  it("reports an unknown method as method not found", async () => {
    const body = await json(
      await sendRaw({ jsonrpc: "2.0", id: 7, method: "message/stream" }),
    );
    expect(body.id).toBe(7);
    expect((body.error as { code: number }).code).toBe(-32601);
    expect(body.result).toBeUndefined();
  });

  it("rejects message/send without any parts", async () => {
    const body = await json(
      await sendRaw({ jsonrpc: "2.0", id: 8, method: "message/send", params: {} }),
    );
    expect((body.error as { code: number }).code).toBe(-32602);
    expect(body.result).toBeUndefined();
  });
});

describe("marketplace extraction", () => {
  it("parses a computed reply through the real extraction code", async () => {
    const body = await json(
      await send([
        {
          kind: "data",
          data: { input: { amountUsd: 1000, feeBps: 250, milestones: [400, 600] } },
        },
      ]),
    );
    const extracted = extractA2aDeliverable(body.result) as Extracted;
    expect(extracted.found).toBe(true);
    expect(extracted.text).toContain("net payable to the seller is 975 USD");
    expect(extracted.text).toContain('"netPayableUsd": 975');
  });

  it("grades a computed reply as good enough for the market", async () => {
    const body = await json(
      await send([
        {
          kind: "data",
          data: { input: { amountUsd: 1000, feeBps: 250, milestones: [400, 600] } },
        },
      ]),
    );
    expect(scoreDelivery(body.result).grade).toBe("good");
  });

  it("gives the endpoint the same answer decide work computes directly", async () => {
    const input = { amountUsd: 1000, feeBps: 250, milestones: [400, 600] };
    const body = await json(
      await send([{ kind: "text", text: "plan the escrow" }, { kind: "data", data: { input } }]),
    );
    const direct = decideEscrowKeeperTask("plan the escrow", input);
    expect(textOf(taskOf(body))).toBe(direct.text);
    expect(artifactOf(taskOf(body))).toEqual(direct.artifact);
  });
});
