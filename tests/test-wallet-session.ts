// The page's identity is a signature, not the wallet's own selection: connect
// ends in a sign-in, the record lives per address in this browser, and a switch
// adopts a recorded address or disconnects instead of becoming whoever the
// wallet now shows. These pin the adoption rules, the refusal copy, and what a
// record has to prove to be believed.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  account: null as string | null,
  signCalls: 0,
  declined: false,
  listeners: new Set<(account: string | null) => void>(),
  connectProvider: vi.fn(),
  changeWallet: vi.fn(),
  clearWalletChoice: vi.fn(),
  getActiveAccount: vi.fn(),
  getProvider: vi.fn(),
  watchActiveAccount: vi.fn(),
}));
vi.mock("../apps/web/src/lib/wallet", () => m);

import {
  changeWallet,
  connectWallet,
  disconnectWallet,
  sessionAccount,
  signInMessage,
  signOut,
  watchSession,
} from "../apps/web/src/lib/wallet-session";

const A = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const B = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const KEY = "agora.wallet.signins";
const storage = new Map<string, string>();

const report = (account: string | null): void => {
  for (const listener of [...m.listeners]) listener(account);
};

const stored = (): Record<string, { message: string; signature: string }> =>
  JSON.parse(storage.get(KEY) ?? "{}");

beforeAll(async () => {
  const { privateKeyToAccount } = await import("viem/accounts");
  const keys: Record<string, ReturnType<typeof privateKeyToAccount>> = {
    [A.toLowerCase()]: privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    ),
    [B.toLowerCase()]: privateKeyToAccount(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    ),
  };
  m.connectProvider.mockImplementation(async () => {
    if (!m.account) throw new Error("No wallet found.");
    report(m.account);
    return m.account;
  });
  m.getActiveAccount.mockImplementation(async () => m.account);
  m.getProvider.mockImplementation(async () => ({
    request: async ({ method, params }: { method: string; params?: string[] }) => {
      if (method !== "personal_sign") throw new Error(`unexpected method ${method}`);
      m.signCalls += 1;
      if (m.declined) {
        const err = new Error("User rejected the request.") as Error & { code: number };
        err.code = 4001;
        throw err;
      }
      const [message, address] = params ?? [];
      const signer = keys[address.toLowerCase()];
      if (!signer) throw new Error(`unknown address ${address}`);
      return signer.signMessage({ message });
    },
  }));
  m.watchActiveAccount.mockImplementation((listener: (account: string | null) => void) => {
    m.listeners.add(listener);
    return () => {
      m.listeners.delete(listener);
    };
  });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
});

afterAll(() => vi.unstubAllGlobals());

// the session module keeps state for the whole file, so each test starts from
// nobody signed in: the wallet reports an empty account list, storage clears
beforeEach(() => {
  report(null);
  m.account = null;
  m.signCalls = 0;
  m.declined = false;
  m.changeWallet.mockResolvedValue(null);
  m.clearWalletChoice.mockReset();
  storage.clear();
});

describe("the sign-in message", () => {
  it("is fixed text naming the site, the address and the time", () => {
    expect(
      signInMessage(A, "https://agentsouk.xyz", "2026-10-16T00:00:00.000Z"),
    ).toBe(
      [
        "Agent Souk sign-in",
        "site: https://agentsouk.xyz",
        `address: ${A.toLowerCase()}`,
        "issued: 2026-10-16T00:00:00.000Z",
      ].join("\n"),
    );
    expect(signInMessage(A, "x", "y").split("\n")).toHaveLength(4);
  });
});

describe("connect ends in a signature", () => {
  it("stores the record under the address and signs the session in", async () => {
    m.account = A;
    const seen: (string | null)[] = [];
    const unwatch = watchSession((a) => void seen.push(a));

    const addr = await connectWallet();

    expect(addr).toBe(A);
    expect(m.signCalls).toBe(1);
    expect(await sessionAccount()).toBe(A);
    expect(seen).toContain(A);
    const record = stored()[A.toLowerCase()];
    expect(record).toBeTruthy();
    expect(record.signature).toMatch(/^0x[0-9a-f]+$/i);
    expect(record.message.split("\n")[0]).toBe("Agent Souk sign-in");
    expect(record.message).toContain(`address: ${A.toLowerCase()}`);
    unwatch();
  });

  it("reconnects a recorded address without asking for a signature again", async () => {
    m.account = A;
    await connectWallet();
    expect(m.signCalls).toBe(1);

    const again = await connectWallet();

    expect(again).toBe(A);
    expect(m.signCalls).toBe(1);
  });

  it("a refused signature stores nothing and says so", async () => {
    m.account = A;
    m.declined = true;

    await expect(connectWallet()).rejects.toThrow(/declined/i);
    expect(m.signCalls).toBe(1);
    expect(stored()).toEqual({});
    expect(await sessionAccount()).toBeNull();
  });
});

describe("a switch adopts or disconnects, never impersonates", () => {
  it("adopts a previously recorded address without a prompt", async () => {
    m.account = A;
    await connectWallet();
    m.account = B;
    await connectWallet();
    expect(m.signCalls).toBe(2);

    // back to A inside the wallet: the report alone moves the session
    report(A);

    expect(await sessionAccount()).toBe(A);
    expect(m.signCalls).toBe(2);
  });

  it("disconnects on an address that never signed in, keeping the old record", async () => {
    m.account = A;
    await connectWallet();
    const seen: (string | null)[] = [];
    const unwatch = watchSession((a) => void seen.push(a));

    m.account = B;
    report(B);

    expect(await sessionAccount()).toBeNull();
    expect(seen).toContain(null);
    expect(m.signCalls).toBe(1);
    expect(Object.keys(stored())).toEqual([A.toLowerCase()]);
    unwatch();
  });

  it("ends the session on an empty account list but keeps the record", async () => {
    m.account = A;
    await connectWallet();

    report(null);
    expect(await sessionAccount()).toBeNull();

    report(A);
    expect(await sessionAccount()).toBe(A);
    expect(m.signCalls).toBe(1);
  });

  it("never believes a tampered record", async () => {
    m.account = A;
    await connectWallet();
    const record = stored()[A.toLowerCase()];
    const flipped =
      record.signature.slice(0, -2) + (record.signature.slice(-2) === "0a" ? "0b" : "0a");
    storage.set(KEY, JSON.stringify({ [A.toLowerCase()]: { ...record, signature: flipped } }));

    report(null);
    report(A);

    expect(await sessionAccount()).toBeNull();
  });
});

describe("forgetting", () => {
  it("disconnect keeps the record, so signing in again adopts without a prompt", async () => {
    m.account = A;
    await connectWallet();

    disconnectWallet();

    expect(await sessionAccount()).toBeNull();
    expect(Object.keys(stored())).toEqual([A.toLowerCase()]);
    expect(m.clearWalletChoice).toHaveBeenCalledTimes(1);

    report(A);
    expect(await sessionAccount()).toBe(A);
    expect(m.signCalls).toBe(1);
  });

  it("sign-out clears the record, so the address must sign in again", async () => {
    m.account = A;
    await connectWallet();

    signOut();
    expect(await sessionAccount()).toBeNull();
    expect(stored()).toEqual({});

    report(A);
    expect(await sessionAccount()).toBeNull();
    expect(m.signCalls).toBe(1);
  });
});

describe("changing wallet", () => {
  it("ends the session first and signs in the picked account", async () => {
    m.account = A;
    await connectWallet();
    m.changeWallet.mockResolvedValue(B);

    const addr = await changeWallet();

    expect(addr).toBe(B);
    expect(await sessionAccount()).toBe(B);
    expect(m.signCalls).toBe(2);
  });

  it("a dismissed picker leaves the page disconnected", async () => {
    m.account = A;
    await connectWallet();
    m.changeWallet.mockResolvedValue(null);

    const addr = await changeWallet();

    expect(addr).toBeNull();
    expect(await sessionAccount()).toBeNull();
  });
});
