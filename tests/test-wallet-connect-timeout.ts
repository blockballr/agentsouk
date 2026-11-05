// A connect that the wallet never answers must still end: the rail cannot stay
// on "connecting" forever. These pin the bound, the honest copy it reports, and
// that a normal connect still passes through untouched.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  connectProvider: vi.fn(),
  changeWallet: vi.fn(),
  clearWalletChoice: vi.fn(),
  disconnectProvider: vi.fn(),
  getActiveAccount: vi.fn(),
  getProvider: vi.fn(),
  watchActiveAccount: vi.fn(),
}));
vi.mock("../apps/web/src/lib/wallet", () => m);

import {
  ConnectTimeoutError,
  connectWalletWithTimeout,
} from "../apps/web/src/lib/wallet-session";

const A = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const KEY = "agora.wallet.signins";
const storage = new Map<string, string>();

const TIMEOUT_COPY = "we reached no wallet: check the wallet popup or click connect again";

beforeEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
});

describe("connectWalletWithTimeout", () => {
  it("reports an honest outcome when the connect outlives the bound", async () => {
    m.connectProvider.mockImplementation(() => new Promise(() => {}));

    await expect(connectWalletWithTimeout(50)).rejects.toThrow(TIMEOUT_COPY);
  });

  it("gives up exactly on the default 20 second bound", async () => {
    m.connectProvider.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    // the error is collected through a container, so no unhandled rejection and
    // no narrowing games with the implied assignment in the catch
    const got = { err: null as Error | null };
    const settled = connectWalletWithTimeout().catch((e: Error) => {
      got.err = e;
      return null as never;
    });
    void settled;

    await vi.advanceTimersByTimeAsync(19_000);
    expect(got.err).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(got.err).toBeInstanceOf(ConnectTimeoutError);
    expect(got.err?.message).toBe(TIMEOUT_COPY);

    vi.useRealTimers();
  });

  it("a connect that answers inside the bound resolves as before", async () => {
    m.connectProvider.mockResolvedValue(A);
    const { privateKeyToAccount } = await import("viem/accounts");
    const signer = privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    );
    m.getProvider.mockImplementation(async () => ({
      request: async ({ method, params }: { method: string; params?: string[] }) => {
        if (method !== "personal_sign") throw new Error(`unexpected method ${method}`);
        const [message] = params ?? [];
        return signer.signMessage({ message });
      },
    }));

    const address = await connectWalletWithTimeout(5_000);

    expect(address).toBe(A);
    expect(JSON.parse(storage.get(KEY) ?? "{}")[A.toLowerCase()]).toBeTruthy();
  });

  it("the wallet's own refusal still comes through, unmasked", async () => {
    m.connectProvider.mockResolvedValue(A);
    const fail = new Error("User rejected the request.") as Error & { code: number };
    fail.code = 4001;
    m.getProvider.mockResolvedValue({
      request: async () => {
        throw fail;
      },
    });

    await expect(connectWalletWithTimeout(5_000)).rejects.toThrow(/declined/i);
  });
});
