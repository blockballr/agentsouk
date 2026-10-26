import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveActor } from "@/lib/vault-actor";

vi.mock("server-only", () => ({}));

// the junction's seam, offline: a granted session is plain JSON, so the actor's
// config resolution, address read and relay round trip run against a mocked
// client without touching a chain. the live rehearsal through a real account
// stays with the onchain test.
const execute = vi.hoisted(() => vi.fn());

vi.mock("@altananetwork/sdk", () => ({
  BNB: { id: 56 },
  BNB_TESTNET: { id: 97 },
  createClient: () => ({ execute }),
  signerFromPrivateKey: () => ({}),
}));

const WALLET = "0x1111111111111111111111111111111111111111";
const TX = `0x${"1".repeat(64)}`;
const TX56 = `0x${"2".repeat(64)}`;
const CALL = { to: "0xc742e51f3fe3875a3335700a7d692f40dc8e60b8", data: "0xdeadbeef", value: 0n } as const;

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
  it("resolves when the session and its key are both configured", async () => {
    grantSession({ wallet: { address: WALLET } });
    await expect(resolveActor("altana")).resolves.toMatchObject({ kind: "altana" });
  });

  it("refuses a session blob that does not parse", async () => {
    grantSession("not json at all");
    await expect(resolveActor("altana")).rejects.toThrow(/does not parse as a granted session/);
  });

  it("reads the acting address from the session, not from anywhere else", async () => {
    grantSession({ wallet: { address: WALLET } });
    const actor = await resolveActor("altana");
    await expect(actor.address()).resolves.toBe(WALLET);
  });

  it("takes the wallet address where a live grantSession puts it", async () => {
    grantSession({ walletAddress: WALLET });
    const actor = await resolveActor("altana");
    await expect(actor.address()).resolves.toBe(WALLET);
  });

  it("refuses a session that carries no wallet address", async () => {
    grantSession({ wallet: {} });
    const actor = await resolveActor("altana");
    await expect(actor.address()).rejects.toThrow(/does not carry the wallet address/);
  });

  it("sends the granted session, the call and the testnet chain id to the relay", async () => {
    grantSession({ wallet: { address: WALLET } });
    execute.mockResolvedValue({ status: "CONFIRMED", transactionHash: TX });
    const actor = await resolveActor("altana", 97);
    const hash = await actor.trade(CALL);
    expect(hash).toBe(TX);
    expect(execute).toHaveBeenCalledTimes(1);
    const arg = execute.mock.calls[0][0];
    expect(arg.chainId).toBe(97);
    // the rehydrated signer rides the session at resolve time: the sdk's
    // json-only session shape refused the execute path before this was added
    expect(arg.session).toEqual({ wallet: { address: WALLET }, signer: {} });
    expect(arg.calls).toEqual([CALL]);
  });

  it("reads the hash from a relay receipt when the result carries one", async () => {
    grantSession({ wallet: { address: WALLET } });
    execute.mockResolvedValue({ status: "CONFIRMED", receipts: [{ transactionHash: TX }] });
    const actor = await resolveActor("altana");
    await expect(actor.trade(CALL)).resolves.toBe(TX);
  });

  it("sends the mainnet chain id when the actor is built for chain 56", async () => {
    grantSession({ wallet: { address: WALLET } });
    execute.mockResolvedValue({ status: "CONFIRMED", transactionHash: TX56 });
    const actor = await resolveActor("altana", 56);
    const hash = await actor.trade(CALL);
    expect(hash).toBe(TX56);
    expect(execute.mock.calls[0][0].chainId).toBe(56);
  });

  it("refuses a relay answer that carries a callsId but no transaction hash", async () => {
    grantSession({ wallet: { address: WALLET } });
    execute.mockResolvedValue({ status: "PENDING", callsId: TX });
    const actor = await resolveActor("altana");
    await expect(actor.trade(CALL)).rejects.toThrow(/no transaction hash/);
  });

  it("refuses a relay answer marked FAILED", async () => {
    grantSession({ wallet: { address: WALLET } });
    execute.mockResolvedValue({ status: "FAILED", callsId: TX });
    const actor = await resolveActor("altana");
    await expect(actor.trade(CALL)).rejects.toThrow(/FAILED/);
  });
});


