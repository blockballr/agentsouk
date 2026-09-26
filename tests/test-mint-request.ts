// The sponsored mint replaces a wallet-sent transaction, so the message both sides sign is the
// contract between them; if these drift every mint fails with a signature mismatch.
import { describe, expect, it } from "vitest";
import { verifyMessage } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  isMintRequestExpired,
  MINT_REQUEST_DOMAIN,
  mintRequestMessage,
  validateMintRequest,
} from "../packages/core/src/mint-request";
import { mintRequestMessage as mintRequestMessageViaWebCopy } from "../apps/web/src/core";

const good = {
  // 40 hex characters, as a real address
  address: "0x84fedaBd1b83443aD86796C15619494878B64180",
  amount: "10000000000000000000",
  nonce: "1700000000-84fedaBd1",
  expires: 1700000900,
  signature: `0x${"ab".repeat(65)}`,
};

describe("mint request", () => {
  it("produces a stable message whose fields are all present", () => {
    const msg = mintRequestMessage({ ...good, address: good.address.toLowerCase() });
    expect(msg).toContain(MINT_REQUEST_DOMAIN);
    expect(msg).toContain("address: 0x84fedaBd1b83443aD86796C15619494878B64180".toLowerCase());
    expect(msg).toContain("amount: 10000000000000000000");
    expect(msg).toContain("nonce: 1700000000-84fedaBd1");
    expect(msg).toContain("expires: 1700000900");
  });

  it("is case insensitive on the address so signing and recovery agree", () => {
    const lower = mintRequestMessage({ ...good, address: good.address.toLowerCase() });
    const mixed = mintRequestMessage({ ...good, address: good.address });
    expect(lower).toBe(mixed);
  });

  it("binds every field, so changing any one of them changes the message", () => {
    const base = mintRequestMessage(good);
    expect(mintRequestMessage({ ...good, amount: "1" })).not.toBe(base);
    expect(mintRequestMessage({ ...good, nonce: "x" })).not.toBe(base);
    expect(mintRequestMessage({ ...good, expires: 1 })).not.toBe(base);
  });

  it("rejects an expired request and accepts a live one", () => {
    expect(isMintRequestExpired(good, 1700000899)).toBe(false);
    expect(isMintRequestExpired(good, 1700000900)).toBe(true);
    expect(isMintRequestExpired(good, 1700000901)).toBe(true);
  });

  it("treats a non numeric expiry as expired rather than valid", () => {
    expect(isMintRequestExpired({ ...good, expires: Number.NaN }, 1)).toBe(true);
  });

  it("accepts a well formed body", () => {
    expect(validateMintRequest(good).error).toBe("");
  });

  it("rejects a malformed address, amount, nonce, expiry or signature", () => {
    expect(validateMintRequest({ ...good, address: "0x123" }).error).toMatch(/address/);
    expect(validateMintRequest({ ...good, amount: "0" }).error).toMatch(/positive/);
    expect(validateMintRequest({ ...good, amount: "1.5" }).error).toMatch(/positive/);
    expect(validateMintRequest({ ...good, expires: "soon" }).error).toMatch(/expires/);
    expect(validateMintRequest({ ...good, signature: "nope" }).error).toMatch(/signature/);
  });

  it("accepts the nonce shape the client actually generates", () => {
    // timestamp-dash-address-prefix, which is what the browser builds
    const generated = `${Math.floor(Date.now() / 1000) + 900}-84fedaBd1`;
    expect(validateMintRequest({ ...good, nonce: generated }).error).toBe("");
  });

  it("rejects a nonce that could forge a second signed line", () => {
    // a newline would let one signature be reinterpreted as two different grants
    expect(validateMintRequest({ ...good, nonce: "abc\ndef" }).error).toMatch(/nonce/);
    expect(validateMintRequest({ ...good, nonce: "short" }).error).toMatch(/nonce/);
  });

  it("rejects an empty or missing body", () => {
    expect(validateMintRequest(null).error).toBeTruthy();
    expect(validateMintRequest({}).error).toBeTruthy();
  });

  it("produces identical bytes through the path the browser actually imports", () => {
    // the browser aliases @agora/core to its own copy, so the two entry points can drift silently
    // and every mint would fail with a mismatch that looks like a user cancelling
    expect(mintRequestMessageViaWebCopy(good)).toBe(mintRequestMessage(good));
  });

  it("round trips a real signature through the same builder", async () => {
    // a fresh key per run, not a hardcoded one: a committed well-known dev key reads as a leaked
    // credential to an auditor and this test never needs the same key twice
    const account = privateKeyToAccount(generatePrivateKey());
    const fields = { ...good, address: account.address.toLowerCase() };
    const signature = await account.signMessage({ message: mintRequestMessage(fields) });
    expect(
      await verifyMessage({
        address: account.address,
        message: mintRequestMessage(fields),
        signature,
      }),
    ).toBe(true);
    // any field changed after signing must fail
    expect(
      await verifyMessage({
        address: account.address,
        message: mintRequestMessage({ ...fields, amount: "20000000000000000000" }),
        signature,
      }),
    ).toBe(false);
  });
});
