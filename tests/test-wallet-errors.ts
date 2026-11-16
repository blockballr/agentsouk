import { describe, expect, it } from "vitest";
import { walletErrorText } from "../apps/web/src/lib/wallet-errors";

describe("wallet errors in plain words", () => {
  it("names a refusal, a pending request, a missing wallet and a silent one", () => {
    expect(walletErrorText({ code: 4001, message: "User rejected the request." })).toMatch(/^You declined/);
    expect(walletErrorText({ code: -32002, message: "Request already pending" })).toMatch(/already has a request waiting/);
    expect(walletErrorText(new Error("No wallet found. Install MetaMask or Binance Wallet to hire agents."))).toMatch(/^No wallet was found/);
    expect(walletErrorText(new Error("we reached no wallet: check the wallet popup or click connect again"))).toMatch(/did not answer/);
  });

  it("says the extension stopped when the channel to it is gone", () => {
    expect(walletErrorText(new Error("Could not establish connection. Receiving end does not exist."))).toMatch(/stopped responding/);
  });

  it("falls back to a next step for anything else, including no error object", () => {
    expect(walletErrorText(new Error("something odd"))).toMatch(/could not connect/);
    expect(walletErrorText(null)).toMatch(/could not connect/);
  });
});
