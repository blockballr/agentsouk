// the grid agent's A2A route answers a PancakeSwap pair request end to end: the
// JSON-RPC envelope carries the centred plan and the pool it was read from, with the
// chain read replaced by a fixed mainnet quote
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const read = vi.hoisted(() => ({
  readPancakePrice: vi.fn(async (chainId: number) => ({
    chainId,
    pair: "WBNB/USDT",
    pool: "0x36696169c63e42cd08ce11f5deebbcebae652050" as const,
    feeTier: 500,
    tick: -66337,
    liquidity: "900",
    price: 759.985999,
    blockNumber: 63_000_000,
  })),
}));
vi.mock("../src/lib/pancake-read", () => read);

import { POST } from "../src/app/api/reference/grid/a2a/route";

function send(data: Record<string, unknown>) {
  return new NextRequest("https://api.agentsouk.xyz/api/reference/grid/a2a", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: { message: { role: "user", kind: "message", messageId: "m1", parts: [{ kind: "data", data }] } },
    }),
  });
}

describe("grid agent A2A route, PancakeSwap mode", () => {
  it("returns the centred plan and names the mainnet pool it read", async () => {
    const res = await POST(send({ input: { pair: "WBNB/USDT", widthPct: 10, levels: 11, orderSizeUsd: 100 } }));
    const body = (await res.json()) as {
      result: { task: { status: { state: string; message: { parts: { text: string }[] } }; artifacts: { parts: { data: Record<string, unknown> }[] }[] } };
    };
    const task = body.result.task;
    expect(task.status.state).toBe("completed");
    expect(task.status.message.parts[0].text).toContain("read from the 0.05% pool 0x36696169c63e42cd08ce11f5deebbcebae652050 at block 63000000 on BNB Chain mainnet");
    const artifact = task.artifacts[0].parts[0].data;
    expect(artifact.source).toMatchObject({ dex: "PancakeSwap v3", chainId: 56, feeTier: 500 });
    expect((artifact.inputs as Record<string, number>).lowerUsd).toBeCloseTo(759.985999 * 0.95, 4);
    expect(read.readPancakePrice).toHaveBeenCalledWith(56, "WBNB", "USDT", expect.objectContaining({ feeTier: undefined }));
  });

  it("keeps the plain planner for a request that names two prices", async () => {
    read.readPancakePrice.mockClear();
    const res = await POST(send({ input: { lowerUsd: 1000, upperUsd: 2000, levels: 11, orderSizeUsd: 100 } }));
    const body = (await res.json()) as { result: { task: { status: { state: string } } } };
    expect(body.result.task.status.state).toBe("completed");
    expect(read.readPancakePrice).not.toHaveBeenCalled();
  });
});
