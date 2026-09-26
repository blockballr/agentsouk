// The hire panel once showed a raw viem dump; these pin the plain-English replacements so a
// failure a user can act on cannot regress into a stack trace.
import { describe, expect, it } from "vitest";
import { hireErrorText } from "../apps/web/src/lib/hire";

const viemDump = (extra = "") =>
  `Execution reverted with reason:\n0xe450d38c00000000000000000000000084fedabd1b83443ad86796c15619494878b6418000000\n` +
  `Request Arguments: from:\n0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4\n` +
  `to:\n0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53\ndata:\n0x3ee160e0\n` +
  `Details: execution reverted: 0xe450d38c${extra}\nVersion: viem@2.56.3`;

describe("hire error messages", () => {
  it("never leaks a hex selector, call arguments or a library version", () => {
    const text = hireErrorText(new Error(viemDump()));
    expect(text).not.toMatch(/0x[0-9a-f]{8,}/i);
    expect(text).not.toMatch(/viem/i);
    expect(text).not.toMatch(/version:/i);
    expect(text).not.toMatch(/Request Arguments/i);
  });

  it("names the cause in plain English", () => {
    expect(hireErrorText(new Error(viemDump()))).toMatch(/not have enough sUSD/i);
  });

  it("translates each revert our own token can raise", () => {
    const cases: [string, RegExp][] = [
      ["0xfb8f41b2", /approved enough/i],
      ["0x10761275", /expired/i],
      ["0xc6eeaf81", /not valid yet/i],
      ["0x9c87612c", /already completed/i],
      ["0x3e3ef59c", /signature did not match/i],
    ];
    for (const [selector, expected] of cases) {
      expect(hireErrorText(new Error(`execution reverted: ${selector}`))).toMatch(expected);
    }
  });

  it("distinguishes a cancelled signature from a failure, and says nothing was charged", () => {
    expect(hireErrorText({ code: 4001, message: "User rejected" })).toMatch(/nothing was charged/i);
    expect(hireErrorText(new Error("User denied transaction signature"))).toMatch(
      /nothing was charged/i,
    );
  });

  it("explains a gas problem in BNB rather than in wei", () => {
    expect(hireErrorText(new Error("insufficient funds for gas * price + value"))).toMatch(/BNB/i);
  });

  it("explains a connectivity problem as such", () => {
    expect(hireErrorText(new Error("fetch failed"))).toMatch(/could not reach BSC/i);
  });

  it("falls back to a plain sentence rather than passing a stack trace through", () => {
    const text = hireErrorText(new Error("a".repeat(400) + " 0xdeadbeef viem@2"));
    expect(text).toMatch(/could not be completed/i);
    expect(text.length).toBeLessThan(120);
  });

  it("does not tell someone on the wrong chain to check their connection", () => {
    const text = hireErrorText(new Error("Wallet is not on BSC, switch networks and retry."));
    expect(text).not.toMatch(/connection/i);
    expect(text).toMatch(/network/i);
  });

  it("still returns a short original message that is already plain English", () => {
    expect(hireErrorText(new Error("No wallet found. Install a wallet to hire agents."))).toBe(
      "No wallet found. Install a wallet to hire agents.",
    );
  });
});
