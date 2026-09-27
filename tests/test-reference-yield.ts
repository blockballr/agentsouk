// The first party reference yield agent: the card must advertise a public
// messaging url, both surfaces must answer from the one deterministic decision
// function, and a missing value must be asked for rather than guessed. The A2A
// and MCP tests also run the reply through the marketplace's own extraction and
// grading code, so it is readable by the market and not only by this endpoint.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  DEFAULT_COMPOUNDING_PER_YEAR,
  DEFAULT_FEE_BPS,
  REFERENCE_YIELD_DESCRIPTION,
  REFERENCE_YIELD_MESSAGING_PATH,
  REFERENCE_YIELD_NAME,
  REFERENCE_YIELD_PUBLIC_ORIGIN,
  REFERENCE_YIELD_VERSION,
  computeNetYield,
  decideReferenceYieldTask,
  extractYieldInput,
  parseYieldText,
  pickPublicOrigin,
  referenceYieldCard,
  referenceYieldMessagingUrl,
} from "../src/lib/reference-yield";
import { privateEndpointReason } from "../src/lib/endpoint";
import { parseA2A, scoreDelivery } from "../src/lib/quality";
import { MCP_PROTOCOL_VERSION } from "../src/lib/mcp-tools";

// delivery.ts carries the server-only marker, which throws outside a server bundle
vi.mock("server-only", () => ({}));

import { extractA2aDeliverable } from "../src/lib/delivery";
import { POST as a2aPost } from "../src/app/api/reference/yield/a2a/route";
import { POST as mcpPost } from "../src/app/api/reference/yield/mcp/route";
import { GET as cardGet } from "../src/app/api/reference/yield/.well-known/agent-card.json/route";

function send(parts: unknown[]): Promise<Response> {
  return a2aPost(
    new NextRequest("http://localhost/api/reference/yield/a2a", {
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
    new NextRequest("http://localhost/api/reference/yield/a2a", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function rpc(body: unknown): Promise<Response> {
  return mcpPost(
    new NextRequest("http://localhost/api/reference/yield/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    }),
  );
}

function toolCall(name: string, args?: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args ?? {} } };
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

interface ToolResult {
  content: { type: string; text: string }[];
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

function resultOf(body: Record<string, unknown>): ToolResult {
  return body.result as ToolResult;
}

interface Extracted {
  text: string;
  found: boolean;
}

describe("agent card", () => {
  it("names the yield agent and advertises a public messaging url", () => {
    const card = referenceYieldCard(REFERENCE_YIELD_PUBLIC_ORIGIN);
    expect(card.name).toBe(REFERENCE_YIELD_NAME);
    expect(card.version).toBe(REFERENCE_YIELD_VERSION);
    expect(card.description).toBe(REFERENCE_YIELD_DESCRIPTION);
    // the marketplace classifier files on this word
    expect(card.description.toLowerCase()).toContain("yield");
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe("compute_net_yield");

    const messagingUrl = referenceYieldMessagingUrl(REFERENCE_YIELD_PUBLIC_ORIGIN);
    expect(messagingUrl).toBe(
      `${REFERENCE_YIELD_PUBLIC_ORIGIN}${REFERENCE_YIELD_MESSAGING_PATH}`,
    );
    expect(card.url).toBe(messagingUrl);
    expect(card.supportedInterfaces[0]).toEqual({ url: messagingUrl, transport: "JSONRPC" });
  });

  it("never advertises a private address, even when one is configured first", () => {
    const origin = pickPublicOrigin(["http://localhost:3000", "https://api.agentsouk.xyz"]);
    expect(privateEndpointReason(origin)).toBeNull();
    expect(privateEndpointReason(referenceYieldMessagingUrl(origin))).toBeNull();
    expect(referenceYieldMessagingUrl(origin)).toBe(
      "https://api.agentsouk.xyz/api/reference/yield/a2a",
    );
  });

  it("serves the card from its own well-known route", async () => {
    const card = (await json((await cardGet()) as unknown as Response)) as unknown as {
      name: string;
      url: string;
    };
    expect(card.name).toBe(REFERENCE_YIELD_NAME);
    expect(privateEndpointReason(card.url)).toBeNull();
  });
});

describe("computeNetYield", () => {
  it("computes monthly compounding and a fee against a hand computed expectation", () => {
    // (1 + 0.12/12)^12 - 1 = 0.126825, net of 200 bps = 0.106825, earnings 1068.25
    const result = computeNetYield({
      principalUsd: 10000,
      grossApyPercent: 12,
      compoundingPerYear: 12,
      feeBps: 200,
    });
    expect(result.effectiveAnnualRatePercent).toBe(12.6825);
    expect(result.netRatePercent).toBe(10.6825);
    expect(result.feeDragPercent).toBe(2);
    expect(result.projectedEarningsUsd).toBe(1068.25);
    expect(result.state).toBe("net-positive");
  });

  it("computes annual compounding exactly", () => {
    const result = computeNetYield({
      principalUsd: 1000,
      grossApyPercent: 5,
      compoundingPerYear: 1,
      feeBps: 0,
    });
    expect(result.effectiveAnnualRatePercent).toBe(5);
    expect(result.netRatePercent).toBe(5);
    expect(result.projectedEarningsUsd).toBe(50);
    expect(result.state).toBe("net-positive");
  });

  it("reports fee-dominated when the fee leaves nothing or less", () => {
    // effective rate 3.0416% cannot cover a 500 bps fee, so the net rate is negative
    const result = computeNetYield({
      principalUsd: 5000,
      grossApyPercent: 3,
      compoundingPerYear: 12,
      feeBps: 500,
    });
    expect(result.effectiveAnnualRatePercent).toBe(3.0416);
    expect(result.netRatePercent).toBe(-1.9584);
    expect(result.feeDragPercent).toBe(5);
    expect(result.projectedEarningsUsd).toBe(-97.92);
    expect(result.state).toBe("fee-dominated");
  });

  it("treats a zero net rate as fee-dominated, not net-positive", () => {
    const result = computeNetYield({
      principalUsd: 1000,
      grossApyPercent: 0,
      compoundingPerYear: 12,
      feeBps: 0,
    });
    expect(result.netRatePercent).toBe(0);
    expect(result.state).toBe("fee-dominated");
  });
});

describe("input extraction", () => {
  it("reads aliases and unwraps an input wrapper", () => {
    const fields = extractYieldInput({
      input: { principal: "10,000", apy: "12%", frequency: 12, feeBps: 200 },
    });
    expect(fields.principalUsd).toBe(10000);
    expect(fields.grossApyPercent).toBe(12);
    expect(fields.compoundingPerYear).toBe(12);
    expect(fields.feeBps).toBe(200);
  });

  it("flags an out of range compounding frequency and fee without inventing values", () => {
    const fields = extractYieldInput({ compoundingPerYear: 400, feeBps: 20000 });
    expect(fields.compoundingPerYear).toBeUndefined();
    expect(fields.compoundingInvalid).toBe(true);
    expect(fields.feeBps).toBeUndefined();
    expect(fields.feeInvalid).toBe(true);
  });

  it("reads only labelled numbers from plain text", () => {
    const fields = parseYieldText("principal 10000 at a gross APY of 12 with a fee of 200 bps");
    expect(fields.principalUsd).toBe(10000);
    expect(fields.grossApyPercent).toBe(12);
    expect(fields.feeBps).toBe(200);
  });
});

describe("message/send", () => {
  it("computes the net yield from a text part and a structured data part", async () => {
    const res = await send([
      { kind: "text", text: "Compute the net yield for my deposit" },
      {
        kind: "data",
        data: { input: { principalUsd: 10000, grossApyPercent: 12, compoundingPerYear: 12, feeBps: 200 } },
      },
    ]);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = await json(res);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);

    const task = taskOf(body);
    expect(statusOf(task).state).toBe("completed");
    expect(textOf(task)).toContain("Net rate 10.6825%");
    expect(textOf(task)).toContain("net-positive");

    const artifact = artifactOf(task);
    expect(String(artifact.formula)).toContain("netRate = effectiveAnnualRate - feeBps / 10000");
    const result = artifact.result as Record<string, number | string>;
    expect(result.effectiveAnnualRatePercent).toBe(12.6825);
    expect(result.netRatePercent).toBe(10.6825);
    expect(result.feeDragPercent).toBe(2);
    expect(result.projectedEarningsUsd).toBe(1068.25);
    expect(result.state).toBe("net-positive");
  });

  it("uses the default compounding frequency and fee when only principal and rate are supplied", async () => {
    const body = await json(
      await send([
        { kind: "data", data: { input: { principalUsd: 1000, grossApyPercent: 5 } } },
      ]),
    );
    const inputs = artifactOf(taskOf(body)).inputs as Record<string, number>;
    expect(inputs.compoundingPerYear).toBe(DEFAULT_COMPOUNDING_PER_YEAR);
    expect(inputs.feeBps).toBe(DEFAULT_FEE_BPS);
    // 12 periods on a 5% nominal rate is 5.1162% of net rate with no fee
    const result = artifactOf(taskOf(body)).result as Record<string, number>;
    expect(result.netRatePercent).toBe(5.1162);
  });

  it("asks for a missing value instead of guessing it", async () => {
    const res = await send([
      { kind: "text", text: "What is the net yield on my deposit?" },
    ]);
    const body = await json(res);
    const task = taskOf(body);
    expect(statusOf(task).state).toBe("input-required");

    const text = textOf(task);
    expect(text).toContain("will not guess");
    expect(text).toContain("principalUsd");
    expect(text).toContain("grossApyPercent");

    const artifact = artifactOf(task);
    expect(artifact.status).toBe("input-required");
    expect(artifact.missing).toEqual(expect.arrayContaining(["principalUsd", "grossApyPercent"]));
    const received = artifact.received as Record<string, unknown>;
    expect(received.principalUsd).toBeNull();
    expect(received.grossApyPercent).toBeNull();
  });

  it("names only the field that is actually missing", async () => {
    const body = await json(
      await send([{ kind: "data", data: { input: { principalUsd: 10000 } } }]),
    );
    const artifact = artifactOf(taskOf(body));
    expect(artifact.missing).toEqual(["grossApyPercent"]);
    const received = artifact.received as Record<string, unknown>;
    expect(received.principalUsd).toBe(10000);
    expect(received.grossApyPercent).toBeNull();
  });

  it("refuses a non positive principal rather than computing", async () => {
    const body = await json(
      await send([
        { kind: "data", data: { input: { principalUsd: 0, grossApyPercent: 12 } } },
      ]),
    );
    const task = taskOf(body);
    expect(statusOf(task).state).toBe("input-required");
    const artifact = artifactOf(task);
    expect(artifact.missing).toEqual([]);
    expect(artifact.problems).toEqual(
      expect.arrayContaining(["principalUsd must be greater than zero"]),
    );
  });

  it("answers the benign capability probe rather than erroring", async () => {
    const res = await send([{ kind: "text", text: "report your status in one sentence" }]);
    expect(res.status).toBe(200);
    const task = taskOf(await json(res));
    expect(statusOf(task).state).toBe("completed");
    expect(textOf(task)).toContain("Souk Yield Lens");
    const artifact = artifactOf(task);
    expect(artifact.action).toBe("compute_net_yield");
    expect(artifact.required).toEqual(expect.arrayContaining(["principalUsd", "grossApyPercent"]));
  });
});

describe("malformed requests", () => {
  it("rejects a body that is not JSON", async () => {
    const res = await a2aPost(
      new NextRequest("http://localhost/api/reference/yield/a2a", {
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

  it("rejects a request whose jsonrpc version is not 2.0", async () => {
    const body = await json(
      await sendRaw({ jsonrpc: "1.0", id: 9, method: "message/send", params: {} }),
    );
    expect(body.error).toMatchObject({ code: -32600 });
  });
});

describe("marketplace extraction", () => {
  it("parses a computed reply through the real extraction code", async () => {
    const body = await json(
      await send([
        {
          kind: "data",
          data: { input: { principalUsd: 10000, grossApyPercent: 12, compoundingPerYear: 12, feeBps: 200 } },
        },
      ]),
    );
    const extracted = extractA2aDeliverable(body.result) as Extracted;
    expect(extracted.found).toBe(true);
    expect(extracted.text).toContain("Net rate 10.6825%");
    expect(extracted.text).toContain('"netRatePercent": 10.6825');
  });
});

describe("MCP initialize", () => {
  it("answers with the requested version, tool capability and server info", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = await json(res);
    expect(body.id).toBe(1);
    const result = body.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect((result.serverInfo as Record<string, unknown>).name).toBe("souk-yield-lens");
    expect(String(result.instructions)).toContain("compute_net_yield");
  });

  it("accepts the initialized notification with no reply", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });
});

describe("MCP tools/list", () => {
  it("names the net yield tool with its real input schema", async () => {
    const body = await json(
      await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    );
    const tools = (body.result as Record<string, unknown>).tools as {
      name: string;
      inputSchema: {
        type: string;
        properties: Record<string, { minimum?: number; maximum?: number; exclusiveMinimum?: number }>;
        required?: string[];
        additionalProperties?: boolean;
      };
    }[];
    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.name).toBe("compute_net_yield");
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual([
      "compoundingPerYear",
      "feeBps",
      "grossApyPercent",
      "principalUsd",
    ]);
    expect(tool.inputSchema.required).toEqual(
      expect.arrayContaining(["principalUsd", "grossApyPercent"]),
    );
    expect(tool.inputSchema.properties.principalUsd.exclusiveMinimum).toBe(0);
    expect(tool.inputSchema.properties.grossApyPercent.minimum).toBe(0);
    expect(tool.inputSchema.properties.compoundingPerYear.maximum).toBe(365);
    expect(tool.inputSchema.properties.feeBps.maximum).toBe(10000);
  });
});

describe("MCP tools/call", () => {
  const args = {
    principalUsd: 10000,
    grossApyPercent: 12,
    compoundingPerYear: 12,
    feeBps: 200,
  };

  it("computes the net yield against a hand computed expectation", async () => {
    const body = await json(await rpc(toolCall("compute_net_yield", args)));
    const result = resultOf(body);
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Net rate 10.6825%");
    expect(result.content[0].text).toContain("net-positive");

    const artifact = result.structuredContent;
    expect(String(artifact.formula)).toContain("netRate = effectiveAnnualRate - feeBps / 10000");
    const computed = artifact.result as Record<string, number | string>;
    expect(computed.effectiveAnnualRatePercent).toBe(12.6825);
    expect(computed.netRatePercent).toBe(10.6825);
    expect(computed.feeDragPercent).toBe(2);
    expect(computed.projectedEarningsUsd).toBe(1068.25);
    expect(computed.state).toBe("net-positive");
  });

  it("uses the defaults when the optional fields are omitted", async () => {
    const body = await json(await rpc(toolCall("compute_net_yield", { principalUsd: 1000, grossApyPercent: 5 })));
    const artifact = resultOf(body).structuredContent;
    const inputs = artifact.inputs as Record<string, number>;
    expect(inputs.compoundingPerYear).toBe(DEFAULT_COMPOUNDING_PER_YEAR);
    expect(inputs.feeBps).toBe(DEFAULT_FEE_BPS);
  });

  it("reports a fee-dominated result without erroring", async () => {
    const body = await json(
      await rpc(toolCall("compute_net_yield", { principalUsd: 5000, grossApyPercent: 3, feeBps: 500 })),
    );
    const result = resultOf(body);
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Fee-dominated");
    const computed = result.structuredContent.result as Record<string, number | string>;
    expect(computed.netRatePercent).toBe(-1.9584);
    expect(computed.state).toBe("fee-dominated");
  });

  it("asks for a missing input rather than guessing it", async () => {
    const body = await json(await rpc(toolCall("compute_net_yield", { principalUsd: 10000 })));
    const result = resultOf(body);
    expect(result.content[0].text).toContain("will not guess");
    expect(result.content[0].text).toContain("grossApyPercent");

    const artifact = result.structuredContent;
    expect(artifact.status).toBe("input-required");
    expect(artifact.missing).toContain("grossApyPercent");
    const received = artifact.received as Record<string, unknown>;
    expect(received.principalUsd).toBe(10000);
    expect(received.grossApyPercent).toBeNull();
  });

  it("answers a plain probe with the capability reply rather than refusing", async () => {
    const body = await json(await rpc(toolCall("compute_net_yield")));
    const result = resultOf(body);
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Souk Yield Lens");
    expect(result.structuredContent.action).toBe("compute_net_yield");
    expect(result.structuredContent.status).toBe("ok");
  });

  it("returns exactly what decideReferenceYieldTask computes, so neither surface forks the logic", async () => {
    const body = await json(await rpc(toolCall("compute_net_yield", args)));
    const result = resultOf(body);
    const direct = decideReferenceYieldTask("", args);
    expect(result.content[0].text).toBe(direct.text);
    expect(result.structuredContent).toEqual(direct.artifact);
  });

  it("parses a computed reply through the marketplace's own extraction code", async () => {
    const body = await json(await rpc(toolCall("compute_net_yield", args)));
    const mirrored = resultOf(body)
      .content.map((c) => c.text)
      .filter(Boolean)
      .join("\n");
    expect(mirrored).toContain("Net rate 10.6825%");
    expect(mirrored).toContain('"netRatePercent": 10.6825');

    const parsed = parseA2A(body.result);
    expect(parsed.parts).toBe(2);
    expect(parsed.text).toContain("Net rate 10.6825%");
    expect(scoreDelivery(body.result).grade).toBe("good");
  });
});

describe("one implementation across surfaces", () => {
  it("gives the A2A and MCP surfaces the same answer for the same values", async () => {
    const args = {
      principalUsd: 10000,
      grossApyPercent: 12,
      compoundingPerYear: 12,
      feeBps: 200,
    };
    const a2aBody = await json(
      await send([{ kind: "data", data: { input: args } }]),
    );
    const mcpBody = await json(await rpc(toolCall("compute_net_yield", args)));
    const direct = decideReferenceYieldTask("", args);

    const a2aTask = taskOf(a2aBody);
    expect(textOf(a2aTask)).toBe(direct.text);
    expect(artifactOf(a2aTask)).toEqual(direct.artifact);
    expect(resultOf(mcpBody).content[0].text).toBe(direct.text);
    expect(resultOf(mcpBody).structuredContent).toEqual(direct.artifact);
  });
});

describe("MCP JSON-RPC error paths", () => {
  it("reports an unknown method as method not found", async () => {
    const body = await json(await rpc({ jsonrpc: "2.0", id: 5, method: "does/not/exist" }));
    expect(body.id).toBe(5);
    expect((body.error as { code: number }).code).toBe(-32601);
    expect(body.result).toBeUndefined();
  });

  it("reports an unknown tool as invalid params", async () => {
    const body = await json(
      await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "no_such_tool", arguments: {} } }),
    );
    expect((body.error as { code: number }).code).toBe(-32602);
    expect(String((body.error as { message: string }).message)).toMatch(/unknown tool/i);
  });

  it("rejects a tools/call without a tool name", async () => {
    const body = await json(
      await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { arguments: {} } }),
    );
    expect((body.error as { code: number }).code).toBe(-32602);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await mcpPost(
      new NextRequest("http://localhost/api/reference/yield/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ this is not json",
      }),
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect((body.error as { code: number }).code).toBe(-32700);
    expect(body.id).toBeNull();
  });
});
