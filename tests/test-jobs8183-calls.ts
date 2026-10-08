import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { buildHireCalls, erc8183Addresses } from "@altananetwork/sdk";
import {
  decodeGetJob,
  encodeBalanceOf,
  encodeDisputeWindow,
  encodeGetJob,
  encodeJobCalls,
  encodeJobCounter,
  jobDescription,
  jobStatusName,
} from "../apps/web/src/lib/jobs8183";

// The five buyer calls are encoded twice: in the browser lib for the wallet
// to sign, and by the SDK for the relay path. These tests pin the two to the
// same bytes, so a drift on either side fails a run before a wallet ever sees
// it. The stack resolves to the chain-97 deployment the marketplace serves.

const stack97 = (() => {
  const a = erc8183Addresses(97);
  return { commerce: a.commerce, router: a.router, policy: a.policy, paymentToken: a.paymentToken };
})();

const INPUT = {
  jobId: 4242n,
  provider: "0x26dFfA1C42ff523Ee70F208a22424A2aEa4Df928",
  expiredAt: 1791500000n,
  budgetRaw: 1000000000000000000n,
  description: "plan a grid ladder for 10000 USDT between 250 and 320",
};

const QUOTE = {
  price: "1000000000000000000",
  currency: stack97.paymentToken,
  providerAddress: INPUT.provider,
  validUntil: 1791400000,
  negotiationHash: `0x${"ab".repeat(32)}`,
  providerSig: `0x${"cd".repeat(65)}`,
  agentId: "2018",
};

describe("the five buyer calls, pinned to the SDK's encoding", () => {
  it("creates, registers, budgets, approves and funds in the same order and bytes", () => {
    const mine = encodeJobCalls(stack97 as never, INPUT).map((c) => `${c.to} ${c.data}`);
    const sdk = buildHireCalls({
      addresses: erc8183Addresses(97),
      jobId: INPUT.jobId,
      provider: INPUT.provider as `0x${string}`,
      description: INPUT.description,
      budget: INPUT.budgetRaw,
      expiredAt: INPUT.expiredAt,
    }).map((c: { to: string; data: string }) => `${c.to} ${c.data}`);
    expect(mine).toEqual(sdk);
  });

  it("names the five steps in the order a buyer signs them", () => {
    const labels = encodeJobCalls(stack97 as never, INPUT).map((c) => c.label);
    expect(labels).toEqual(["create the job", "bind the dispute policy", "set the agreed price", "approve the kernel to escrow the price", "lock the price into escrow"]);
  });
});

describe("the composed job description anchors the signed quote", () => {
  it("carries the task and the verbatim proof under the kernel's cap", () => {
    const text = jobDescription("plan a grid ladder", QUOTE);
    expect(text).toContain("plan a grid ladder");
    expect(text).toContain(QUOTE.negotiationHash);
    expect(text).toContain(QUOTE.providerSig);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(4096);
  });

  it("cuts the task before it ever cuts the proof", () => {
    const long = "x".repeat(6000);
    const text = jobDescription(long, QUOTE);
    expect(text).toContain("[task cut to fit]");
    expect(text).toContain(QUOTE.providerSig);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(4096);
  });
});

describe("the reads the fund step sits on", () => {
  function word(value: bigint | number): string {
    return value.toString(16).padStart(64, "0");
  }
  it("calls the kernel counter, the policy window and the token balance", () => {
    expect(encodeJobCounter()).toBe(encodeFunctionData({ abi: [{ name: "jobCounter", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const, functionName: "jobCounter" }));
    expect(encodeDisputeWindow()).toBe(encodeFunctionData({ abi: [{ name: "disputeWindow", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] }] as const, functionName: "disputeWindow" }));
    expect(encodeBalanceOf(INPUT.provider)).toContain("70a08231");
  });

  it("decodes a live getJob answer with the string field present", () => {
    // an empty-string job tuple: outer offset, then id, client, provider,
    // evaluator, inner string offset (0xa0), budget, expiry, status, hook
    const words = [
      "20".padStart(64, "0"),
      word(INPUT.jobId),
      word(0n),
      word(BigInt(INPUT.provider.toLowerCase())),
      word(0n),
      "a0".padStart(64, "0"),
      word(INPUT.budgetRaw),
      word(INPUT.expiredAt),
      word(1),
      word(0n),
    ];
    const decoded = decodeGetJob(`0x${words.join("")}`);
    expect(decoded).toEqual({ provider: INPUT.provider.toLowerCase(), budget: INPUT.budgetRaw, status: 1 });
  });

  it("decodes a short or empty read as nothing", () => {
    expect(decodeGetJob("0x")).toBeNull();
    expect(decodeGetJob(`0x${"0".repeat(640)}`)).toBeNull();
  });
});

describe("the job status names follow the kernel's enum", () => {
  it("names the six states and refuses an unknown code", () => {
    expect(jobStatusName(0)).toBe("Open");
    expect(jobStatusName(1)).toBe("Funded");
    expect(jobStatusName(2)).toBe("Submitted");
    expect(jobStatusName(3)).toBe("Completed");
    expect(jobStatusName(4)).toBe("Rejected");
    expect(jobStatusName(5)).toBe("Expired");
    expect(jobStatusName(9)).toBe("Unknown");
  });

  it("decodes a getJob answer short of its fields as nothing", () => {
    expect(decodeGetJob("0x")).toBeNull();
    expect(encodeGetJob(1n).length).toBeGreaterThan(20);
  });
});
