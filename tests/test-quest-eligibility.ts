// An agent earns a place in the quest's picks only when a job has been seen to complete on it.
import { describe, expect, it } from "vitest";
import { asksForSecrets, hasConfirmedCompletion } from "../src/lib/quest-eligibility";

const OWNER = "0x84FEdabd1b83443ad86796c15619494878b64180";
const BUYER = "0x250957fd89b82c46208fc041ee0d8c99c5e62247";
const PROVIDER = "0xdf1074aa00000000000000000000000000aafe00";
const isProbe = (paymentId: string) => paymentId.startsWith("verify_");

const RELAYED = [
  { status: "Funded", by: BUYER },
  { status: "Submitted", by: "marketplace" },
  { status: "Completed", by: BUYER },
];

function job(
  over: Partial<{ status: string; client: string; provider: string; paymentId?: string; history: { status: string; by: string }[] }> = {},
) {
  return { status: "Completed", client: BUYER, provider: PROVIDER, paymentId: "req_0x1", history: RELAYED, ...over };
}

describe("a confirmed completion", () => {
  it("is a completed, paid job from someone other than the owner", () => {
    expect(hasConfirmedCompletion([job()], OWNER, isProbe)).toBe(true);
  });

  it("needs the job to have completed", () => {
    for (const status of ["Open", "Funded", "Submitted", "Rejected", "Expired"]) {
      expect(hasConfirmedCompletion([job({ status })], OWNER, isProbe)).toBe(false);
    }
  });

  it("does not count the verifier's probes or an unpaid job", () => {
    expect(hasConfirmedCompletion([job({ paymentId: "verify_17a7fc3cbe5b" })], OWNER, isProbe)).toBe(false);
    expect(hasConfirmedCompletion([job({ paymentId: undefined })], OWNER, isProbe)).toBe(false);
  });

  it("does not count the owner or the agent's own wallet hiring it", () => {
    expect(hasConfirmedCompletion([job({ client: OWNER.toLowerCase() })], OWNER, isProbe)).toBe(false);
    expect(hasConfirmedCompletion([job({ client: PROVIDER.toUpperCase().replace("0X", "0x") })], OWNER, isProbe)).toBe(false);
  });

  it("needs the marketplace to have recorded the deliverable, not the provider by hand", () => {
    const byHand = [{ status: "Funded", by: BUYER }, { status: "Submitted", by: PROVIDER }, { status: "Completed", by: BUYER }];
    expect(hasConfirmedCompletion([job({ history: byHand })], OWNER, isProbe)).toBe(false);
    expect(hasConfirmedCompletion([job({ history: [] })], OWNER, isProbe)).toBe(false);
  });

  it("is found among other jobs, and absent when there are none", () => {
    expect(hasConfirmedCompletion([job({ status: "Funded" }), job({ client: OWNER }), job()], OWNER, isProbe)).toBe(true);
    expect(hasConfirmedCompletion([], OWNER, isProbe)).toBe(false);
  });
});

describe("a reply that asks for a wallet's secret", () => {
  it("is caught whatever the wording", () => {
    expect(asksForSecrets('{"message":"Send them as metadata (rpcUrl, account, accountPrivateKey)"}')).toBe(true);
    expect(asksForSecrets("or in a data part (rpc_url, account, account_private_key)")).toBe(true);
    expect(asksForSecrets("Please share your seed phrase to continue")).toBe(true);
    expect(asksForSecrets("paste your mnemonic")).toBe(true);
  });

  it("leaves an ordinary answer alone", () => {
    expect(asksForSecrets("Health factor 1.6 for collateral 1000 USD and debt 500 USD.")).toBe(false);
    expect(asksForSecrets("")).toBe(false);
    expect(asksForSecrets(null)).toBe(false);
  });
});
