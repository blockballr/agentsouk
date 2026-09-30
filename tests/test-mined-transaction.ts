// a mined transaction read across every endpoint: a node that pruned its index answers null,
// so the next one is asked, and absence is claimed only when all of them agree
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const HASH = `0x${"ab".repeat(32)}` as const;

const nodes = vi.hoisted(() => ({ answers: {} as Record<string, "found" | "forgot" | "down"> }));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    http: (url: string) => url,
    createPublicClient: ({ transport }: { transport: string }) => {
      const answer = nodes.answers[transport] ?? "forgot";
      return {
        getTransactionReceipt: async ({ hash }: { hash: `0x${string}` }) => {
          if (answer === "down") throw new Error("fetch failed");
          if (answer === "forgot") throw new actual.TransactionReceiptNotFoundError({ hash });
          return { status: "success", logs: [], to: null };
        },
        getTransaction: async () => ({ input: "0x1234" }),
      };
    },
  };
});

import { readMinedTransaction, rpcUrls } from "../src/lib/rpc";

const urls = rpcUrls(97);
const [first, second, third] = urls;

beforeEach(() => {
  nodes.answers = {};
});

describe("reading a mined transaction", () => {
  it("asks the next endpoint when the first has forgotten the transaction", async () => {
    nodes.answers = { [first]: "forgot", [second]: "found" };
    expect(await readMinedTransaction(97, HASH)).toMatchObject({ found: true, input: "0x1234" });
  });

  it("claims absence only when every endpoint says so", async () => {
    expect(await readMinedTransaction(97, HASH)).toEqual({ found: false, asked: urls.length, unanswered: 0 });
  });

  it("leaves it open when an endpoint did not answer", async () => {
    nodes.answers = { [first]: "forgot", [second]: "down", [third]: "forgot" };
    expect(await readMinedTransaction(97, HASH)).toEqual({ found: false, asked: urls.length, unanswered: 1 });
  });
});
