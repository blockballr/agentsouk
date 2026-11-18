// a rate limited model hands over to the next one at once, keeping the lookups already made, and
// past its time budget the assistant answers from what it has instead of looking further
import { describe, expect, it } from "vitest";
import { askAssistant } from "../src/lib/assistant/brain";

const endpoints = [
  { base: "https://big.example", key: "k", model: "big" },
  { base: "https://small.example", key: "k", model: "small" },
];

type Call = { model: string; toolChoice: string; messages: number };

function fakeFetch(plan: (call: Call, n: number) => Response | object): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/mcp")) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "[]" }] } }), { headers: { "content-type": "application/json" } });
    }
    const body = JSON.parse(String(init?.body));
    const call = { model: body.model, toolChoice: body.tool_choice, messages: body.messages.length };
    calls.push(call);
    const out = plan(call, calls.length);
    return out instanceof Response ? out : new Response(JSON.stringify({ choices: [{ message: out }] }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const lookup = { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_agents", arguments: "{}" } }] };

describe("answering in time", () => {
  it("moves to the next model on a rate limit without waiting, and keeps the lookup", async () => {
    const { fetchImpl, calls } = fakeFetch((call, n) => {
      if (n === 1) return lookup;
      if (call.model === "big") return new Response("slow down", { status: 429 });
      return { content: "Band Keeper fits." };
    });
    const started = Date.now();
    const reply = await askAssistant({ history: [{ role: "user", content: "who rebalances?" }], endpoints, mcpUrl: "https://api.example/api/mcp", fetchImpl, retryWaitMs: 20_000 });
    expect(reply.text).toBe("Band Keeper fits.");
    expect(reply.model).toBe("small");
    expect(Date.now() - started).toBeLessThan(5_000);
    // the small model saw the lookup the big one asked for
    expect(calls.at(-1)!.messages).toBe(calls[0]!.messages + 2);
  });

  it("answers from what it has once the time budget is spent", async () => {
    const { fetchImpl, calls } = fakeFetch((call) => (call.toolChoice === "none" ? { content: "From what I found, Band Keeper." } : lookup));
    const reply = await askAssistant({ history: [{ role: "user", content: "who rebalances?" }], endpoints, mcpUrl: "https://api.example/api/mcp", fetchImpl, budgetMs: 0 });
    expect(reply.text).toBe("From what I found, Band Keeper.");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.toolChoice).toBe("none");
  });
});

describe("handing over to a backup model", () => {
  it("writes the lookups out as text, so a model that did not make them can still read them", async () => {
    const { flattenLookups } = await import("../src/lib/assistant/brain");
    const flat = flattenLookups([
      { role: "user", content: "who rebalances?" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_agents", arguments: '{"category":"rebalancing"}' } }] },
      { role: "tool", tool_call_id: "c1", content: '[{"name":"Band Keeper"}]' },
    ] as never);
    expect(flat.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(flat[1]!.content).toContain("list_agents");
    expect(flat[2]!.content).toContain("Band Keeper");
    expect(JSON.stringify(flat)).not.toContain("tool_calls");
  });
});

describe("prepared actions as buttons", () => {
  it("returns each prepared action as a labelled button, once", async () => {
    const prepare = { content: null, tool_calls: [
      { id: "p1", type: "function", function: { name: "prepare_action", arguments: '{"action":"hire","chainId":56,"tokenId":"404603","label":"Hire Souk Health Guard"}' } },
      { id: "p2", type: "function", function: { name: "prepare_action", arguments: '{"action":"hire","chainId":56,"tokenId":"404603"}' } },
    ] };
    const { fetchImpl } = fakeFetch((_call, n) => (n === 1 ? prepare : { content: "Souk Health Guard repays debt inside limits you set." }));
    const reply = await askAssistant({ history: [{ role: "user", content: "protect my loan" }], endpoints, mcpUrl: "https://api.example/api/mcp", fetchImpl });
    expect(reply.actions).toEqual([{ label: "Hire Souk Health Guard", url: "https://app.agentsouk.xyz/agents/56/404603" }]);
  });

  it("keeps a label short and plain, and falls back to a fixed one", async () => {
    const { actionLabel } = await import("../src/lib/assistant/brain");
    expect(actionLabel("sell", undefined)).toBe("List an agent");
    expect(actionLabel("hire", "<b>Hire</b> now!!! https://evil.example")).not.toMatch(/[<>!/:]/);
    expect(actionLabel("hire", "x".repeat(80)).length).toBeLessThanOrEqual(40);
  });
});

describe("no button twice", () => {
  it("drops a label or link from the text when it is already a button", async () => {
    const { withoutButtons } = await import("../src/lib/assistant/brain");
    const a = [{ label: "Hire Souk Band Keeper", url: "https://app.agentsouk.xyz/agents/56/391002" }];
    expect(withoutButtons("Band Keeper fits.\n\n[Hire Souk Band Keeper]", a)).toBe("Band Keeper fits.");
    expect(withoutButtons("Open https://app.agentsouk.xyz/agents/56/391002 to hire.", a)).toBe("Open  to hire.");
    expect(withoutButtons("See [Hire Souk Band Keeper](https://app.agentsouk.xyz/agents/56/391002).", a)).toBe("See .");
  });
});
