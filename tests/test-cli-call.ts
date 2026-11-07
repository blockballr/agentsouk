// The call and listing helpers decide what the CLI will talk to and how it reads
// an A2A answer, so both are pinned without a network.
import { describe, expect, it } from "vitest";
import { assertCallableEndpoint, textFromResult } from "../packages/cli/src/marketplace/call";
import { cardUrlFor, validateDraft } from "../packages/cli/src/marketplace/listing";
import { agentIdFromReceipt } from "../packages/cli/src/marketplace/register";

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
