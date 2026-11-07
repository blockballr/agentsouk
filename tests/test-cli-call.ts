// The call and listing helpers decide what the CLI will talk to and how it reads
// an A2A answer, so both are pinned without a network.
import { describe, expect, it } from "vitest";
import { assertCallableEndpoint, textFromResult } from "../packages/cli/src/marketplace/call";
import { cardUrlFor, validateDraft } from "../packages/cli/src/marketplace/listing";
import { agentIdFromReceipt } from "../packages/cli/src/marketplace/register";
import { ratingMessage } from "../packages/cli/src/marketplace/ratings";
import { listingControlMessage } from "../packages/cli/src/marketplace/control";
import { descriptionWithProof, hireCalls, type HirePlan } from "../packages/cli/src/marketplace/hire";
import { findTransfer, verdict, type Check } from "../packages/cli/src/marketplace/receipt";

describe("endpoint validation", () => {
  it("accepts https", () => {
    expect(() => assertCallableEndpoint("https://api.example.test/a2a")).not.toThrow();
  });

  it("accepts http only on localhost", () => {
    expect(() => assertCallableEndpoint("http://localhost:3000/a2a")).not.toThrow();
    expect(() => assertCallableEndpoint("http://127.0.0.1:3000/a2a")).not.toThrow();
  });

  it("refuses plain http in public", () => {
    expect(() => assertCallableEndpoint("http://api.example.test/a2a")).toThrow(/https/);
  });

  it("refuses something that is not a URL", () => {
    expect(() => assertCallableEndpoint("not a url")).toThrow(/not a URL/);
  });
});

describe("A2A result reading", () => {
  it("collects text from a task status message and an artifact", () => {
    const result = {
      task: {
        status: { message: { parts: [{ text: "first" }] } },
        artifacts: [{ parts: [{ text: "second" }] }],
      },
    };
    expect(textFromResult(result)).toBe("first\nsecond");
  });

  it("returns nothing for an empty result", () => {
    expect(textFromResult(null)).toBe("");
    expect(textFromResult({})).toBe("");
  });
});

describe("listing helpers", () => {
  it("derives the card from an A2A url", () => {
    expect(cardUrlFor("https://agent.example.test/a2a")).toBe("https://agent.example.test/.well-known/agent-card.json");
  });

  it("leaves a card url alone", () => {
    expect(cardUrlFor("https://agent.example.test/card.json")).toBe("https://agent.example.test/card.json");
  });

  it("refuses a draft that is missing the contract fields", () => {
    const errors = validateDraft({});
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("registration receipt", () => {
  const registry = "0x" + "ab".repeat(20);
  const owner = "0x" + "11".repeat(20);
  const transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const topic = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;

  it("reads the minted id from the transfer to the owner", () => {
    const receipt = {
      logs: [
        {
          address: registry,
          topics: [transfer, topic("0x" + "00".repeat(20)), topic(owner), `0x${(42).toString(16).padStart(64, "0")}`],
        },
      ],
    } as never;
    expect(agentIdFromReceipt(receipt, registry, owner)).toBe("42");
  });

  it("ignores a transfer to another address or another contract", () => {
    const wrongOwner = {
      logs: [
        {
          address: registry,
          topics: [transfer, topic(owner), topic("0x" + "22".repeat(20)), `0x${"1".padStart(64, "0")}`],
        },
      ],
    } as never;
    expect(agentIdFromReceipt(wrongOwner, registry, owner)).toBeNull();

    const wrongContract = {
      logs: [
        {
          address: "0x" + "cd".repeat(20),
          topics: [transfer, topic(owner), topic(owner), `0x${"1".padStart(64, "0")}`],
        },
      ],
    } as never;
    expect(agentIdFromReceipt(wrongContract, registry, owner)).toBeNull();
  });
});

describe("signed messages", () => {
  it("builds the rating message the route verifies", () => {
    expect(
      ratingMessage({ chainId: 56, tokenId: "404603", paymentId: "pay_1", score: 5, comment: "good", verifierScore: 0 }),
    ).toBe(
      "Agent Souk rating\nchainId: 56\ntokenId: 404603\npaymentId: pay_1\nscore: 5\ncomment: good\nverifierScore: 0",
    );
  });

  it("builds the listing control message with a lower-case owner", () => {
    const message = listingControlMessage(56, "376435", "0x2222222222222222222222222222222222222222", "delist");
    expect(message).toContain("owner: 0x2222222222222222222222222222222222222222");
    expect(message).toContain("action: delist");
  });
});

describe("escrow hire plan", () => {
  const quote = {
    quote: {
      price: "50000000000000000",
      currency: "0xcE24439F2D9C6a2289F741120FE202248B666666",
      providerAddress: "0x84FEDaBd1B83443Ad86796C15619494878B64180",
      validUntil: 1793999340,
      envelope: { provider_sig: "0xsig", negotiation_hash: "0xhash" },
    },
  } as never;

  it("carries the signed quote with the task", () => {
    const text = descriptionWithProof("read my health factor", quote);
    expect(text).toContain("read my health factor");
    expect(text).toContain("signed quote:");
    expect(text).toContain("0xsig");
  });

  it("cuts a long task to fit the kernel's description bound", () => {
    const text = descriptionWithProof("x".repeat(6000), quote);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(4096);
    expect(text).toContain("[task cut to fit]");
  });

  it("builds the five calls in order", () => {
    const plan = {
      commerce: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6",
      router: "0x51895229E12F9876011789B04f8698af06cCD6DA",
      policy: "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5",
      currency: "0xcE24439F2D9C6a2289F741120FE202248B666666",
      provider: "0x84FEDaBd1B83443Ad86796C15619494878B64180",
      expiredAt: 1n,
      description: "task",
      price: 1n,
      jobId: 1n,
    } as HirePlan;
    const calls = hireCalls(plan);
    expect(calls.map((call) => call.label)).toEqual([
      "create the job",
      "bind the dispute policy",
      "set the agreed price",
      "approve the price",
      "lock the price into escrow",
    ]);
    expect(calls[1].to).toBe(plan.router);
    expect(calls[3].to).toBe(plan.currency);
  });
});

describe("receipt verification", () => {
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const pad = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;
  const token = "0x" + "33".repeat(20);
  const payer = "0x" + "11".repeat(20);
  const payee = "0x" + "22".repeat(20);
  const amount = 50000000000000000n;

  it("finds the transfer that carries the payment", () => {
    const logs = [
      { address: token, topics: [transferTopic, pad(payer), pad(payee)], data: "0x" + amount.toString(16).padStart(64, "0") },
    ];
    const hit = findTransfer(logs, payer, payee, amount);
    expect(hit?.token).toBe(token);
    expect(hit?.value).toBe(amount);
  });

  it("ignores a transfer of the wrong amount or between other wallets", () => {
    const wrongAmount = [
      { address: token, topics: [transferTopic, pad(payer), pad(payee)], data: "0x" + "1".padStart(64, "0") },
    ];
    expect(findTransfer(wrongAmount, payer, payee, amount)).toBeNull();
    const wrongPair = [
      { address: token, topics: [transferTopic, pad(payee), pad(payer)], data: "0x" + amount.toString(16).padStart(64, "0") },
    ];
    expect(findTransfer(wrongPair, payer, payee, amount)).toBeNull();
  });

  it("turns the checks into one outcome", () => {
    const good: Check[] = [{ name: "status", ok: true, expected: "success", observed: "success" }];
    expect(verdict(good)).toBe("verified");
    expect(verdict([...good, { name: "payer", ok: false, expected: "a", observed: "b" }])).toBe("mismatch");
    expect(verdict([...good, { name: "chain", ok: null, expected: "a", observed: "b" }])).toBe("unverifiable");
  });
});
