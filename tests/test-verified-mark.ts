import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkMark, decideMark, markMessage, MARK_TTL_SECONDS, signMark } from "../src/lib/verified-mark";

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const base = { status: "online", delisted: false, house: false, hosted: false };

describe("who earns the mark", () => {
  it("lists an answering agent but marks it only after a paid delivery", () => {
    expect(decideMark(base)).toEqual({ verified: false, reason: "answering, but no paid delivery has been observed yet" });
    expect(decideMark({ ...base, status: "delivered" })).toMatchObject({ verified: true, basis: "delivered" });
  });

  it("marks our own agents and builder-hosted agents once they answer", () => {
    expect(decideMark({ ...base, house: true })).toMatchObject({ verified: true, basis: "house" });
    expect(decideMark({ ...base, hosted: true })).toMatchObject({ verified: true, basis: "hosted" });
  });

  it("never marks a delisted, failing or unchecked agent, even one of ours", () => {
    expect(decideMark({ ...base, house: true, delisted: true })).toEqual({ verified: false, reason: "the listing is delisted" });
    expect(decideMark({ ...base, house: true, status: "unresponsive" })).toEqual({ verified: false, reason: "the last check reads unresponsive" });
    expect(decideMark({ ...base, status: null })).toEqual({ verified: false, reason: "the agent has not been checked yet" });
  });
});

describe("the signed mark", () => {
  const key = generatePrivateKey();
  const attestor = privateKeyToAccount(key).address;
  const now = 1_800_000_000;
  const message = markMessage(REGISTRY, "404603", "house", now);

  it("checks out for the published attestor until it expires", async () => {
    const { signer, signature } = await signMark(key, 56, message);
    expect(signer).toBe(attestor);
    expect(message.expiresAt - message.issuedAt).toBe(BigInt(MARK_TTL_SECONDS));
    expect(await checkMark(56, message, signature, attestor, now + 60)).toBe(true);
    expect(await checkMark(56, message, signature, attestor, now + MARK_TTL_SECONDS)).toBe(false);
  });

  it("fails for another signer, another chain or an altered agent", async () => {
    const { signature } = await signMark(key, 56, message);
    const stranger = privateKeyToAccount(generatePrivateKey()).address;
    expect(await checkMark(56, message, signature, stranger, now)).toBe(false);
    expect(await checkMark(97, message, signature, attestor, now)).toBe(false);
    expect(await checkMark(56, { ...message, tokenId: 1n }, signature, attestor, now)).toBe(false);
  });
});
