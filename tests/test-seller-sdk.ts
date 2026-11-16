import { describe, expect, it } from "vitest";
import { verifyMessage, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildDeliverable,
  handleSellerParts,
  memoryManifestStore,
  negotiationHashOf,
  quoteEnvelope,
  verifyNotify,
  type KernelJob,
  type SellerConfig,
} from "../packages/seller-sdk/src/index";
import {
  deliverableManifest as serverManifest,
  negotiationHashOf as serverHashOf,
} from "../src/lib/seller8183";

const KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";
const WALLET = privateKeyToAccount(KEY).address;
const OTHER = privateKeyToAccount(`0x${"22".repeat(32)}`).address;
const TASK = "Compute the health factor for collateral 1000 and debt 500";

const cfg: SellerConfig = {
  chainId: 97,
  providerWallet: WALLET,
  sellerKey: KEY,
  agentId: 2504,
  agentName: "Example seller",
  price: 2,
  deliverableUrl: (jobId) => `https://seller.example/deliverable/${jobId}`,
};

const negotiate = { kind: "data", data: { skill: "negotiate", task_description: TASK, terms: { deliverables: "the answer" } } };
const notify = (jobId: unknown) => ({ kind: "data", data: { skill: "notify_funded", job_id: jobId } });
const job = (over: Partial<KernelJob> = {}): KernelJob => ({
  client: OTHER,
  provider: WALLET,
  description: TASK,
  budget: 2n * 10n ** 18n,
  expiredAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  status: 1,
  ...over,
});

describe("seller sdk: the quote", () => {
  it("signs a price the buyer can verify from the quote alone", async () => {
    const quote = await quoteEnvelope(cfg, negotiate.data);
    if (!quote.ok) throw new Error(quote.unsigned_reason);
    const e = quote.envelope;
    expect(e.price).toBe((2n * 10n ** 18n).toString());
    expect(e.provider_address).toBe(WALLET);
    const hash = negotiationHashOf({
      task: TASK,
      terms: negotiate.data.terms,
      provider: WALLET,
      currency: e.currency,
      price: e.price,
      validUntil: e.valid_until,
      agentId: 2504,
    });
    expect(e.negotiation_hash).toBe(hash);
    expect(await verifyMessage({ address: WALLET, message: { raw: toBytes(hash) }, signature: e.provider_sig as `0x${string}` })).toBe(true);
  });

  it("hashes a negotiation exactly as the marketplace does", () => {
    const input = { task: TASK, terms: { a: 1 }, provider: WALLET, currency: OTHER, price: "5", validUntil: 1_800_000_000, agentId: 7 };
    expect(negotiationHashOf(input)).toBe(serverHashOf(input));
    expect(negotiationHashOf({ ...input, terms: null, agentId: null })).toBe(serverHashOf({ ...input, terms: null, agentId: null }));
  });

  it("lets the seller price per task or turn a task down", async () => {
    const priced = await quoteEnvelope({ ...cfg, price: (task) => task.length / 100 }, negotiate.data);
    expect(priced.ok && priced.envelope.fee_usd).toBe(TASK.length / 100);
    const declined = await quoteEnvelope({ ...cfg, price: () => ({ refuse: "not a task this agent does" }) }, negotiate.data);
    expect(declined).toEqual({ ok: false, status: "refused", unsigned_reason: "not a task this agent does" });
  });

  it("answers unsigned without a key and refuses a key for another wallet", async () => {
    const unsigned = await quoteEnvelope({ ...cfg, sellerKey: undefined }, negotiate.data);
    expect(unsigned.ok === false && unsigned.status).toBe("unsigned");
    const wrong = await quoteEnvelope({ ...cfg, providerWallet: OTHER }, negotiate.data);
    expect(wrong.ok === false && wrong.status).toBe("refused");
  });
});

describe("seller sdk: the funded job", () => {
  it("works only a job the kernel says is funded and ours", async () => {
    expect((await verifyNotify(cfg, { job_id: 9 }, async () => job())).ok).toBe(true);
    expect((await verifyNotify(cfg, { job_id: 9 }, async () => job({ provider: OTHER }))).ok).toBe(false);
    expect((await verifyNotify(cfg, { job_id: 9 }, async () => job({ status: 0 }))).ok).toBe(false);
    expect((await verifyNotify(cfg, { job_id: 9 }, async () => null)).ok).toBe(false);
    expect((await verifyNotify(cfg, { job_id: "nine" }, async () => job())).ok).toBe(false);
  });

  it("builds the same deliverable hash the marketplace builds", () => {
    const answer = { content: "2.0", contentType: "text/plain", metadata: { agent: "Example seller" } };
    const ours = buildDeliverable(cfg, 9n, answer);
    const theirs = serverManifest(9n, 97, answer);
    expect(ours.deliverable).toBe(theirs.deliverable);
    expect(ours.manifestText).toBe(theirs.manifestText);
    expect(ours.deliverableUrl).toBe("https://seller.example/deliverable/9");
  });
});

describe("seller sdk: one entry point", () => {
  const store = memoryManifestStore();
  const hooks = {
    store,
    work: () => ({ content: "2.0", contentType: "text/plain" }),
    readJob: async () => job(),
    submit: async () => ({ ok: true as const, txHash: "0xabc", deliverableUrl: "https://seller.example/deliverable/9" }),
  };

  it("quotes a negotiate part", async () => {
    const reply = await handleSellerParts(cfg, [{ kind: "text", text: "hello" }, negotiate], hooks);
    expect(reply.kind).toBe("quote");
    expect(reply.envelope?.status).toBe("quoted");
  });

  it("works and acknowledges a funded job", async () => {
    const reply = await handleSellerParts(cfg, [notify(9)], hooks);
    expect(reply.kind).toBe("ack");
    expect(reply.envelope).toMatchObject({ status: "acknowledged", job_id: "9", submit_tx: "0xabc" });
  });

  it("does no work for a job the kernel does not back", async () => {
    let worked = false;
    const reply = await handleSellerParts(cfg, [notify(9)], {
      ...hooks,
      readJob: async () => job({ status: 0 }),
      work: () => {
        worked = true;
        return { content: "x", contentType: "text/plain" };
      },
    });
    expect(reply.kind).toBe("refused");
    expect(worked).toBe(false);
  });

  it("falls through for an ordinary message", async () => {
    expect(await handleSellerParts(cfg, [{ kind: "text", text: "hello" }], hooks)).toEqual({ kind: "none", envelope: null });
    expect((await handleSellerParts(cfg, "not parts", hooks)).kind).toBe("none");
  });
});
