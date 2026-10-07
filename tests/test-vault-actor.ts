import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveActor } from "@/lib/vault-actor";

// the junction's seam, offline: a granted session is plain JSON, so the actor's
// config resolution, address read and relay round trip run against a mocked
// client without touching a chain. the live rehearsal through a real account
// stays with the onchain test.
const execute = vi.hoisted(() => vi.fn());

vi.mock("@altananetwork/sdk", () => ({
  BNB_TESTNET: { id: 97 },
  createClient: () => ({ execute }),
  signerFromPrivateKey: () => ({}),
}));

const WALLET = "0x1111111111111111111111111111111111111111";
const CALL = { to: "0xc742e51f3fe3875a3335700a7d692f40dc8e60b8", data: "0xdeadbeef", value: 0n };

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  execute.mockReset();
});

function grantSession(session: unknown) {
  process.env.AGENT_ALTANA_SESSION = typeof session === "string" ? session : JSON.stringify(session);
  process.env.AGENT_ALTANA_SESSION_KEY = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
}

describe("the altana junction", () => {
  it("resolves when the session and its key are both configured", () => {
    grantSession({ wallet: { address: WALLET } });
    expect(resolveActor("altana").kind).toBe("altana");
  });

  it("refuses a session blob that does not parse", () => {
    grantSession("not json at all");
    expect(() => resolveActor("altana")).toThrow(/does not parse as a granted session/);
  });

  it("reads the acting address from the session, not from anywhere else", async () => {
    grantSession({ wallet: { address: WALLET } });
    const actor = resolveActor("altana");
    await expect(actor.address()).resolves.toBe(WALLET);
  });

  it("refuses a session that carries no wallet address", async () => {
    grantSession({ wallet: {} });
    const actor = resolveActor("altana");
    await expect(actor.address()).rejects.toThrow(/does not carry the wallet address/);
  });

  it("sends the granted session, the call and the chain id to the relay", async () => {
    grantSession({ wallet: { address: WALLET } });
    execute.mockResolvedValue({ receipts: [{ hash: "0xhash1" }] });
    const actor = resolveActor("altana");
    const hash = await actor.trade(CALL);
    expect(hash).toBe("0xhash1");
    expect(execute).toHaveBeenCalledTimes(1);
    const arg = execute.mock.calls[0][0];
    expect(arg.chainId).toBe(97);
    expect(arg.session).toEqual({ wallet: { address: WALLET } });
    expect(arg.calls).toEqual([CALL]);
  });

  it("refuses a relay answer that carries no receipt hash", async () => {
    grantSession({ wallet: { address: WALLET } });
    execute.mockResolvedValue({ receipts: [] });
    const actor = resolveActor("altana");
    await expect(actor.trade(CALL)).rejects.toThrow(/no receipt hash/);
  });
});
