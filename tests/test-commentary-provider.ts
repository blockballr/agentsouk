// The commentary route speaks the OpenAI chat format, so any compatible provider
// should work from environment variables alone. Two things broke that: gemini
// model names were sent to whatever provider was configured, and json mode was
// requested without the word json in any message, which OpenAI refuses.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  clientIpFrom: () => "127.0.0.1",
  enforceRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
}));

const body = {
  agents: [{ name: "Souk Yield Scout", category: "yield", score: 80, feedbacks: 3, verified: true }],
  winners: [{ category: "yield", name: "Souk Yield Scout" }],
};

function request() {
  return new Request("http://localhost/api/compare/commentary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("commentary provider", () => {
  it("sends only the configured model to another provider, and asks for the key it reads", async () => {
    vi.stubEnv("LLM_EVAL_API_KEY", "test-key");
    vi.stubEnv("LLM_EVAL_BASE_URL", "https://api.openai.example/v1");
    vi.stubEnv("LLM_EVAL_MODEL", "gpt-test");
    const sent: { model: string; messages: { content: string }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"commentary":"It won on score."}' } }] }),
          { status: 200 },
        );
      }),
    );
    const { POST } = await import("../src/app/api/compare/commentary/route");
    const res = await POST(request());
    expect(await res.json()).toMatchObject({ success: true, commentary: "It won on score.", model: "gpt-test" });
    expect(sent.map((s) => s.model)).toEqual(["gpt-test"]);
    const system = sent[0].messages[0].content;
    expect(system.toLowerCase()).toContain("json");
    expect(system).toContain('"commentary"');
  });

  it("never reaches a provider that has no model configured", async () => {
    vi.stubEnv("LLM_EVAL_API_KEY", "test-key");
    vi.stubEnv("LLM_EVAL_BASE_URL", "https://api.openai.example/v1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("../src/app/api/compare/commentary/route");
    expect(await (await POST(request())).json()).toMatchObject({ success: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
