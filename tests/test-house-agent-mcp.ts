// The house agent's MCP surface: initialize, tools/list and tools/call must
// speak the same JSON-RPC our marketplace client does, the arithmetic must be
// the one decideHouseAgentTask already implements for the A2A surface, and a
// reply must survive the marketplace's own extraction code rather than only our
// own parsing.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { MCP_PROTOCOL_VERSION } from "../src/lib/mcp-tools";
import { decideHouseAgentTask } from "../src/lib/house-agent";
import { parseA2A, scoreDelivery } from "../src/lib/quality";
import { POST } from "../src/app/api/house-agent/mcp/route";

function rpc(body: unknown, raw?: string): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/house-agent/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
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

describe("initialize", () => {
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
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const body = await json(res);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    const result = body.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect((result.serverInfo as Record<string, unknown>).name).toBe("souk-health-guard");
    expect(String(result.instructions)).toContain("compute_health_factor");
  });

  it("falls back to a supported version when the client asks for an unknown one", async () => {
    const body = await json(
      await rpc({
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
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });
});

describe("tools/list", () => {
  it("names the health factor tool with its real input schema", async () => {
    const body = await json(await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    const tools = (body.result as Record<string, unknown>).tools as {
      name: string;
      title: string;
      description: string;
      inputSchema: {
        type: string;
        properties: Record<string, { type?: string; minimum?: number; maximum?: number; exclusiveMinimum?: number }>;
        required?: string[];
        additionalProperties?: boolean;
      };
      annotations?: { readOnlyHint?: boolean };
    }[];

    expect(tools).toHaveLength(1);
    const tool = tools[0];
    expect(tool.name).toBe("compute_health_factor");
    expect(tool.description.length).toBeGreaterThan(40);
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual([
      "collateral",
      "debt",
      "liquidationThreshold",
    ]);
    expect(tool.inputSchema.required).toEqual(
      expect.arrayContaining(["collateral", "debt"]),
    );
    expect(tool.inputSchema.properties.collateral.exclusiveMinimum).toBe(0);
    expect(tool.inputSchema.properties.debt.minimum).toBe(0);
    expect(tool.inputSchema.properties.liquidationThreshold.maximum).toBe(1);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
});

describe("tools/call", () => {
  it("computes the health factor against a hand computed expectation", async () => {
    const body = await json(
      await rpc(toolCall("compute_health_factor", { collateral: 1000, debt: 500, liquidationThreshold: 0.8 })),
    );
    const result = resultOf(body);
    expect(result.isError).toBe(false);

    // hand computed: (1000 * 0.8) / 500 = 1.6, capacity 800, distance 1 - 1/1.6 = 0.375
    expect(result.content[0].text).toContain("Health factor 1.6");
    expect(result.content[0].text).toContain("Liquidation capacity is 800 USD");
    expect(result.content[0].text).toContain("healthy");

    const artifact = result.structuredContent as {
      formula: string;
      result: Record<string, number | string | null>;
    };
    expect(artifact.formula).toBe("healthFactor = (collateral * liquidationThreshold) / debt");
    expect(artifact.result.healthFactor).toBe(1.6);
    expect(artifact.result.state).toBe("healthy");
    expect(artifact.result.liquidationCapacity).toBe(800);
    expect(artifact.result.maxDebtAtHealthFactorOne).toBe(800);
    expect(artifact.result.additionalDebtBeforeLiquidation).toBe(300);
    expect(artifact.result.liquidationDistance).toBe(0.375);
    expect(artifact.result.liquidationDistancePercent).toBe(37.5);
  });

  it("uses the default threshold when only collateral and debt are supplied", async () => {
    const body = await json(
      await rpc(toolCall("compute_health_factor", { collateral: 1000, debt: 500 })),
    );
    const artifact = resultOf(body).structuredContent as {
      inputs: { liquidationThreshold: number };
      result: { healthFactor: number };
    };
    // default 0.8, so the answer equals the explicit-threshold case
    expect(artifact.inputs.liquidationThreshold).toBe(0.8);
    expect(artifact.result.healthFactor).toBe(1.6);
  });

  it("asks for a missing input rather than guessing it", async () => {
    const body = await json(await rpc(toolCall("compute_health_factor", { collateral: 1000 })));
    const result = resultOf(body);
    expect(result.content[0].text).toContain("will not guess");
    expect(result.content[0].text).toContain("debt");

    const artifact = result.structuredContent as {
      status: string;
      missing: string[];
      received: Record<string, unknown>;
    };
    expect(artifact.status).toBe("input-required");
    expect(artifact.missing).toContain("debt");
    expect(artifact.received.collateral).toBe(1000);
    expect(artifact.received.debt).toBeNull();
  });

  it("answers a plain probe with the capability reply rather than refusing", async () => {
    const body = await json(await rpc(toolCall("compute_health_factor")));
    const result = resultOf(body);
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Souk Health Guard");

    const artifact = result.structuredContent as { action: string; status: string; required: string[] };
    expect(artifact.action).toBe("compute_health_factor");
    expect(artifact.status).toBe("ok");
    expect(artifact.required).toEqual(expect.arrayContaining(["collateral", "debt"]));
  });

  it("returns exactly what decideHouseAgentTask computes, so neither surface forks the logic", async () => {
    const args = { collateral: 1000, debt: 500, liquidationThreshold: 0.8 };
    const body = await json(await rpc(toolCall("compute_health_factor", args)));
    const result = resultOf(body);
    const direct = decideHouseAgentTask("", args);
    expect(result.content[0].text).toBe(direct.text);
    expect(result.structuredContent).toEqual(direct.artifact);
  });
});

describe("marketplace extraction", () => {
  it("parses a computed reply through the marketplace's own extraction code", async () => {
    const body = await json(
      await rpc(toolCall("compute_health_factor", { collateral: 1000, debt: 500, liquidationThreshold: 0.8 })),
    );
    const result = body.result;

    // deliverMcp joins the content text parts; the test mirrors that join and
    // also runs the quality grader's parser, so the reply is readable by the
    // marketplace and not only by this endpoint.
    const mirrored = resultOf(body)
      .content.map((c) => c.text)
      .filter(Boolean)
      .join("\n");
    expect(mirrored).toContain("Health factor 1.6");
    expect(mirrored).toContain('"healthFactor": 1.6');

    const parsed = parseA2A(result);
    expect(parsed.parts).toBe(2);
    expect(parsed.text).toContain("Health factor 1.6");
    expect(scoreDelivery(result).grade).toBe("good");
  });
});

describe("JSON-RPC error paths", () => {
  it("reports an unknown method as method not found", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 5, method: "does/not/exist" });
    expect(res.status).toBe(200);
    const body = await json(res);
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
    expect(body.result).toBeUndefined();
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

  it("rejects a request whose jsonrpc version is not 2.0", async () => {
    const res = await rpc({ jsonrpc: "1.0", id: 9, method: "tools/list" });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatchObject({ code: -32600 });
  });
});
