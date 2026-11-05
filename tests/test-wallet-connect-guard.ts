// A stored "walletconnect" choice is a hint about the last pairing, not a rule.
// On a desktop with a real extension installed (a browser that earlier ran the
// Telegram flow), that stale entry must not hijack the connect and tie it to a
// dead pairing that never prompts. These pin: an injected wallet outranks the
// stale choice and replaces it, while an explicit real choice still wins.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// keep the sibling imports light; the behaviors under test live in wallet.ts itself
vi.mock("@agora/core", () => ({ rpcUrlsFor: () => [] }));
vi.mock("../apps/web/src/core/x402", () => ({ TRANSFER_TYPES: {} }));
vi.mock("../apps/web/src/lib/contracts", () => ({ explorerTxBase: () => "https://bscscan.com/tx/" }));
vi.mock("../apps/web/src/lib/stale-chunk", () => ({ reloadOnceForStaleChunk: () => false }));
vi.mock("../apps/web/src/lib/target-chain", () => ({ setTargetChainState: () => {} }));

// the picker is only offered several wallets; a test that sets pickerPick takes
// the controlled branch, leaving it null asserts no picker was needed
let pickerPick: string | null = null;
vi.mock("../apps/web/src/components/WalletPicker", () => ({
  showWalletPicker: async (options: { rdns: string }[]) =>
    pickerPick === null ? null : options.find((o) => o.rdns === pickerPick) ?? null,
}));

const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const KEY = "agora.wallet.rdns";
const storage = new Map<string, string>();
const extensions: {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Stub;
}[] = [];
let wallet: typeof import("../apps/web/src/lib/wallet");

interface Eip1193Stub {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
}

type FakeWindow = EventTarget & { ethereum?: Eip1193Stub; BinanceChain?: Eip1193Stub };

function stubWallet(): Eip1193Stub {
  return {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return "0x38";
      throw new Error(`unexpected method ${method}`);
    },
    on: () => {},
    removeListener: () => {},
    isMetaMask: true,
  };
}

function announce(rdns: string, name: string): { provider: Eip1193Stub; calls: string[] } {
  const calls: string[] = [];
  const provider: Eip1193Stub = {
    request: async ({ method }) => {
      calls.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
      throw new Error(`unexpected method ${method}`);
    },
    on: () => {},
    removeListener: () => {},
    isMetaMask: true,
  };
  const detail = { info: { uuid: `u-${rdns}`, name, icon: "", rdns }, provider };
  // a real extension announces on page load without being asked, so the event
  // goes out immediately rather than behind a requestProvider round
  extensions.push({ info: detail.info, provider });
  fakeWindow.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail }));
  return { provider, calls };
}

// the extension side of EIP-6963: every requestProvider gets one announce round
let fakeWindow: FakeWindow;
beforeAll(async () => {
  fakeWindow = Object.assign(new EventTarget() as FakeWindow, {
    ethereum: undefined,
    BinanceChain: undefined,
  });
  fakeWindow.addEventListener("eip6963:requestProvider", () => {
    for (const e of [...extensions]) {
      fakeWindow.dispatchEvent(
        Object.assign(new Event("eip6963:announceProvider"), {
          detail: { info: e.info, provider: e.provider },
        }),
      );
    }
  });
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  wallet = await import("../apps/web/src/lib/wallet");
});

beforeEach(() => {
  storage.clear();
  extensions.length = 0;
  fakeWindow.ethereum = undefined;
  fakeWindow.BinanceChain = undefined;
  pickerPick = null;
});

describe("connectProvider against a stale walletconnect choice", () => {
  it("steps aside for a legacy injected wallet and swaps in the real choice", async () => {
    storage.set(KEY, "walletconnect");
    fakeWindow.ethereum = stubWallet();
    pickerPick = "legacy";

    const account = await wallet.connectProvider();

    expect(account).toBe(ACCOUNT);
    // the dead pairing is gone, replaced by what the desktop actually has
    expect(storage.get(KEY)).toBe("legacy");
    expect(wallet.walletConnectUri()).toBeNull();
  });

  it("steps aside for an announced extension the same way", async () => {
    storage.set(KEY, "walletconnect");
    const { calls } = announce("io.rabby.test", "Rabby");
    pickerPick = "io.rabby.test";

    const account = await wallet.connectProvider();

    expect(account).toBe(ACCOUNT);
    expect(calls).toContain("eth_requestAccounts");
    expect(storage.get(KEY)).toBe("io.rabby.test");
    expect(wallet.walletConnectUri()).toBeNull();
  });

  it("an explicit announced choice still connects directly", async () => {
    const { calls } = announce("io.rabby.test", "Rabby");
    storage.set(KEY, "io.rabby.test");

    const account = await wallet.connectProvider();

    expect(account).toBe(ACCOUNT);
    expect(calls).toEqual(["eth_accounts", "eth_requestAccounts"]);
    expect(storage.get(KEY)).toBe("io.rabby.test");
  });
});

describe("explicit disconnect", () => {
  it("keeps the provider's account out until a deliberate connect", async () => {
    announce("io.rabby.disconnect", "Rabby Disconnect");
    storage.set(KEY, "legacy");
    fakeWindow.ethereum = stubWallet();

    wallet.disconnectProvider();

    expect(storage.has(KEY)).toBe(false);
    expect(wallet.isWalletDisconnected()).toBe(true);
    // the extension still answers eth_accounts with the account, but the page
    // must not adopt it after the disconnect
    expect(await wallet.getActiveAccount()).toBeNull();

    pickerPick = "io.rabby.disconnect";
    const account = await wallet.connectProvider();

    expect(account).toBe(ACCOUNT);
    expect(storage.get(KEY)).toBe("io.rabby.disconnect");
    expect(wallet.isWalletDisconnected()).toBe(false);
    expect(await wallet.getActiveAccount()).toBe(ACCOUNT);
  });

  it("asks the provider to revoke the site permission, best effort", async () => {
    const calls: string[] = [];
    fakeWindow.ethereum = {
      request: async ({ method }) => {
        calls.push(method);
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
        if (method === "wallet_revokePermissions") return null;
        throw new Error(`unexpected method ${method}`);
      },
      on: () => {},
      removeListener: () => {},
      isMetaMask: true,
    };
    storage.set(KEY, "legacy");

    wallet.disconnectProvider();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toContain("wallet_revokePermissions");
  });
});
