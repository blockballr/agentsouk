// The in-page WebMCP surface: its feature check, its mirror of the server tool
// descriptors, and the one-registration rule. The tool bodies call the public API
// through api.ts, so only the pure parts are exercised here and nothing touches
// the network.
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "../src/lib/mcp-tools";
import {
  WEBMCP_TOOLS,
  registerWebMcpTools,
  type WebMcpModelContextLike,
  type WebMcpTool,
} from "../apps/web/src/lib/webmcp";

describe("feature check", () => {
  it("does nothing when the browser has no model context", () => {
    // This suite runs in node: there is no document.modelContext, and the node
    // navigator carries no modelContext either. The call must be a quiet no-op.
    expect(registerWebMcpTools()).toBe(false);
    expect(registerWebMcpTools(null)).toBe(false);
  });
});

describe("the tool surface mirrors the MCP server", () => {
  it("carries the same names, in the same order", () => {
    expect(WEBMCP_TOOLS.map((tool) => tool.name)).toEqual(MCP_TOOLS.map((tool) => tool.name));
  });

  it("matches each tool's title, description, schema and annotations", () => {
    const withoutExecute = WEBMCP_TOOLS.map((tool) => {
      const clone: Record<string, unknown> = { ...tool };
      delete clone.execute;
      return clone;
    });
    expect(withoutExecute).toEqual(MCP_TOOLS);
  });

  it("gives every tool an execute function", () => {
    for (const tool of WEBMCP_TOOLS) {
      expect(typeof tool.execute).toBe("function");
    }
  });
});

describe("registration is idempotent", () => {
  it("registers each tool once and skips a remount", () => {
    const calls: string[] = [];
    const context: WebMcpModelContextLike = {
      registerTool(tool: WebMcpTool) {
        calls.push(tool.name);
        return Promise.resolve();
      },
    };

    expect(registerWebMcpTools(context)).toBe(true);
    expect(registerWebMcpTools(context)).toBe(false);
    expect(calls).toEqual(WEBMCP_TOOLS.map((tool) => tool.name));
    expect(new Set(calls).size).toBe(WEBMCP_TOOLS.length);
  });

  it("treats a distinct context as its own registration", () => {
    const first = { registerTool: () => Promise.resolve() };
    const second = { registerTool: () => Promise.resolve() };
    expect(registerWebMcpTools(first)).toBe(true);
    expect(registerWebMcpTools(second)).toBe(true);
  });
});

describe("a visitor's signature cannot be invented", () => {
  it("refuses start_hire without a signed payload and says why", async () => {
    const start = WEBMCP_TOOLS.find((tool) => tool.name === "start_hire");
    expect(start).toBeDefined();
    const result = await start!.execute({
      tokenId: "1",
      paymentRequirements: {},
      paymentPayload: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/cannot sign/i);
  });
});
