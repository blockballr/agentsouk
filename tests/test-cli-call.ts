// The call and listing helpers decide what the CLI will talk to and how it reads
// an A2A answer, so both are pinned without a network.
import { describe, expect, it } from "vitest";
import { assertCallableEndpoint, textFromResult } from "../packages/cli/src/marketplace/call";
import { cardUrlFor, validateDraft } from "../packages/cli/src/marketplace/listing";

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
