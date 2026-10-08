import { describe, expect, it } from "vitest";
import { keccak256, stringToHex, verifyMessage, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  deliverableManifest,
  isNegotiateData,
  isNotifyData,
  negotiationHashOf,
  quoteEnvelope,
  sellerConfigFromEnv,
  sellerHook,
  verifyNotify,
  type QuoteEnvelope,
} from "../src/lib/seller8183";

const KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";
const WALLET = privateKeyToAccount(KEY).address;
const OTHER = privateKeyToAccount("0x" + "22".repeat(32)).address;

const cfg = sellerConfigFromEnv(97, 2504, "Souk Health Guard");
const liveCfg = { ...cfg, providerWallet: WALLET, sellerKey: KEY };

const negotiatePart = {
  kind: "data",
  data: {
    skill: "negotiate",
    task_description: "Compute the health factor for collateral 1000 and debt 500",
    terms: { deliverables: "the task's answer as the job's deliverable" },
  },
};

const notifyPart = (jobId: number | string) => ({ kind: "data", data: { skill: "notify_funded", job_id: jobId } });

// the kernel row the chain would answer a notify with: Funded, ours
const fundedJob = (provider = WALLET, status = 1) => ({
  client: OTHER,
  provider,
  evaluator: OTHER,
  description: "Compute the health factor for collateral 1000 and debt 500",
  budget: 2n * 10n ** 18n,
  expiredAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  status,
});

const kernelReader = (provider: string, status = 1) => async () => fundedJob(provider, status);

describe("seller8183: skill recognition", () => {
  it("sees the two protocol steps and nothing else", () => {
    expect(isNegotiateData({ skill: "negotiate" })).toBe(true);
    expect(isNegotiateData({ skill: "negotiate-erc8183-job" })).toBe(true);
    expect(isNegotiateData({ skill: "notify_funded" })).toBe(false);
    expect(isNotifyData({ skill: "notify_funded", job_id: 7 })).toBe(true);
    expect(isNotifyData({ skill: "compute-health-factor" })).toBe(false);
    expect(isNegotiateData(null)).toBe(false);
  });
});

describe("seller8183: the signed quote", () => {
  it("hashes deterministically and the signature verifies against the provider", async () => {
    const res = await quoteEnvelope(liveCfg, negotiatePart.data);
    expect(res.ok).toBe(true);
    const envelope = (res as { ok: true; envelope: QuoteEnvelope }).envelope;
    expect(envelope.status).toBe("quoted");
    expect(envelope.price).toBe((2n * 10n ** 18n).toString());
    expect(envelope.currency.toLowerCase()).toBe("0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565");
    expect(envelope.provider_address.toLowerCase()).toBe(WALLET.toLowerCase());
    expect(envelope.agent_id).toBe(2504);

    const recomputed = negotiationHashOf({
      task: negotiatePart.data.task_description as string,
      terms: negotiatePart.data.terms,
      provider: WALLET,
      currency: envelope.currency,
      price: envelope.price,
      validUntil: envelope.valid_until,
      agentId: 2504,
    });
    expect(recomputed).toBe(envelope.negotiation_hash);
    const verified = await verifyMessage({
      address: WALLET,
      message: { raw: toBytes(recomputed) },
      signature: envelope.provider_sig as `0x${string}`,
    });
    expect(verified).toBe(true);
  });

  it("refuses a quote whose key does not control the registered wallet", async () => {
    const res = await quoteEnvelope({ ...liveCfg, sellerKey: "0x" + "22".repeat(32) }, negotiatePart.data);
    expect(res.ok).toBe(false);
    expect((res as { status: string }).status).toBe("refused");
    expect((res as { unsigned_reason: string }).unsigned_reason).toContain(OTHER);
  });

  it("answers unsigned, with its reason, when no key is configured", async () => {
    const res = await quoteEnvelope({ ...liveCfg, sellerKey: undefined }, negotiatePart.data);
    expect(res.ok).toBe(false);
    expect((res as { status: string }).status).toBe("unsigned");
    expect((res as { unsigned_reason: string }).unsigned_reason).toContain("quote key");
  });

  it("refuses a negotiate step without a task description", async () => {
    const res = await quoteEnvelope(liveCfg, { skill: "negotiate" });
    expect(res.ok).toBe(false);
    expect((res as { status: string }).status).toBe("refused");
  });
});

describe("seller8183: the notify step reads the chain's own row", () => {
  it("acks a funded job that names this listing as provider", async () => {
    const res = await verifyNotify(liveCfg, { skill: "notify_funded", job_id: 11 }, kernelReader(WALLET));
    expect(res.ok).toBe(true);
    expect((res as { jobId: bigint }).jobId).toBe(11n);
  });

  it("refuses a job whose provider is someone else", async () => {
    const res = await verifyNotify(liveCfg, { skill: "notify_funded", job_id: 11 }, kernelReader(OTHER));
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toContain("provider");
  });

  it("refuses a job that is not Funded", async () => {
    const res = await verifyNotify(liveCfg, { skill: "notify_funded", job_id: 11 }, kernelReader(WALLET, 2));
    expect(res.ok).toBe(false);
    expect((res as { reason: string }).reason).toContain("not Funded");
  });

  it("refuses a job_id that is not a number", async () => {
    const res = await verifyNotify(liveCfg, { skill: "notify_funded", job_id: "nonsense" }, kernelReader(WALLET));
    expect(res.ok).toBe(false);
  });
});

describe("seller8183: the deliverable manifest", () => {
  it("builds the v1 shape, hashes it, and derives the serving url", () => {
    const built = deliverableManifest(11n, 97, { content: "health factor 2.0", contentType: "text/plain", metadata: {} });
    expect(built.manifest.version).toBe(1);
    expect(built.manifest.job_id).toBe(11);
    expect(built.manifest.chain_id).toBe(97);
    expect(built.deliverable).toBe(keccak256(stringToHex(built.manifestText)));
    expect(built.deliverableUrl).toContain("/api/house-agent/deliverable/11");
    const optParams = JSON.parse(
      Buffer.from(built.optParams.slice(2), "hex").toString("utf8"),
    );
    expect(optParams.deliverable_url).toBe(built.deliverableUrl);
  });
});

describe("seller8183: one entry point for the a2a route", () => {
  it("answers a negotiate part with the quote envelope and leaves other parts alone", async () => {
    const handled = await sellerHook(liveCfg, [negotiatePart], () => ({ text: "unused" }), kernelReader(WALLET));
    expect(handled.kind).toBe("quote");
    expect((handled.envelope as { status: string }).status).toBe("quoted");

    const passthrough = await sellerHook(liveCfg, [{ kind: "text", text: "hello" }], () => ({ text: "x" }), kernelReader(WALLET));
    expect(passthrough.kind).toBe("none");
  });

  it("runs the work and reports an acknowledged submit on a funded job", async () => {
    const handled = await sellerHook(
      liveCfg,
      [notifyPart(11)],
      () => ({ text: "health factor 2.0" }),
      kernelReader(WALLET),
      // the unit run never broadcasts: the submit boundary is a stub here, and
      // the live shape is the e2e's own proof
      async () => ({ ok: true, txHash: "0x" + "ab".repeat(32), deliverableUrl: "https://api.agentsouk.xyz/api/house-agent/deliverable/11" }),
    );
    expect(handled.kind).toBe("ack");
    expect((handled.envelope as { status: string }).status).toBe("acknowledged");
    expect((handled.envelope as { submit_tx: string }).submit_tx).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("refuses, with the kernel's own row as the reason, when the job is not ours", async () => {
    const handled = await sellerHook(liveCfg, [notifyPart(11)], () => ({ text: "x" }), kernelReader(OTHER));
    expect(handled.kind).toBe("refused");
    expect((handled.envelope as { unsigned_reason: string }).unsigned_reason).toContain("provider");
  });
});

describe("seller8183: env config", () => {
  it("defaults the price to two and carries the agent name through", () => {
    expect(cfg.priceUsd).toBe(2);
    expect(cfg.agentName).toBe("Souk Health Guard");
    expect(cfg.agentId).toBe(2504);
  });
});
