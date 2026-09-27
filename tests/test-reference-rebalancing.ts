// The rebalancing reference agent's A2A surface: the card must advertise a
// public messaging url, message/send must answer with deterministic arithmetic,
// and the answer must survive the marketplace's own extraction code. A missing
// value is asked for, never guessed.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  REFERENCE_AGENT_DESCRIPTION,
  REFERENCE_AGENT_MESSAGING_PATH,
  REFERENCE_AGENT_NAME,
  REFERENCE_AGENT_PUBLIC_ORIGIN,
  REFERENCE_AGENT_VERSION,
  referenceAgentCard,
  referenceMessagingUrl,
  pickPublicOrigin,
} from "../src/lib/reference-rebalancing";
import { privateEndpointReason } from "../src/lib/endpoint";
import { classifyAgent } from "../src/lib/categories";

// delivery.ts carries the server-only marker, which throws outside a server bundle
vi.mock("server-only", () => ({}));

import { extractA2aDeliverable } from "../src/lib/delivery";
import { MCP_PROTOCOL_VERSION } from "../src/lib/mcp-tools";
import { decideReferenceTask } from "../src/lib/reference-rebalancing";
import { parseA2A, scoreDelivery } from "../src/lib/quality";
import { POST } from "../src/app/api/reference/rebalancing/a2a/route";
import { POST as MCP_POST } from "../src/app/api/reference/rebalancing/mcp/route";

function send(body: unknown, raw?: string): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/reference/rebalancing/a2a", {
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
  it("names the reference agent and advertises a public messaging url", () => {
    const card = referenceAgentCard(REFERENCE_AGENT_PUBLIC_ORIGIN);
    expect(card.name).toBe(REFERENCE_AGENT_NAME);
    expect(card.name).toBe("Souk Drift Guard");
    expect(card.version).toBe(REFERENCE_AGENT_VERSION);
    expect(card.description).toBe(REFERENCE_AGENT_DESCRIPTION);
    expect(card.description).toContain("rebalance");
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe("plan-rebalance");

    const messagingUrl = referenceMessagingUrl(REFERENCE_AGENT_PUBLIC_ORIGIN);
    expect(messagingUrl).toBe(`${REFERENCE_AGENT_PUBLIC_ORIGIN}${REFERENCE_AGENT_MESSAGING_PATH}`);
    expect(card.url).toBe(messagingUrl);
    expect(card.supportedInterfaces[0]).toEqual({ url: messagingUrl, transport: "JSONRPC" });
  });

  it("never advertises a private address, even when one is configured first", () => {
    const origin = pickPublicOrigin(["http://localhost:3000", "https://api.agentsouk.xyz"]);
    expect(privateEndpointReason(origin)).toBeNull();
    expect(privateEndpointReason(referenceMessagingUrl(origin))).toBeNull();
    expect(referenceMessagingUrl(origin)).toBe(
      "https://api.agentsouk.xyz/api/reference/rebalancing/a2a",
    );
  });
});

describe("message/send", () => {
  it("plans a rebalance from a text part and a structured data part", async () => {
    const res = await send(
      messageSend([
        { kind: "text", text: "Plan a rebalance for my portfolio" },
        {
          kind: "data",
          data: {
            input: {
              valueAUsd: 700,
              valueBUsd: 300,
              targetAPercent: 50,
              thresholdPercent: 5,
              symbolA: "BNB",
              symbolB: "USDT",
            },
          },
        },
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
    // hand computed: 700 / 1000 = 70%, drift 70 - 50 = +20 points, move 200 USD
    expect(textPart.text).toContain("A rebalance is needed");
    expect(textPart.text).toContain("Move 200 USD from BNB to USDT");
    expect(textPart.text).toContain("drift of +20 percentage points");
    expect(textPart.text).toContain("no market data");

    const artifact = (task.artifacts as { parts: { kind: string; data: unknown }[] }[])[0].parts[0];
    expect(artifact.kind).toBe("data");
    const data = artifact.data as {
      formula: string;
      result: Record<string, number | string | boolean | null>;
    };
    expect(data.formula).toBe(
      "driftAPercent = (valueAUsd / (valueAUsd + valueBUsd)) * 100 - targetAPercent",
    );
    expect(data.result.state).toBe("rebalance");
    expect(data.result.rebalanceWarranted).toBe(true);
    expect(data.result.totalUsd).toBe(1000);
    expect(data.result.currentAPercent).toBe(70);
    expect(data.result.currentBPercent).toBe(30);
    expect(data.result.driftAPercent).toBe(20);
    expect(data.result.driftBPercent).toBe(-20);
    expect(data.result.targetValueAUsd).toBe(500);
    expect(data.result.targetValueBUsd).toBe(500);
    expect(data.result.valueToMoveUsd).toBe(200);
    expect(data.result.fromSymbol).toBe("BNB");
    expect(data.result.toSymbol).toBe("USDT");
    // no price is accepted, so units are never invented
    expect(data.result.valueToMoveUnits).toBeNull();
    expect(data.result.priceSupplied).toBe(false);
  });

  it("reports an in-band portfolio without proposing a trade", async () => {
    const body = await json(
      await send(
        messageSend([
          {
            kind: "data",
            data: { input: { valueAUsd: 520, valueBUsd: 480, targetAPercent: 50, thresholdPercent: 5 } },
          },
        ]),
      ),
    );
    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("completed");
    const text = (status.message as { parts: { text: string }[] }).parts[0].text;
    // hand computed: 520 / 1000 = 52%, drift 52 - 50 = +2 points, inside 5
    expect(text).toContain("No rebalance is needed");

    const artifact = ((task.artifacts as { parts: { data: unknown }[] }[])[0].parts[0].data) as {
      result: Record<string, number | string | boolean | null>;
    };
    expect(artifact.result.state).toBe("in-band");
    expect(artifact.result.rebalanceWarranted).toBe(false);
    expect(artifact.result.driftAPercent).toBe(2);
    expect(artifact.result.valueToMoveUsd).toBeNull();
    expect(artifact.result.fromSymbol).toBeNull();
    expect(artifact.result.toSymbol).toBeNull();
  });

  it("uses the default threshold when only the required values are supplied", async () => {
    const body = await json(
      await send(
        messageSend([
          { kind: "data", data: { input: { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50 } } },
        ]),
      ),
    );
    const data = ((body.result as Record<string, unknown>).task as Record<string, unknown>)
      .artifacts as {
      parts: {
        data: { inputs: { thresholdPercent: number; symbolA: string }; result: { valueToMoveUsd: number } };
      }[];
    }[];
    // default 5 points, so the answer equals the explicit-threshold case
    expect(data[0].parts[0].data.inputs.thresholdPercent).toBe(5);
    expect(data[0].parts[0].data.inputs.symbolA).toBe("A");
    expect(data[0].parts[0].data.result.valueToMoveUsd).toBe(200);
  });

  it("asks for a missing value instead of guessing it", async () => {
    const res = await send(
      messageSend([{ kind: "text", text: "Plan a rebalance for my portfolio" }]),
    );
    const body = await json(res);
    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("input-required");

    const text = (status.message as { parts: { text: string }[] }).parts[0].text;
    expect(text).toContain("will not guess");
    expect(text).toContain("valueAUsd");
    expect(text).toContain("valueBUsd");
    expect(text).toContain("targetAPercent");

    const artifact = ((task.artifacts as { parts: { data: unknown }[] }[])[0].parts[0].data) as {
      status: string;
      missing: string[];
      received: Record<string, unknown>;
    };
    expect(artifact.status).toBe("input-required");
    expect(artifact.missing).toEqual(
      expect.arrayContaining(["valueAUsd", "valueBUsd", "targetAPercent"]),
    );
    expect(artifact.received.valueAUsd).toBeNull();
    expect(artifact.received.targetAPercent).toBeNull();
  });

  it("refuses a partial input without inventing the rest", async () => {
    const body = await json(
      await send(
        messageSend([
          { kind: "data", data: { input: { valueAUsd: 1000 } } },
          { kind: "text", text: "rebalance my portfolio" },
        ]),
      ),
    );
    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("input-required");
    const artifact = ((task.artifacts as { parts: { data: unknown }[] }[])[0].parts[0].data) as {
      missing: string[];
      received: Record<string, unknown>;
    };
    expect(artifact.missing).toEqual(expect.arrayContaining(["valueBUsd", "targetAPercent"]));
    expect(artifact.received.valueAUsd).toBe(1000);
    expect(artifact.received.valueBUsd).toBeNull();
  });

  it("refuses two zero holdings and an out of range target", async () => {
    const zero = await json(
      await send(
        messageSend([
          {
            kind: "data",
            data: { input: { valueAUsd: 0, valueBUsd: 0, targetAPercent: 50 } },
          },
          { kind: "text", text: "rebalance my portfolio" },
        ]),
      ),
    );
    const zeroArtifact = (
      ((zero.result as Record<string, unknown>).task as Record<string, unknown>)
        .artifacts as { parts: { data: { status: string; problems: string[] } }[] }[]
    )[0].parts[0].data;
    expect(zeroArtifact.status).toBe("input-required");
    expect(zeroArtifact.problems).toContain(
      "at least one of valueAUsd and valueBUsd must be greater than zero",
    );

    const range = await json(
      await send(
        messageSend([
          {
            kind: "data",
            data: { input: { valueAUsd: 700, valueBUsd: 300, targetAPercent: 150 } },
          },
          { kind: "text", text: "rebalance my portfolio" },
        ]),
      ),
    );
    const rangeArtifact = (
      ((range.result as Record<string, unknown>).task as Record<string, unknown>)
        .artifacts as { parts: { data: { status: string; problems: string[] } }[] }[]
    )[0].parts[0].data;
    expect(rangeArtifact.status).toBe("input-required");
    expect(rangeArtifact.problems).toContain("targetAPercent must be a number from 0 to 100");
  });

  it("answers the benign capability probe rather than erroring", async () => {
    const res = await send(messageSend([{ kind: "text", text: "report your status in one sentence" }]));
    expect(res.status).toBe(200);
    const body = await json(res);
    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("completed");

    const text = (status.message as { parts: { text: string }[] }).parts[0].text;
    expect(text).toContain("Souk Drift Guard");
    const artifact = (
      (task.artifacts as { parts: { data: { action: string; required: string[] } }[] }[])[0].parts[0]
    ).data;
    expect(artifact.action).toBe("plan_rebalance");
    expect(artifact.required).toEqual(
      expect.arrayContaining(["valueAUsd", "valueBUsd", "targetAPercent"]),
    );
  });

  it("treats an empty text part as the capability probe, not a refusal", async () => {
    const body = await json(await send(messageSend([{ kind: "text", text: "" }])));
    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("completed");
    const text = (status.message as { parts: { text: string }[] }).parts[0].text;
    expect(text).toContain("Souk Drift Guard");
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
          { kind: "text", text: "plan a rebalance for valueA 700 and valueB 300 at target 50" },
          {
            kind: "data",
            data: { input: { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50 } },
          },
        ]),
      ),
    );
    const extracted = extractA2aDeliverable(body.result) as Extracted;
    expect(extracted.found).toBe(true);
    expect(extracted.text).toContain("A rebalance is needed");
    expect(extracted.text).toContain('"valueToMoveUsd": 200');
    expect(extracted.text).not.toContain("TASK_STATE");
    expect(extracted.text).not.toContain("artifacts");
  });

  it("parses the capability probe reply through the real extraction code", async () => {
    const body = await json(await send(messageSend([{ kind: "text", text: "report your status in one sentence" }])));
    const extracted = extractA2aDeliverable(body.result) as Extracted;
    expect(extracted.found).toBe(true);
    expect(extracted.text).toContain("Souk Drift Guard");
  });
});

function mcpRpc(body: unknown, raw?: string): Promise<Response> {
  return MCP_POST(
    new NextRequest("http://localhost/api/reference/rebalancing/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

function toolCall(name: string, args?: Record<string, unknown>, id: number | string = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args ?? {} } };
}

interface ToolContent {
  type: string;
  text: string;
}

interface ToolResult {
  content: ToolContent[];
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

function resultOf(body: Record<string, unknown>): ToolResult {
  return body.result as ToolResult;
}

describe("mcp initialize", () => {
  it("answers with the requested version, tool capability and server info", async () => {
    const res = await mcpRpc({
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
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = await json(res);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    const result = body.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect((result.serverInfo as Record<string, unknown>).name).toBe("souk-drift-guard");
    expect(String(result.instructions)).toContain("plan_rebalance");
  });

  it("falls back to a supported version when the client asks for an unknown one", async () => {
    const body = await json(
      await mcpRpc({
        jsonrpc: "2.0",
        id: "abc",
        method: "initialize",
        params: { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: {} },
      }),
    );
    expect((body.result as Record<string, unknown>).protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(body.id).toBe("abc");
  });

  it("accepts the initialized notification with no reply", async () => {
    const res = await mcpRpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });
});

describe("mcp tools/list", () => {
  it("names the rebalance tool with its real input schema", async () => {
    const body = await json(await mcpRpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    const tools = (body.result as Record<string, unknown>).tools as {
      name: string;
      title: string;
      description: string;
      inputSchema: {
        type: string;
        properties: Record<
          string,
          { type?: string; minimum?: number; maximum?: number; default?: number }
        >;
        required?: string[];
        additionalProperties?: boolean;
      };
      annotations?: { readOnlyHint?: boolean };
    }[];

    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.name).toBe("plan_rebalance");
    expect(tool.description.length).toBeGreaterThan(40);
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual([
      "symbolA",
      "symbolB",
      "targetAPercent",
      "thresholdPercent",
      "valueAUsd",
      "valueBUsd",
    ]);
    expect(tool.inputSchema.required).toEqual(
      expect.arrayContaining(["valueAUsd", "valueBUsd", "targetAPercent"]),
    );
    expect(tool.inputSchema.properties.valueAUsd.minimum).toBe(0);
    expect(tool.inputSchema.properties.valueBUsd.minimum).toBe(0);
    expect(tool.inputSchema.properties.targetAPercent.maximum).toBe(100);
    expect(tool.inputSchema.properties.thresholdPercent.maximum).toBe(100);
    expect(tool.inputSchema.properties.thresholdPercent.default).toBe(5);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});

describe("mcp tools/call", () => {
  it("plans a rebalance against a hand computed expectation", async () => {
    const body = await json(
      await mcpRpc(
        toolCall("plan_rebalance", {
          valueAUsd: 700,
          valueBUsd: 300,
          targetAPercent: 50,
          thresholdPercent: 5,
          symbolA: "BNB",
          symbolB: "USDT",
        }),
      ),
    );
    const result = resultOf(body);
    expect(result.isError).toBe(false);

    // hand computed: 700 / 1000 = 70%, drift +20 points, move 200 USD
    expect(result.content[0].text).toContain("A rebalance is needed");
    expect(result.content[0].text).toContain("Move 200 USD from BNB to USDT");

    const artifact = result.structuredContent as {
      formula: string;
      result: Record<string, number | string | boolean | null>;
    };
    expect(artifact.formula).toBe(
      "driftAPercent = (valueAUsd / (valueAUsd + valueBUsd)) * 100 - targetAPercent",
    );
    expect(artifact.result.state).toBe("rebalance");
    expect(artifact.result.driftAPercent).toBe(20);
    expect(artifact.result.valueToMoveUsd).toBe(200);
    expect(artifact.result.fromSymbol).toBe("BNB");
    expect(artifact.result.toSymbol).toBe("USDT");
    expect(artifact.result.valueToMoveUnits).toBeNull();
  });

  it("uses the default threshold when only the required values are supplied", async () => {
    const body = await json(
      await mcpRpc(toolCall("plan_rebalance", { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50 })),
    );
    const artifact = resultOf(body).structuredContent as {
      inputs: { thresholdPercent: number };
      result: { valueToMoveUsd: number };
    };
    expect(artifact.inputs.thresholdPercent).toBe(5);
    expect(artifact.result.valueToMoveUsd).toBe(200);
  });

  it("asks for a missing input rather than guessing it", async () => {
    const body = await json(await mcpRpc(toolCall("plan_rebalance", { valueAUsd: 1000 })));
    const result = resultOf(body);
    expect(result.content[0].text).toContain("will not guess");
    expect(result.content[0].text).toContain("valueBUsd");
    expect(result.content[0].text).toContain("targetAPercent");

    const artifact = result.structuredContent as {
      status: string;
      missing: string[];
      received: Record<string, unknown>;
    };
    expect(artifact.status).toBe("input-required");
    expect(artifact.missing).toEqual(expect.arrayContaining(["valueBUsd", "targetAPercent"]));
    expect(artifact.received.valueAUsd).toBe(1000);
    expect(artifact.received.valueBUsd).toBeNull();
  });

  it("answers a plain probe with the capability reply rather than refusing", async () => {
    const body = await json(await mcpRpc(toolCall("plan_rebalance")));
    const result = resultOf(body);
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Souk Drift Guard");

    const artifact = result.structuredContent as { action: string; status: string; required: string[] };
    expect(artifact.action).toBe("plan_rebalance");
    expect(artifact.status).toBe("ok");
    expect(artifact.required).toEqual(
      expect.arrayContaining(["valueAUsd", "valueBUsd", "targetAPercent"]),
    );
  });

  it("returns exactly what decideReferenceTask computes, so neither surface forks the logic", async () => {
    const args = { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50, thresholdPercent: 5 };
    const body = await json(await mcpRpc(toolCall("plan_rebalance", args)));
    const result = resultOf(body);
    const direct = decideReferenceTask("", args);
    expect(result.content[0].text).toBe(direct.text);
    expect(result.structuredContent).toEqual(direct.artifact);
  });

  it("gives the A2A surface and the MCP surface the same artifact for the same values", async () => {
    const args = { valueAUsd: 700, valueBUsd: 300, targetAPercent: 50, thresholdPercent: 5 };
    const a2a = await json(
      await send(messageSend([{ kind: "data", data: { input: args } }])),
    );
    const a2aArtifact = (
      ((a2a.result as Record<string, unknown>).task as Record<string, unknown>).artifacts as {
        parts: { data: unknown }[];
      }[]
    )[0].parts[0].data;

    const mcp = await json(await mcpRpc(toolCall("plan_rebalance", args)));
    expect(resultOf(mcp).structuredContent).toEqual(a2aArtifact);
  });
});

describe("mcp marketplace extraction", () => {
  it("parses a computed reply through the marketplace's own extraction code", async () => {
    const body = await json(
      await mcpRpc(
        toolCall("plan_rebalance", {
          valueAUsd: 700,
          valueBUsd: 300,
          targetAPercent: 50,
          thresholdPercent: 5,
        }),
      ),
    );
    const result = body.result;

    // deliverMcp joins the content text parts; the test mirrors that join and
    // also runs the quality grader's parser, so the reply is readable by the
    // marketplace and not only by this endpoint.
    const mirrored = resultOf(body)
      .content.map((c) => c.text)
      .filter(Boolean)
      .join("\n");
    expect(mirrored).toContain("A rebalance is needed");
    expect(mirrored).toContain('"valueToMoveUsd": 200');

    const parsed = parseA2A(result);
    expect(parsed.parts).toBe(2);
    expect(parsed.text).toContain("A rebalance is needed");
    expect(scoreDelivery(result).grade).toBe("good");
  });
});

describe("mcp JSON-RPC error paths", () => {
  it("reports an unknown method as method not found", async () => {
    const res = await mcpRpc({ jsonrpc: "2.0", id: 5, method: "does/not/exist" });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.id).toBe(5);
    expect((body.error as { code: number }).code).toBe(-32601);
    expect(body.result).toBeUndefined();
  });

  it("reports an unknown tool as invalid params", async () => {
    const body = await json(
      await mcpRpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "no_such_tool", arguments: {} } }),
    );
    expect((body.error as { code: number }).code).toBe(-32602);
    expect(String((body.error as { message: string }).message)).toMatch(/unknown tool/i);
    expect(body.result).toBeUndefined();
  });

  it("rejects a tools/call without a tool name", async () => {
    const body = await json(
      await mcpRpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { arguments: {} } }),
    );
    expect((body.error as { code: number }).code).toBe(-32602);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await mcpRpc(undefined, "{ this is not json");
    expect(res.status).toBe(400);
    const body = await json(res);
    expect((body.error as { code: number }).code).toBe(-32700);
    expect(body.id).toBeNull();
  });

  it("rejects a request whose jsonrpc version is not 2.0", async () => {
    const res = await mcpRpc({ jsonrpc: "1.0", id: 9, method: "tools/list" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatchObject({ code: -32600 });
  });
});

describe("marketplace classification", () => {
  it("files the agent under rebalancing rather than general", () => {
    // the indexer classifies on the name, description and trust models
    const text = [
      REFERENCE_AGENT_NAME,
      REFERENCE_AGENT_DESCRIPTION,
      referenceAgentCard(REFERENCE_AGENT_PUBLIC_ORIGIN).skills[0].tags.join(" "),
    ].join(" ");
    const classification = classifyAgent(text);
    expect(classification.category).toBe("rebalancing");
    expect(classification.scores.rebalancing ?? 0).toBeGreaterThanOrEqual(2);
  });
});
