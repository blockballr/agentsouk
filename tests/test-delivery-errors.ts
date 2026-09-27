// A failed agent delivery once reached the hirer as a raw parse error or a viem dump; these
// pin deliveryErrorText so every failure becomes a named, actionable sentence that never implies success.
import { describe, expect, it } from "vitest";
import { deliveryErrorText } from "../apps/web/src/lib/hire";

// every translated failure stays free of machine detail and never claims the task landed
function expectHonestFailure(text: string) {
  expect(text).not.toMatch(/0x[0-9a-f]{4,}/i);
  expect(text).not.toMatch(/viem/i);
  expect(text).not.toMatch(/\bjson\b/i);
  expect(text).not.toMatch(/unexpected end of json/i);
  expect(text).not.toMatch(
    /successfully delivered|was delivered|has been delivered|delivery (succeeded|complete)|task (was|is) delivered/i,
  );
}

describe("delivery error messages", () => {
  it("names a private or loopback endpoint the API refused, with the address and the fix", () => {
    const raw =
      '"http://localhost:8080/" is a private address that the marketplace cannot reach. ' +
      "the agent's card names it as the messaging url, so the owner needs to publish a public one.";
    const text = deliveryErrorText(new Error(raw));
    expect(text).toContain("http://localhost:8080/");
    expect(text).toMatch(/private address/i);
    expect(text).toMatch(/owner needs to publish a public/i);
    expect(text).toMatch(/nothing is reported as delivered/i);
    expectHonestFailure(text);
  });

  it("keeps the named address when the MCP registry record is the one that carries it", () => {
    const raw =
      '"http://10.0.0.5/rpc" is a private address that the marketplace cannot reach. ' +
      "the agent's registry record points there, so the owner needs to publish a public endpoint.";
    const text = deliveryErrorText(new Error(raw));
    expect(text).toContain("http://10.0.0.5/rpc");
    expect(text).toMatch(/private address/i);
    expectHonestFailure(text);
  });

  it("translates the malformed and non http url refusals", () => {
    const malformed = deliveryErrorText(new Error('"not a url" is not a valid url'));
    expect(malformed).toContain("not a url");
    expect(malformed).toMatch(/not a valid url/i);
    expectHonestFailure(malformed);

    const nonHttp = deliveryErrorText(new Error('"ftp://example.com/x" is not an http url'));
    expect(nonHttp).toContain("ftp://example.com/x");
    expect(nonHttp).toMatch(/not a public http address/i);
    expectHonestFailure(nonHttp);
  });

  it("explains a refused or timed out endpoint as unreachable, never as delivered", () => {
    const cases = [
      "fetch failed",
      "ECONNREFUSED",
      "request failed: connect ECONNREFUSED 127.0.0.1:8080",
      "deliver returned 504: the marketplace timed out reaching the agent, try again",
    ];
    for (const raw of cases) {
      const text = deliveryErrorText(new Error(raw));
      expect(text, raw).toMatch(/could not reach this agent's endpoint/i);
      expect(text, raw).toMatch(/nothing is reported as delivered/i);
      expectHonestFailure(text);
    }
  });

  it("explains the raw body and empty-body parse errors that started this bug", () => {
    const cases = [
      "Failed to execute 'json' on 'Response': Unexpected end of JSON input",
      "deliver returned 502 with no readable answer",
    ];
    for (const raw of cases) {
      const text = deliveryErrorText(new Error(raw));
      expect(text, raw).toMatch(/could not read a result/i);
      expect(text, raw).toMatch(/nothing is reported as delivered/i);
      expectHonestFailure(text);
    }
  });

  it("passes a short honest server sentence through unchanged", () => {
    const raw = "No settled session for this payment id. Hire the agent first.";
    const text = deliveryErrorText(new Error(raw));
    expect(text).toBe(raw);
    expectHonestFailure(text);
  });

  it("replaces a payment-flavoured fallback with a delivery one", () => {
    const text = deliveryErrorText(new Error("a".repeat(400)));
    expect(text).toMatch(/the task could not be delivered/i);
    expect(text).not.toMatch(/payment/i);
    expectHonestFailure(text);
  });
});
