// An agent that answers over MCP publishes its skills as the tools its server
// lists, so the skill list is read from tools/list when no A2A card carries one.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { captureAgentSkills } from "@/lib/agent-interface";
import { fetchMcpSkills } from "@/lib/mcp-skills";

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

interface Step {
  status?: number;
  json?: unknown;
  raw?: string;
  contentType?: string;
  headers?: Record<string, string>;
}

type Route = (call: Call) => Step;

function stubFetch(route: Route) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const step = route(call);
    return new Response(step.raw ?? JSON.stringify(step.json ?? {}), {
      status: step.status ?? 200,
      headers: { "content-type": step.contentType ?? "application/json", ...(step.headers ?? {}) },
    });
  });
  vi.stubGlobal("fetch", impl);
  return { calls, impl };
}

function mcpRoute(tools: unknown[]): Route {
  return (call) => {
    const method = String(call.body.method ?? "");
    if (method === "initialize") {
      return { json: { jsonrpc: "2.0", id: call.body.id, result: {} }, headers: { "mcp-session-id": "s1" } };
    }
    if (method === "notifications/initialized") return { json: {} };
    if (method === "tools/list") {
      return { json: { jsonrpc: "2.0", id: call.body.id, result: { tools } } };
    }
    return { status: 404, json: { error: { code: -32601, message: `unknown method ${method}` } } };
  };
}

const MCP = "https://agent.example/mcp";
const CARD = "https://agent.example/.well-known/agent-card.json";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the skills an MCP server publishes", () => {
  it("lists its tools as skills, session first", async () => {
    const { calls } = stubFetch(
      mcpRoute([
        {
          name: "get_price",
          description: "The live price for a pair.",
          inputSchema: {
            type: "object",
            properties: { symbol: { type: "string", description: "The pair to price." } },
            required: ["symbol"],
          },
        },
      ]),
    );

    const skills = await fetchMcpSkills(MCP);

    expect(calls.map((c) => c.body.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(calls[0].headers["mcp-session-id"]).toBeUndefined();
    expect(calls[2].headers["mcp-session-id"]).toBe("s1");
    expect(skills).toEqual([
      {
        id: "get_price",
        name: "get_price",
        description: "The live price for a pair.",
        inputSchema: {
          type: "object",
          properties: { symbol: { type: "string", description: "The pair to price." } },
          required: ["symbol"],
        },
      },
    ]);
  });

  it("reads the answer out of a streamed response", async () => {
    stubFetch((call) =>
      String(call.body.method ?? "") === "tools/list"
        ? {
            contentType: "text/event-stream",
            raw: [
              "event: message",
              'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"compound","description":"Compounds the position."}]}}',
              "",
            ].join("\n"),
          }
        : { json: {} },
    );

    const skills = await fetchMcpSkills(MCP);

    expect(skills).toEqual([{ id: "compound", name: "compound", description: "Compounds the position." }]);
  });

  it("still lists the tools when initialize is refused", async () => {
    const { calls } = stubFetch((call) => {
      const method = String(call.body.method ?? "");
      if (method === "initialize") {
        return { json: { error: { code: -32601, message: "initialize unsupported" } } };
      }
      if (method === "tools/list") {
        return { json: { result: { tools: [{ name: "swap" }] } } };
      }
      return { status: 404, json: { error: { code: -32601, message: "unexpected" } } };
    });

    const skills = await fetchMcpSkills(MCP);

    expect(calls.map((c) => c.body.method)).toEqual(["initialize", "tools/list"]);
    expect(calls[1].headers["mcp-session-id"]).toBeUndefined();
    expect(skills).toEqual([{ id: "swap", name: "swap" }]);
  });

  it("narrows a schema to what the skill section can show", async () => {
    stubFetch(
      mcpRoute([
        {
          name: "rebalance",
          inputSchema: {
            properties: {
              target: { type: ["string", "null"], description: "The target allocation." },
              odd: "not a schema object",
            },
          },
        },
      ]),
    );

    const skills = await fetchMcpSkills(MCP);

    expect(skills?.[0]?.inputSchema).toEqual({
      type: "object",
      properties: { target: { type: "string | null", description: "The target allocation." } },
    });
  });

  it("answers nothing when the server lists no tools", async () => {
    stubFetch(mcpRoute([]));
    expect(await fetchMcpSkills(MCP)).toBeNull();
  });

  it("never calls a private endpoint", async () => {
    const { impl } = stubFetch(mcpRoute([{ name: "x" }]));
    expect(await fetchMcpSkills("http://localhost:3000/mcp")).toBeNull();
    expect(impl).not.toHaveBeenCalled();
  });
});

describe("capture reads the card first and the tools second", () => {
  it("takes the card's skills and leaves the MCP server alone", async () => {
    const { calls } = stubFetch((call) =>
      call.url === CARD
        ? { json: { skills: [{ id: "negotiate", name: "Negotiate an ERC-8183 job" }] } }
        : { status: 500, json: {} },
    );

    const skills = await captureAgentSkills({ a2a_endpoint: CARD, mcp_server: MCP });

    expect(skills).toEqual([{ id: "negotiate", name: "Negotiate an ERC-8183 job" }]);
    expect(calls.map((c) => c.url)).toEqual([CARD]);
  });

  it("falls to the tools when the card carries no skills", async () => {
    const { calls } = stubFetch((call) =>
      call.url === CARD ? { json: {} } : mcpRoute([{ name: "apy", description: "Reads the pool APY." }])(call),
    );

    const skills = await captureAgentSkills({ a2a_endpoint: CARD, mcp_server: MCP });

    expect(skills).toEqual([{ id: "apy", name: "apy", description: "Reads the pool APY." }]);
    expect(calls.map((c) => c.url)).toEqual([CARD, MCP, MCP, MCP]);
  });

  it("reads the tools for an agent with no card at all", async () => {
    stubFetch((call) => mcpRoute([{ name: "stake" }])(call));

    const skills = await captureAgentSkills({ a2a_endpoint: null, mcp_server: MCP });

    expect(skills).toEqual([{ id: "stake", name: "stake" }]);
  });

  it("answers nothing for an agent that publishes neither", async () => {
    const { impl } = stubFetch(() => ({ status: 500, json: {} }));
    expect(await captureAgentSkills({ a2a_endpoint: null, mcp_server: null })).toBeNull();
    expect(impl).not.toHaveBeenCalled();
  });
});
