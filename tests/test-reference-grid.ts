// The first party grid-trading reference agent: the card must advertise a public
// messaging url, both surfaces must answer with the same deterministic grid
// arithmetic from one decision function, and a missing or contradictory value is
// asked for rather than guessed.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GRID_AGENT_DESCRIPTION,
  GRID_AGENT_MESSAGING_PATH,
  GRID_AGENT_NAME,
  GRID_AGENT_PROTOCOL_VERSION,
  GRID_AGENT_PUBLIC_ORIGIN,
  GRID_AGENT_VERSION,
  decideGridAgentTask,
  gridAgentCard,
  gridAgentMessagingUrl,
  pickGridOrigin,
} from "../src/lib/reference-grid";
import { privateEndpointReason } from "../src/lib/endpoint";
import { MCP_PROTOCOL_VERSION } from "../src/lib/mcp-tools";
import { parseA2A, scoreDelivery } from "../src/lib/quality";

// delivery.ts carries the server-only marker, which throws outside a server bundle
vi.mock("server-only", () => ({}));

import { extractA2aDeliverable } from "../src/lib/delivery";
import { POST as a2aPost } from "../src/app/api/reference/grid/a2a/route";
import { POST as mcpPost } from "../src/app/api/reference/grid/mcp/route";

function send(body: unknown, raw?: string): Promise<Response> {
  return a2aPost(
    new NextRequest("http://localhost/api/reference/grid/a2a", {
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

function rpc(body: unknown, raw?: string): Promise<Response> {
  return mcpPost(
    new NextRequest("http://localhost/api/reference/grid/mcp", {
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

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

interface Extracted {
  text: string;
  found: boolean;
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

function a2aArtifact(body: Record<string, unknown>): Record<string, unknown> {
  const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
  const artifacts = task.artifacts as { parts: { data: Record<string, unknown> }[] }[];
  return artifacts[0].parts[0].data;
}

// example A: (2000 - 1000) / 10 = 100 spacing, 100 / 1000 = 0.1 quantity,
// 100 * 0.1 = 10 gross, 100 * 10 / 10000 = 0.1 fee, 9.9 net, 10 round trips,
// 9.9 * 10 = 99 total net
const EXAMPLE_A = { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100, feeBps: 10 };

describe("agent card", () => {
  it("names the first party grid agent and advertises a public messaging url", () => {
    const card = gridAgentCard(GRID_AGENT_PUBLIC_ORIGIN);
    expect(card.name).toBe(GRID_AGENT_NAME);
    expect(card.name).toBe("Souk Grid Planner");
    expect(card.version).toBe(GRID_AGENT_VERSION);
    expect(card.description).toBe(GRID_AGENT_DESCRIPTION);
    expect(card.description).toContain("grid");
    expect(card.description).toContain("trading");
    expect(card.protocolVersion).toBe(GRID_AGENT_PROTOCOL_VERSION);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe("plan_grid");
    expect(card.skills[0].tags).toContain("grid-trading");

    const messagingUrl = gridAgentMessagingUrl(GRID_AGENT_PUBLIC_ORIGIN);
    expect(messagingUrl).toBe(`${GRID_AGENT_PUBLIC_ORIGIN}${GRID_AGENT_MESSAGING_PATH}`);
    expect(card.url).toBe(messagingUrl);
    expect(card.provider.organization).toBe("Agent Souk");
    expect(card.supportedInterfaces[0]).toEqual({ url: messagingUrl, transport: "JSONRPC" });
  });

  it("never advertises a private address, even when one is configured first", () => {
    const origin = pickGridOrigin(["http://localhost:3000", "https://api.agentsouk.xyz"]);
    expect(privateEndpointReason(origin)).toBeNull();
    expect(privateEndpointReason(gridAgentMessagingUrl(origin))).toBeNull();
    expect(gridAgentMessagingUrl(origin)).toBe(
      "https://api.agentsouk.xyz/api/reference/grid/a2a",
    );
  });
});

describe("message/send", () => {
  it("plans the grid from a text part and a structured data part", async () => {
    const res = await send(
      messageSend([
        { kind: "text", text: "Plan me a grid trading ladder" },
        { kind: "data", data: { input: EXAMPLE_A } },
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
    expect(textPart.text).toContain("Grid plan for a range of 1000 USD to 2000 USD");
    expect(textPart.text).toContain("Spacing is 100 USD");
    expect(textPart.text).toContain("committing 1100 USD");
    expect(textPart.text).toContain("net capture is 9.9 USD");
    expect(textPart.text).toContain("total net capture of 99 USD");
    expect(textPart.text).toContain("planned");

    const data = a2aArtifact(body) as {
      capability: string;
      action: string;
      formula: string;
      result: Record<string, number | string>;
    };
    expect(data.capability).toBe("grid-trading");
    expect(data.action).toBe("plan_grid");
    expect(data.formula).toContain("spacingUsd = (upperUsd - lowerUsd) / (levels - 1)");
    expect(data.result.spacingUsd).toBe(100);
    expect(data.result.firstRungUsd).toBe(1000);
    expect(data.result.lastRungUsd).toBe(2000);
    expect(data.result.rungCount).toBe(11);
    expect(data.result.committedUsd).toBe(1100);
    expect(data.result.quantityAtFirstRung).toBe(0.1);
    expect(data.result.grossCaptureUsd).toBe(10);
    expect(data.result.feeCostUsd).toBe(0.1);
    expect(data.result.netCaptureUsd).toBe(9.9);
    expect(data.result.roundTripsInFullTraversal).toBe(10);
    expect(data.result.totalNetCaptureUsd).toBe(99);
    expect(data.result.state).toBe("planned");
  });

  it("defaults the fee to zero when only the four required values are supplied", async () => {
    const body = await json(
      await send(
        messageSend([
          {
            kind: "data",
            data: { input: { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100 } },
          },
        ]),
      ),
    );
    const data = a2aArtifact(body) as {
      inputs: { feeBps: number };
      result: { feeCostUsd: number; netCaptureUsd: number; state: string };
    };
    expect(data.inputs.feeBps).toBe(0);
    expect(data.result.feeCostUsd).toBe(0);
    expect(data.result.netCaptureUsd).toBe(10);
    expect(data.result.state).toBe("planned");
  });

  it("reads labelled values from plain text alone", async () => {
    const body = await json(
      await send(
        messageSend([
          {
            kind: "text",
            text: "plan a grid lower 1000 upper 2000 levels 11 order size 100 fee bps 10",
          },
        ]),
      ),
    );
    const data = a2aArtifact(body) as { result: { netCaptureUsd: number; state: string } };
    expect(data.result.netCaptureUsd).toBe(9.9);
    expect(data.result.state).toBe("planned");
  });

  it("marks the plan fee-dominated when fees consume the gross capture", async () => {
    // example B: spacing (1010 - 1000) / 10 = 1, quantity 0.1, gross 0.1,
    // fee 100 * 100 / 10000 = 1, net -0.9, total 10 * -0.9 = -9
    const body = await json(
      await send(
        messageSend([
          {
            kind: "data",
            data: {
              input: { lowerUsd: 1000, upperUsd: 1010, levels: 11, orderSizeUsd: 100, feeBps: 100 },
            },
          },
        ]),
      ),
    );
    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("completed");
    const text = (status.message as { parts: { text: string }[] }).parts[0].text;
    expect(text).toContain("fee-dominated");

    const data = a2aArtifact(body) as {
      result: { grossCaptureUsd: number; feeCostUsd: number; netCaptureUsd: number; totalNetCaptureUsd: number; state: string };
    };
    expect(data.result.grossCaptureUsd).toBe(0.1);
    expect(data.result.feeCostUsd).toBe(1);
    expect(data.result.netCaptureUsd).toBe(-0.9);
    expect(data.result.totalNetCaptureUsd).toBe(-9);
    expect(data.result.state).toBe("fee-dominated");
  });

  it("asks for a missing value instead of guessing it", async () => {
    const res = await send(messageSend([{ kind: "text", text: "plan a grid for me" }]));
    const body = await json(res);
    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("input-required");

    const text = (status.message as { parts: { text: string }[] }).parts[0].text;
    expect(text).toContain("will not guess");
    expect(text).toContain("lowerUsd");
    expect(text).toContain("upperUsd");
    expect(text).toContain("levels");
    expect(text).toContain("orderSizeUsd");

    const artifact = a2aArtifact(body) as {
      status: string;
      missing: string[];
      problems: string[];
      received: Record<string, unknown>;
    };
    expect(artifact.status).toBe("input-required");
    expect(artifact.missing).toEqual(
      expect.arrayContaining(["lowerUsd", "upperUsd", "levels", "orderSizeUsd"]),
    );
    expect(artifact.problems).toEqual([]);
    expect(artifact.received.lowerUsd).toBeNull();
    expect(artifact.received.orderSizeUsd).toBeNull();
  });

  it("refuses an upper that is not above the lower and names the bad range", async () => {
    const res = await send(
      messageSend([
        {
          kind: "data",
          data: { input: { lowerUsd: 2000, upperUsd: 1000, levels: 11, orderSizeUsd: 100 } },
        },
      ]),
    );
    const body = await json(res);
    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("input-required");

    const text = (status.message as { parts: { text: string }[] }).parts[0].text;
    expect(text).toContain("Fix: upperUsd must be strictly greater than lowerUsd.");

    const artifact = a2aArtifact(body) as {
      status: string;
      missing: string[];
      problems: string[];
      received: Record<string, unknown>;
    };
    expect(artifact.status).toBe("input-required");
    expect(artifact.problems).toEqual(["upperUsd must be strictly greater than lowerUsd"]);
    expect(artifact.missing).toEqual([]);
    expect(artifact.received.lowerUsd).toBe(2000);
    expect(artifact.received.upperUsd).toBe(1000);
  });

  it("refuses a rung count outside two to two hundred", async () => {
    const body = await json(
      await send(
        messageSend([
          {
            kind: "data",
            data: { input: { lowerUsd: 1000, upperUsd: 2000, levels: 1, orderSizeUsd: 100 } },
          },
        ]),
      ),
    );
    const artifact = a2aArtifact(body) as { problems: string[] };
    expect(artifact.problems).toContain("levels must be an integer from 2 to 200");
  });

  it("answers the empty capability probe rather than refusing", async () => {
    const res = await send(messageSend([{ kind: "text", text: "report your status in one sentence" }]));
    expect(res.status).toBe(200);
    const body = await json(res);
    const task = (body.result as Record<string, unknown>).task as Record<string, unknown>;
    const status = task.status as Record<string, unknown>;
    expect(status.state).toBe("completed");

    const text = (status.message as { parts: { text: string }[] }).parts[0].text;
    expect(text).toContain("Souk Grid Planner");
    expect(text).toContain("plan_grid");
    const artifact = a2aArtifact(body) as { action: string; required: string[]; status: string };
    expect(artifact.action).toBe("plan_grid");
    expect(artifact.status).toBe("ok");
    expect(artifact.required).toEqual(
      expect.arrayContaining(["lowerUsd", "upperUsd", "levels", "orderSizeUsd"]),
    );
  });
});

describe("A2A malformed requests", () => {
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
    const body = await json(res);
    expect(body.id).toBe(7);
    expect((body.error as { code: number }).code).toBe(-32601);
  });

  it("rejects message/send without any parts", async () => {
    const body = await json(await send({ jsonrpc: "2.0", id: 8, method: "message/send", params: {} }));
    expect((body.error as { code: number }).code).toBe(-32602);
  });

  it("rejects a request whose jsonrpc version is not 2.0", async () => {
    const res = await send({ jsonrpc: "1.0", id: 9, method: "message/send", params: {} });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatchObject({ code: -32600 });
  });
});

describe("marketplace extraction", () => {
  it("parses a computed A2A reply through the real extraction code", async () => {
    const body = await json(
      await send(
        messageSend(
          [{ kind: "data", data: { input: EXAMPLE_A } }],
        ),
      ),
    );
    const extracted = extractA2aDeliverable(body.result) as Extracted;
    expect(extracted.found).toBe(true);
    expect(extracted.text).toContain("Grid plan for a range of 1000 USD to 2000 USD");
    expect(extracted.text).toContain('"netCaptureUsd": 9.9');
    expect(extracted.text).not.toContain("TASK_STATE");
  });
});

describe("MCP initialize and tools/list", () => {
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
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    const result = (await json(res)).result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect((result.serverInfo as Record<string, unknown>).name).toBe("souk-grid-planner");
    expect(String(result.instructions)).toContain("plan_grid");
  });

  it("names the plan_grid tool with its real input schema", async () => {
    const body = await json(await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    const tools = (body.result as Record<string, unknown>).tools as {
      name: string;
      description: string;
      inputSchema: {
        type: string;
        properties: Record<
          string,
          { type?: string; minimum?: number; maximum?: number; exclusiveMinimum?: number }
        >;
        required?: string[];
        additionalProperties?: boolean;
      };
      annotations?: { readOnlyHint?: boolean };
    }[];

    // two tools now: the planner, and the bounded fill for one rung. The fill is not
    // read-only, so it is declared as such and takes a hire before it will answer.
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["fill_rung", "plan_grid"]);

    const plan = tools.find((t) => t.name === "plan_grid");
    const fill = tools.find((t) => t.name === "fill_rung");
    expect(fill).toBeDefined();
    // the planner still reads nothing, and the fill declares that it does not
    expect(plan?.annotations?.readOnlyHint).toBe(true);
    expect(fill?.annotations?.readOnlyHint).toBe(false);
    // and the fill says which authority it needs, in the schema rather than only in prose
    expect(Object.keys(fill?.inputSchema.properties ?? {}).sort()).toEqual([
      "baseToken",
      "feeBps",
      "maxSlippageBps",
      "orderSizeUsd",
      "paymentId",
      "quoteToken",
      "rungUsd",
      "side",
    ]);
    expect(fill?.inputSchema.required).toContain("paymentId");

    const tool = tools[0];
    expect(tool.name).toBe("plan_grid");
    expect(tool.description.length).toBeGreaterThan(40);
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual([
      "feeBps",
      "feeTier",
      "levels",
      "lowerUsd",
      "orderSizeUsd",
      "pair",
      "upperUsd",
      "widthPct",
    ]);
    // the range is two prices or a pair and a width, so only these two are always required
    expect(tool.inputSchema.required).toEqual(["levels", "orderSizeUsd"]);
    expect(tool.inputSchema.properties.lowerUsd.exclusiveMinimum).toBe(0);
    expect(tool.inputSchema.properties.upperUsd.exclusiveMinimum).toBe(0);
    expect(tool.inputSchema.properties.orderSizeUsd.exclusiveMinimum).toBe(0);
    expect(tool.inputSchema.properties.levels.type).toBe("integer");
    expect(tool.inputSchema.properties.levels.minimum).toBe(2);
    expect(tool.inputSchema.properties.levels.maximum).toBe(200);
    expect(tool.inputSchema.properties.feeBps.maximum).toBe(10000);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});

describe("MCP tools/call", () => {
  it("plans the grid against a hand computed expectation", async () => {
    const body = await json(await rpc(toolCall("plan_grid", EXAMPLE_A)));
    const result = resultOf(body);
    expect(result.isError).toBe(false);

    expect(result.content[0].text).toContain("Spacing is 100 USD");
    expect(result.content[0].text).toContain("net capture is 9.9 USD");

    const artifact = result.structuredContent as {
      action: string;
      result: Record<string, number | string>;
    };
    expect(artifact.action).toBe("plan_grid");
    expect(artifact.result.spacingUsd).toBe(100);
    expect(artifact.result.committedUsd).toBe(1100);
    expect(artifact.result.grossCaptureUsd).toBe(10);
    expect(artifact.result.feeCostUsd).toBe(0.1);
    expect(artifact.result.netCaptureUsd).toBe(9.9);
    expect(artifact.result.roundTripsInFullTraversal).toBe(10);
    expect(artifact.result.totalNetCaptureUsd).toBe(99);
    expect(artifact.result.state).toBe("planned");
  });

  it("defaults the fee to zero when it is omitted", async () => {
    const body = await json(
      await rpc(
        toolCall("plan_grid", {
          lowerUsd: 1000,
          upperUsd: 2000,
          levels: 11,
          orderSizeUsd: 100,
        }),
      ),
    );
    const artifact = resultOf(body).structuredContent as {
      inputs: { feeBps: number };
      result: { feeCostUsd: number; netCaptureUsd: number };
    };
    expect(artifact.inputs.feeBps).toBe(0);
    expect(artifact.result.feeCostUsd).toBe(0);
    expect(artifact.result.netCaptureUsd).toBe(10);
  });

  it("asks for a missing input rather than guessing it", async () => {
    const body = await json(await rpc(toolCall("plan_grid", { lowerUsd: 1000 })));
    const result = resultOf(body);
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("will not guess");
    expect(result.content[0].text).toContain("upperUsd");

    const artifact = result.structuredContent as {
      status: string;
      missing: string[];
      received: Record<string, unknown>;
    };
    expect(artifact.status).toBe("input-required");
    expect(artifact.missing).toContain("upperUsd");
    expect(artifact.received.lowerUsd).toBe(1000);
    expect(artifact.received.upperUsd).toBeNull();
  });

  it("refuses a bad range with the same wording the A2A surface uses", async () => {
    const body = await json(
      await rpc(
        toolCall("plan_grid", {
          lowerUsd: 2000,
          upperUsd: 1000,
          levels: 11,
          orderSizeUsd: 100,
        }),
      ),
    );
    const result = resultOf(body);
    expect(result.content[0].text).toContain(
      "Fix: upperUsd must be strictly greater than lowerUsd.",
    );
    const artifact = result.structuredContent as { problems: string[]; missing: string[] };
    expect(artifact.problems).toEqual(["upperUsd must be strictly greater than lowerUsd"]);
    expect(artifact.missing).toEqual([]);
  });

  it("answers a plain probe with the capability reply rather than refusing", async () => {
    const body = await json(await rpc(toolCall("plan_grid")));
    const result = resultOf(body);
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Souk Grid Planner");

    const artifact = result.structuredContent as { action: string; status: string; required: string[] };
    expect(artifact.action).toBe("plan_grid");
    expect(artifact.status).toBe("ok");
    expect(artifact.required).toEqual(
      expect.arrayContaining(["lowerUsd", "upperUsd", "levels", "orderSizeUsd"]),
    );
  });

  it("returns exactly what decideGridAgentTask computes, so neither surface forks the logic", async () => {
    const body = await json(await rpc(toolCall("plan_grid", EXAMPLE_A)));
    const result = resultOf(body);
    const direct = decideGridAgentTask("", EXAMPLE_A);
    expect(result.content[0].text).toBe(direct.text);
    expect(result.structuredContent).toEqual(direct.artifact);
  });

  it("gives the same artifact over A2A and MCP for the same values", async () => {
    const a2aBody = await json(
      await send(messageSend([{ kind: "data", data: { input: EXAMPLE_A } }])),
    );
    const mcpBody = await json(await rpc(toolCall("plan_grid", EXAMPLE_A)));
    expect(a2aArtifact(a2aBody)).toEqual(resultOf(mcpBody).structuredContent);
    const a2aText = (((a2aBody.result as Record<string, unknown>).task as Record<string, unknown>)
      .status as { message: { parts: { text: string }[] } }).message.parts[0].text;
    expect(a2aText).toBe(resultOf(mcpBody).content[0].text);
  });
});

describe("MCP marketplace extraction", () => {
  it("parses a computed reply through the marketplace's own extraction code", async () => {
    const body = await json(await rpc(toolCall("plan_grid", EXAMPLE_A)));
    const result = body.result;

    // deliverMcp joins the content text parts; the test mirrors that join and
    // also runs the quality grader's parser, so the reply is readable by the
    // marketplace and not only by this endpoint.
    const mirrored = resultOf(body)
      .content.map((c) => c.text)
      .filter(Boolean)
      .join("\n");
    expect(mirrored).toContain("Grid plan for a range of 1000 USD to 2000 USD");
    expect(mirrored).toContain('"netCaptureUsd": 9.9');

    const parsed = parseA2A(result);
    expect(parsed.parts).toBe(2);
    expect(parsed.text).toContain("Grid plan for a range of 1000 USD to 2000 USD");
    expect(scoreDelivery(result).grade).toBe("good");
  });
});

describe("MCP JSON-RPC error paths", () => {
  it("reports an unknown method as method not found", async () => {
    const body = await json(await rpc({ jsonrpc: "2.0", id: 5, method: "does/not/exist" }));
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
    const res = await rpc(undefined, "{ this is not json");
    expect(res.status).toBe(400);
    const body = await json(res);
    expect((body.error as { code: number }).code).toBe(-32700);
    expect(body.id).toBeNull();
  });

  it("accepts the initialized notification with no reply", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });
});
