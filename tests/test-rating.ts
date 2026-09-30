// A rating is ERC-8004 feedback from the buyer's own wallet. The calldata must
// match the registry actually deployed on chains 97 and 56 (v2.0.0, selector
// 0x3c036a7e), and carry the tag 8004scan scores, or the rating never counts.
import { afterEach, describe, expect, it, vi } from "vitest";

const wallet = vi.hoisted(() => ({
  connectWallet: vi.fn(),
  ensureBscChain: vi.fn(),
  getActiveAccount: vi.fn(),
  getProvider: vi.fn(),
  setTargetChain: vi.fn(),
  chainIdToHex: (id: number) => `0x${id.toString(16)}`,
}));
vi.mock("../apps/web/src/lib/wallet", () => wallet);

import { decodeFunctionData, parseAbi, zeroHash } from "viem";
import { feedbackCalldata, markRated, rateAgent, ratedHires, starsToScore } from "../apps/web/src/lib/rating";
import { reputationRegistryFor } from "../apps/web/src/lib/contracts";

const deployed = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);

describe("rating calldata", () => {
  it("targets the deployed giveFeedback and the tag 8004scan scores", () => {
    const data = feedbackCalldata("2504", 4);
    expect(data.slice(0, 10)).toBe("0x3c036a7e");
    const { args } = decodeFunctionData({ abi: deployed, data });
    expect(args).toEqual([2504n, 80n, 0, "starred", "agentsouk", "", "", zeroHash]);
  });

  it("maps one to five stars onto the 0 to 100 scale and refuses anything else", () => {
    expect([1, 2, 3, 4, 5].map(starsToScore)).toEqual([20, 40, 60, 80, 100]);
    expect(() => starsToScore(0)).toThrow();
    expect(() => starsToScore(6)).toThrow();
  });

  it("knows the reputation registry on both chains", () => {
    expect(reputationRegistryFor(97)).toBe("0x8004B663056A597Dffe9eCcC1965A193B7388713");
    expect(reputationRegistryFor(56)).toBe("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63");
  });
});

describe("hires this browser has rated", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remembers a rated hire and the stars it was given", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    markRated("pay_1", 4);
    expect(ratedHires().get("pay_1")).toBe(4);
    expect(ratedHires().has("pay_2")).toBe(false);
  });

  it("reads a rating saved before the stars were kept as rated with no stars", () => {
    const store = new Map<string, string>([["souk.rated", JSON.stringify(["pay_old"])]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(ratedHires().get("pay_old")).toBeNull();
    markRated("pay_new", 5);
    expect(ratedHires().get("pay_old")).toBeNull();
    expect(ratedHires().get("pay_new")).toBe(5);
  });

  it("asks again rather than failing when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => markRated("pay_1", 3)).not.toThrow();
    expect(ratedHires().size).toBe(0);
  });
});

describe("sending a rating", () => {
  const BUYER = "0x1111111111111111111111111111111111111111";
  const sent: { to?: string; data?: string }[] = [];
  function provider() {
    sent.length = 0;
    return {
      request: vi.fn(async ({ method, params }: { method: string; params: { to?: string; data?: string }[] }) => {
        if (method === "eth_sendTransaction") {
          sent.push(params[0]);
          return `0x${"cd".repeat(32)}`;
        }
        if (method === "eth_getTransactionReceipt") return { status: "0x1" };
        return null;
      }),
    };
  }

  afterEach(() => vi.clearAllMocks());

  it("points the wallet at the rating's chain and sends to that chain's registry", async () => {
    wallet.getProvider.mockResolvedValue(provider());
    wallet.getActiveAccount.mockResolvedValue(BUYER);
    wallet.ensureBscChain.mockResolvedValue("0x61");
    const result = await rateAgent(97, "2504", 5);
    expect(wallet.setTargetChain).toHaveBeenCalledWith(97);
    expect(sent[0]?.to).toBe("0x8004B663056A597Dffe9eCcC1965A193B7388713");
    expect(result.confirmed).toBe(true);
  });

  it("sends nothing when the wallet stays on the other chain", async () => {
    wallet.getProvider.mockResolvedValue(provider());
    wallet.getActiveAccount.mockResolvedValue(BUYER);
    wallet.ensureBscChain.mockResolvedValue("0x38");
    await expect(rateAgent(97, "2504", 5)).rejects.toThrow("Switch your wallet to BSC testnet");
    expect(sent).toEqual([]);
  });
});
