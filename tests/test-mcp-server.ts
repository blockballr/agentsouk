// The MCP server surface: initialize, tools/list, and the JSON-RPC error paths.
// Each tool is backed by a public API route, so these tests exercise the
// protocol only and never reach the network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MCP_PROTOCOL_VERSION, MCP_TOOLS } from "../src/lib/mcp-tools";
import { DELETE, GET, OPTIONS, POST } from "../src/app/api/mcp/route";

function rpc(body: unknown, raw?: string): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/mcp", {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initialize", () => {
  it("answers with the requested protocol version, tool capability and server info", async () => {
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
    expect((result.serverInfo as Record<string, unknown>).name).toBeTruthy();
    expect(typeof result.instructions).toBe("string");
  });

  it("falls back to a supported version when the client asks for an unknown one", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: "abc",
      method: "initialize",
      params: { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: {} },
    });
    const body = await json(res);
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
  it("names every tool with a description and a JSON schema", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(res.status).toBe(200);
    const body = await json(res);
    const tools = (body.result as Record<string, unknown>).tools as {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }[];

    expect(tools.map((t) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.inputSchema.properties).toBe("object");
    }
  });

  it("exposes the six person-equivalent actions", async () => {
    const body = await json(await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }));
    const names = ((body.result as Record<string, unknown>).tools as { name: string }[]).map(
      (t) => t.name,
    );
    for (const expected of [
      "list_agents",
      "get_agent",
      "list_categories",
      "list_hires",
      "get_task",
      "start_hire",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("requires a signed authorization for a hire and never a private key", async () => {
    const body = await json(await rpc({ jsonrpc: "2.0", id: 4, method: "tools/list" }));
    const tools = (body.result as Record<string, unknown>).tools as {
      name: string;
      description: string;
      inputSchema: { required?: string[]; properties?: Record<string, unknown> };
    }[];
    const start = tools.find((t) => t.name === "start_hire");
    expect(start).toBeDefined();
    expect(start!.inputSchema.required).toEqual(
      expect.arrayContaining(["tokenId", "paymentRequirements", "paymentPayload"]),
    );
    const properties = Object.keys(start!.inputSchema.properties ?? {});
    expect(properties).not.toContain("privateKey");
    expect(properties.join(" ")).not.toMatch(/private|secret|mnemonic/i);
    expect(start!.description).toMatch(/EIP-3009/);
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
    const res = await rpc({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "no_such_tool", arguments: {} },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect((body.error as { code: number }).code).toBe(-32602);
    expect(String((body.error as { message: string }).message)).toMatch(/unknown tool/i);
    expect(body.result).toBeUndefined();
  });

  it("rejects a body that is not JSON", async () => {
    const res = await rpc(undefined, "{ this is not json");
    expect(res.status).toBe(400);
    const body = await json(res);
    expect((body.error as { code: number }).code).toBe(-32700);
    expect(body.id).toBeNull();
  });

  it("rejects a JSON request without a method", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 7 });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect((body.error as { code: number }).code).toBe(-32600);
  });

  it("rejects a tools/call without a tool name", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { arguments: {} },
    });
    expect((await json(res)).error).toMatchObject({ code: -32602 });
  });
});

describe("transport", () => {
  it("keeps the protocol surface off the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await rpc({ jsonrpc: "2.0", id: 9, method: "initialize", params: {} });
    await rpc({ jsonrpc: "2.0", id: 10, method: "tools/list" });
    await rpc({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "nope" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses GET and DELETE with an Allow header", () => {
    const get = GET();
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST, OPTIONS");
    expect(DELETE().status).toBe(405);
  });

  it("answers CORS preflight", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});
