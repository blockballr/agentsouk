import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("the assistant's guard rails", () => {
  it("offers only read tools and the prepare tool, never one that writes", async () => {
    const { assistantTools } = await import("../src/lib/assistant/brain");
    const names = assistantTools().map((t) => t.function.name);
    expect(names).toContain("list_agents");
    expect(names).toContain("prepare_action");
    for (const writer of ["start_hire", "deliver_task", "vault_track"]) expect(names).not.toContain(writer);
  });

  it("refuses to run a write tool even when the model asks for one", async () => {
    const { callMcpTool } = await import("../src/lib/assistant/brain");
    const fetchImpl = vi.fn();
    const out = await callMcpTool("https://example.test/mcp", "start_hire", {}, fetchImpl as never);
    expect(out).toMatch(/not available/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prepares links to pages, never anything signed", async () => {
    const { prepareLink } = await import("../src/lib/assistant/brain");
    expect(prepareLink({ action: "hire", tokenId: "404603" })).toBe("https://app.agentsouk.xyz/agents/56/404603");
    expect(prepareLink({ action: "compare", chainId: 56, tokenId: "368655x" })).toBe("https://app.agentsouk.xyz/compare?agent=56/368655");
    expect(prepareLink({ action: "my_hires" })).toBe("https://app.agentsouk.xyz/ongoing");
  });

  it("compacts big tool answers so a request stays small", async () => {
    const { compact } = await import("../src/lib/assistant/brain");
    const out = compact({ items: Array.from({ length: 30 }, (_, i) => ({ name: `a${i}`, description: "x".repeat(400), examples: ["e"] })) }) as { items: { description: string; examples?: unknown }[] };
    expect(out.items.length).toBe(6);
    expect(out.items[0]!.description.length).toBeLessThanOrEqual(160);
    expect(out.items[0]!.examples).toBeUndefined();
  });

  it("builds the model address for a bare host or a full path", async () => {
    const { chatUrl } = await import("../src/lib/assistant/brain");
    expect(chatUrl("https://api.groq.com")).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(chatUrl("https://generativelanguage.googleapis.com/v1beta/openai")).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  });
});

describe("telegram formatting", () => {
  it("escapes html and keeps bold, code and links", async () => {
    const { toTelegramHtml } = await import("../src/lib/assistant/telegram-format");
    expect(toTelegramHtml("**Souk Health Guard** <script> `404603` [Hire it](https://app.agentsouk.xyz/agents/56/404603)\n- one")).toBe(
      '<b>Souk Health Guard</b> &lt;script&gt; <code>404603</code> <a href="https://app.agentsouk.xyz/agents/56/404603">Hire it</a>\n- one',
    );
  });
});

describe("the assistant's own reads", () => {
  it("never reads a wallet the conversation did not link", async () => {
    const { callLocalTool } = await import("../src/lib/assistant/local-tools");
    const fetchImpl = vi.fn();
    const out = JSON.parse(await callLocalTool("my_earnings", null, fetchImpl as never));
    expect(out.error).toBe("no wallet");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads the linked wallet's own listings, and nobody else's", async () => {
    const { callLocalTool } = await import("../src/lib/assistant/local-tools");
    const wallet = "0x84FEDaBd1B83443Ad86796C15619494878B64180";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ agents: [{ name: "Souk Health Guard", tokenId: "404603", chainId: 56, category: "health-factor", verification: { status: "online" } }] })));
    const out = JSON.parse(await callLocalTool("my_listings", wallet, fetchImpl as never));
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(`owner=${wallet}`);
    expect(out.agents[0]).toMatchObject({ name: "Souk Health Guard", network: "mainnet", answering: "yes" });
  });

  it("adds earnings per token and chain, and leaves out our own probes", async () => {
    const { summariseEarnings } = await import("../src/lib/assistant/local-tools");
    const out = summariseEarnings({
      hires: [
        { paymentId: "req_1", amount: "20000000000000000", decimals: 18, symbol: "U", chainId: 56, agentName: "A", payer: "buyer" },
        { paymentId: "req_2", amount: "30000000000000000", decimals: 18, symbol: "U", chainId: 56, agentName: "A", payer: "buyer" },
        { paymentId: "verify_1", amount: "10000000000000000000", decimals: 18, symbol: "sUSD", chainId: 97, agentName: "A" },
      ],
    }) as { payments: number; totals: { asset: string; amount: number }[] };
    expect(out.payments).toBe(2);
    expect(out.totals).toEqual([{ asset: "U on mainnet", amount: 0.05 }]);
  });

  it("ranks Flux LP pools by their result against holding", async () => {
    const { summarisePools } = await import("../src/lib/assistant/local-tools");
    const out = summarisePools({
      pools: [
        { symbol: "NVDAB/USDT", venue: "pancake", result: { vsHoldPer1k: -43.96, feesPer1k: 14, priceMovePct: -16.3, coveredDays: 11, label: "trending" } },
        { symbol: "AAPLB/USDT", venue: "uniswap", result: { vsHoldPer1k: 12.55, feesPer1k: 12.6, priceMovePct: -0.3, coveredDays: 13, label: "earning" } },
        { symbol: "NEWB/USDT", venue: "pancake", result: null },
      ],
    }) as { pools: { pair: string; endedAgainstHoldingPer1000?: number }[] };
    expect(out.pools.map((p) => p.pair)).toEqual(["AAPLB/USDT", "NVDAB/USDT", "NEWB/USDT"]);
    expect(out.pools[0]!.endedAgainstHoldingPer1000).toBe(12.55);
  });
});
