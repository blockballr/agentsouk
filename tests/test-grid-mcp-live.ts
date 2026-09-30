// the grid agent's MCP tool takes the PancakeSwap pair mode too: a pair and a width stand
// in for the two prices, answered from the same live path as A2A, with the read stubbed
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.hoisted(() => {
  process.env.TARGET_CHAIN = "97";
});

vi.mock("server-only", () => ({}));

const read = vi.hoisted(() => ({
  readPancakePrice: vi.fn(async (chainId: number) => ({
    chainId,
    pair: "WBNB/USDT",
    pool: "0x2dbb5a4c235164b9f772179a43faca2c71a8abdb" as const,
    feeTier: 500,
    tick: -22913,
    liquidity: "900",
    price: 9.885669,
    blockNumber: 134_000_000,
  })),
}));
vi.mock("../src/lib/pancake-read", () => read);

import { POST } from "../src/app/api/reference/grid/mcp/route";

describe("grid agent MCP tool, PancakeSwap mode", () => {
  it("centres the plan on the pool price and names the pool it read", async () => {
    const res = await POST(
      new NextRequest("https://api.agentsouk.xyz/api/reference/grid/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "plan_grid", arguments: { pair: "WBNB/USDT", widthPct: 10, levels: 11, orderSizeUsd: 100 } },
        }),
      }),
    );
    const body = (await res.json()) as {
      result: { content: { text: string }[]; structuredContent: Record<string, unknown>; isError: boolean };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.content[0].text).toContain("pool 0x2dbb5a4c235164b9f772179a43faca2c71a8abdb at block 134000000 on BSC testnet");
    expect(body.result.structuredContent.source).toMatchObject({ dex: "PancakeSwap v3", chainId: 97 });
    expect(read.readPancakePrice).toHaveBeenCalledWith(97, "WBNB", "USDT", expect.anything());
  });

  it("plans the caller's own range when a pair comes with it, and says the pair was not read", async () => {
    read.readPancakePrice.mockClear();
    const res = await POST(
      new NextRequest("https://api.agentsouk.xyz/api/reference/grid/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: { name: "plan_grid", arguments: { pair: "WBNB/USDT", lowerUsd: 500, upperUsd: 700, levels: 11, orderSizeUsd: 100 } },
        }),
      }),
    );
    const body = (await res.json()) as { result: { content: { text: string }[]; structuredContent: Record<string, unknown> } };
    expect(body.result.content[0].text).toContain("The pair was not read on PancakeSwap");
    expect(body.result.structuredContent.pairNote).toBeDefined();
    expect(body.result.structuredContent).not.toHaveProperty("source");
    expect(read.readPancakePrice).not.toHaveBeenCalled();
  });
});
