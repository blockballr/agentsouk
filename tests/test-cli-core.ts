// The CLI core is pure enough to pin: config precedence, redaction, output
// selection, agent refs, rail detection and the key loader's refusals.
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { DEFAULT_CONFIG, resolveConfig } from "../packages/cli/src/core/config";
import { redact } from "../packages/cli/src/core/redact";
import { pickFormat } from "../packages/cli/src/core/output";
import { parseAgentRef, railsOf, type AgentSummary } from "../packages/cli/src/marketplace/agents";
import { loadSigner } from "../packages/cli/src/core/wallet";

describe("cli config", () => {
  it("falls back to the built-in defaults", () => {
    const config = resolveConfig({ flags: {}, env: {}, file: {} });
    expect(config.apiUrl).toBe(DEFAULT_CONFIG.apiUrl);
    expect(config.chainId).toBe(56);
    expect(config.defaultRail).toBe("direct");
  });

  it("prefers a file value over the default and an env value over the file", () => {
    const file = resolveConfig({ flags: {}, env: {}, file: { chainId: 97 } });
    expect(file.chainId).toBe(97);
    const env = resolveConfig({ flags: {}, env: { AGENTSOUK_CHAIN_ID: "56" }, file: { chainId: 97 } });
    expect(env.chainId).toBe(56);
  });

  it("prefers a flag over the environment", () => {
    const config = resolveConfig({
      flags: { apiUrl: "https://example.test", chainId: 56 },
      env: { AGENTSOUK_API_URL: "https://ignored.test" },
    });
    expect(config.apiUrl).toBe("https://example.test");
  });

  it("refuses an api url that is not http", () => {
    expect(() => resolveConfig({ flags: { apiUrl: "file:///etc/passwd" }, env: {}, file: {} })).toThrow(
      /http or https/,
    );
  });

  it("refuses an unknown rail", () => {
    expect(() => resolveConfig({ flags: { defaultRail: "magic" as never }, env: {}, file: {} })).toThrow(/unknown rail/);
  });
});

describe("cli redaction", () => {
  it("masks a 32 byte hex string", () => {
    const key = "0x" + "ab".repeat(32);
    expect(redact(`key ${key} used`)).not.toContain(key);
    expect(redact(`key ${key} used`)).toContain("<redacted>");
  });

  it("masks an env assignment", () => {
    expect(redact("AGENTSOUK_KEY=0xdeadbeef")).toContain("AGENTSOUK_KEY=<redacted>");
  });
});

describe("cli output", () => {
  it("takes the explicit flags first", () => {
    expect(pickFormat({ json: true, tty: true })).toBe("json");
    expect(pickFormat({ quiet: true, tty: true })).toBe("quiet");
    expect(pickFormat({ output: "table", json: true, tty: false })).toBe("table");
  });

  it("defaults a pipe to json and a terminal to table", () => {
    expect(pickFormat({ tty: false })).toBe("json");
    expect(pickFormat({ tty: true })).toBe("table");
  });
});

describe("agent refs and rails", () => {
  it("reads chain and id, or an id with the configured chain", () => {
    expect(parseAgentRef("56/404603", 97)).toEqual({ chainId: 56, tokenId: "404603" });
    expect(parseAgentRef("404603", 56)).toEqual({ chainId: 56, tokenId: "404603" });
  });

  it("refuses a malformed ref as a usage error", () => {
    try {
      parseAgentRef("souk/health", 56);
      expect.unreachable();
    } catch (error) {
      expect((error as { exit?: number }).exit).toBe(2);
    }
  });

  it("names every rail a listing qualifies for", () => {
    const vault = { skills: [{ id: "vault-execution" }], a2a_endpoint: "https://x" } as AgentSummary;
    expect(railsOf(vault)).toBe("vault");

    const jobs = {
      skills: [{ id: "negotiate" }, { id: "notify_funded" }],
      a2a_endpoint: "https://x",
    } as AgentSummary;
    expect(railsOf(jobs)).toBe("jobs");

    const x402 = { skills: [], a2a_endpoint: "https://x", x402_supported: true } as AgentSummary;
    expect(railsOf(x402)).toBe("direct,x402");

    expect(railsOf({ skills: [] } as AgentSummary)).toBe("none");
  });
});

describe("key loading", () => {
  it("refuses to sign without a key", () => {
    expect(() => loadSigner({ env: {} })).toThrow(/--key-file/);
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => loadSigner({ env: { AGENTSOUK_KEY: "0x1234" } })).toThrow(/32 byte/);
  });

  it("derives the address and never echoes the key", () => {
    const key = `0x${"11".repeat(32)}` as `0x${string}`;
    const signer = loadSigner({ env: { AGENTSOUK_KEY: key } });
    expect(signer.address).toBe(privateKeyToAccount(key).address);
    expect(JSON.stringify(signer)).not.toContain("1111");
  });
});
