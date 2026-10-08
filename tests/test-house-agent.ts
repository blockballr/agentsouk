// The house health-factor agent's A2A surface: the card must advertise a public
// messaging url, message/send must answer with deterministic arithmetic, and the
// answer must survive the marketplace's own extraction code. A missing value is
// asked for, never guessed.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  HOUSE_AGENT_DESCRIPTION,
  HOUSE_AGENT_MESSAGING_PATH,
  HOUSE_AGENT_NAME,
  HOUSE_AGENT_PUBLIC_ORIGIN,
  HOUSE_AGENT_VERSION,
  houseAgentCard,
  houseAgentMessagingUrl,
  pickPublicOrigin,
} from "../src/lib/house-agent";
import { privateEndpointReason } from "../src/lib/endpoint";

// delivery.ts carries the server-only marker, which throws outside a server bundle
vi.mock("server-only", () => ({}));

import { extractA2aDeliverable } from "../src/lib/delivery";
import { POST } from "../src/app/api/house-agent/a2a/route";

function send(body: unknown, raw?: string): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/house-agent/a2a", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

function messageSend(parts: unknown[], id: number | string = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "message/send",
    params: { message: { role: "user", kind: "message", messageId: "m1", parts } },
  };
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

interface Extracted {
  text: string;
  found: boolean;
}

describe("agent card", () => {
  it("names the house agent and advertises a public messaging url", () => {
    const card = houseAgentCard(HOUSE_AGENT_PUBLIC_ORIGIN);
    expect(card.name).toBe(HOUSE_AGENT_NAME);
    expect(card.version).toBe(HOUSE_AGENT_VERSION);
    expect(card.description).toBe(HOUSE_AGENT_DESCRIPTION);
    // one work skill and the two ERC-8183 protocol steps, negotiate and
    // notify_funded, that sell through the shared kernel
    expect(card.skills).toHaveLength(3);
    expect(card.skills.map((s) => s.id)).toEqual(["compute-health-factor", "negotiate", "notify_funded"]);

    const messagingUrl = houseAgentMessagingUrl(HOUSE_AGENT_PUBLIC_ORIGIN);
    expect(messagingUrl).toBe(`${HOUSE_AGENT_PUBLIC_ORIGIN}${HOUSE_AGENT_MESSAGING_PATH}`);
    expect(card.url).toBe(messagingUrl);
    expect(card.supportedInterfaces[0]).toEqual({ url: messagingUrl, transport: "JSONRPC" });
  });

  it("never advertises a private address, even when one is configured first", () => {
    const origin = pickPublicOrigin(["http://localhost:3000", "https://api.agentsouk.xyz"]);
    expect(privateEndpointReason(origin)).toBeNull();
    expect(privateEndpointReason(houseAgentMessagingUrl(origin))).toBeNull();
    expect(houseAgentMessagingUrl(origin)).toBe(
      "https://api.agentsouk.xyz/api/house-agent/a2a",
    );
  });
});

describe("message/send", () => {
  it("computes the health factor from a text part and a structured data part", async () => {
    const res = await send(
      messageSend([
        { kind: "text", text: "Compute the health factor for my lending position" },
        { kind: "data", data: { input: { collateral: 1000, debt: 500, liquidationThreshold: 0.8 } } },
      ]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = await json(res);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);

    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("completed");
    const textPart = (status.message as { parts: { text: string }[] }).parts[0];
    // hand computed: (1000 * 0.8) / 500 = 1.6, healthy
    expect(textPart.text).toContain("Health factor 1.6");
    expect(textPart.text).toContain("Liquidation capacity is 800 USD");
    expect(textPart.text).toContain("healthy");

    const artifact = (task.artifacts as { parts: { kind: string; data: unknown }[] }[])[0].parts[0];
    expect(artifact.kind).toBe("data");
    const data = artifact.data as { formula: string; result: Record<string, number | string | null> };
    expect(data.formula).toBe("healthFactor = (collateral * liquidationThreshold) / debt");
    expect(data.result.healthFactor).toBe(1.6);
    expect(data.result.state).toBe("healthy");
    expect(data.result.liquidationCapacity).toBe(800);
    expect(data.result.maxDebtAtHealthFactorOne).toBe(800);
    expect(data.result.additionalDebtBeforeLiquidation).toBe(300);
    expect(data.result.liquidationDistance).toBe(0.375);
    expect(data.result.liquidationDistancePercent).toBe(37.5);
  });

  it("uses the default threshold when only collateral and debt are supplied", async () => {
    const body = await json(
      await send(
        messageSend([{ kind: "data", data: { input: { collateral: 1000, debt: 500 } } }]),
      ),
    );
    const data = ((body.result as Record<string, unknown>).task as Record<string, unknown>)
      .artifacts as {
      parts: {
        data: { inputs: { liquidationThreshold: number }; result: { healthFactor: number } };
      }[];
    }[];
    // default 0.8, so the answer equals the explicit-threshold case
    expect(data[0].parts[0].data.inputs.liquidationThreshold).toBe(0.8);
    expect(data[0].parts[0].data.result.healthFactor).toBe(1.6);
  });

  it("asks for a missing value instead of guessing it", async () => {
    const res = await send(
      messageSend([{ kind: "text", text: "What is my health factor for my lending position?" }]),
    );
    const body = await json(res);
    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("input-required");

    const text = (status.message as { parts: { text: string }[] }).parts[0].text;
    expect(text).toContain("will not guess");
    expect(text).toContain("collateral");
    expect(text).toContain("debt");

    const artifact = ((task.artifacts as { parts: { data: unknown }[] }[])[0].parts[0].data) as {
      status: string;
      missing: string[];
      received: Record<string, unknown>;
    };
    expect(artifact.status).toBe("input-required");
    expect(artifact.missing).toEqual(expect.arrayContaining(["collateral", "debt"]));
    expect(artifact.received.collateral).toBeNull();
    expect(artifact.received.debt).toBeNull();
  });

  it("answers the benign capability probe rather than erroring", async () => {
    const res = await send(messageSend([{ kind: "text", text: "report your status in one sentence" }]));
    expect(res.status).toBe(200);
    const body = await json(res);
    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("completed");

    const text = (status.message as { parts: { text: string }[] }).parts[0].text;
    expect(text).toContain("Souk Health Guard");
    const artifact = ((task.artifacts as { parts: { data: { action: string; required: string[] } }[] }[])[0].parts[0]).data;
    expect(artifact.action).toBe("compute_health_factor");
    expect(artifact.required).toEqual(expect.arrayContaining(["collateral", "debt"]));
  });
});

describe("malformed requests", () => {
  it("rejects a body that is not JSON", async () => {
    const res = await send(undefined, "{ this is not json");
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.id).toBeNull();
    expect((body.error as { code: number }).code).toBe(-32700);
    expect(body.result).toBeUndefined();
  });

  it("reports an unknown method as method not found", async () => {
    const res = await send({ jsonrpc: "2.0", id: 7, method: "message/stream" });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.id).toBe(7);
    expect((body.error as { code: number }).code).toBe(-32601);
    expect(body.result).toBeUndefined();
  });

  it("rejects message/send without any parts", async () => {
    const res = await send({ jsonrpc: "2.0", id: 8, method: "message/send", params: {} });
    const body = await json(res);
    expect((body.error as { code: number }).code).toBe(-32602);
    expect(body.result).toBeUndefined();
  });

  it("rejects a request whose jsonrpc version is not 2.0", async () => {
    const res = await send({ jsonrpc: "1.0", id: 9, method: "message/send", params: {} });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatchObject({ code: -32600 });
  });
});

describe("marketplace extraction", () => {
  it("parses a computed reply through the real extraction code", async () => {
    const body = await json(
      await send(
        messageSend([
          { kind: "text", text: "health factor for collateral 1000 and debt 500" },
          { kind: "data", data: { input: { collateral: 1000, debt: 500, liquidationThreshold: 0.8 } } },
        ]),
      ),
    );
    const extracted = extractA2aDeliverable(body.result) as Extracted;
    expect(extracted.found).toBe(true);
    expect(extracted.text).toContain("Health factor 1.6");
    expect(extracted.text).toContain('"healthFactor": 1.6');
    expect(extracted.text).not.toContain("TASK_STATE");
    expect(extracted.text).not.toContain("artifacts");
  });

  it("parses the capability probe reply through the real extraction code", async () => {
    const body = await json(await send(messageSend([{ kind: "text", text: "report your status in one sentence" }])));
    const extracted = extractA2aDeliverable(body.result) as Extracted;
    expect(extracted.found).toBe(true);
    expect(extracted.text).toContain("Souk Health Guard");
  });
});
