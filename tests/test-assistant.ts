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
