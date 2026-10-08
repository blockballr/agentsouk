import { afterEach, describe, expect, it } from "vitest";
import { executorWallet } from "../src/lib/vault-executor";

// executorWallet reads the environment the page's pairing then shows with:
// none means no lane is configured, rawkey and altana name the custody halves
// the split supports, and the address is the only thing it is allowed to say.

const TOUCHED = ["AGENT_EXECUTOR_ACTOR", "AGENT_EXECUTOR_KEY", "AGENT_ALTANA_SESSION", "AGENT_ALTANA_SESSION_KEY"];

afterEach(() => {
  for (const name of TOUCHED) delete process.env[name];
});

describe("executorWallet", () => {
  it("reads none when no executor lane is configured", () => {
    expect(executorWallet()).toBeNull();
  });

  it("derives the raw key's address and nothing else", () => {
    process.env.AGENT_EXECUTOR_ACTOR = "rawkey";
    process.env.AGENT_EXECUTOR_KEY = `0x${"11".repeat(32)}`;
    const wallet = executorWallet();
    expect(wallet?.kind).toBe("rawkey");
    expect(wallet?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("reads none when the raw key is missing or malformed", () => {
    process.env.AGENT_EXECUTOR_ACTOR = "rawkey";
    delete process.env.AGENT_EXECUTOR_KEY;
    expect(executorWallet()).toBeNull();
    process.env.AGENT_EXECUTOR_KEY = "not-a-key";
    expect(executorWallet()).toBeNull();
  });

  it("takes the session wallet's address from a granted session", () => {
    process.env.AGENT_EXECUTOR_ACTOR = "altana";
    process.env.AGENT_ALTANA_SESSION = JSON.stringify({ wallet: { address: "0xAbC0000000000000000000000000000000000001" } });
    const wallet = executorWallet();
    expect(wallet?.kind).toBe("altana");
    expect(wallet?.address).toBe("0xAbC0000000000000000000000000000000000001");
  });

  it("reads none when the session blob is unparsable or carries no wallet", () => {
    process.env.AGENT_EXECUTOR_ACTOR = "altana";
    process.env.AGENT_ALTANA_SESSION = "not-json";
    expect(executorWallet()).toBeNull();
    process.env.AGENT_ALTANA_SESSION = "{}";
    expect(executorWallet()).toBeNull();
  });

  it("ignores an executor kind it does not know", () => {
    process.env.AGENT_EXECUTOR_ACTOR = "solana";
    expect(executorWallet()).toBeNull();
  });
});
