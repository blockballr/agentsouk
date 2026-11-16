import { parseUnits, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc8183Addresses } from "@altananetwork/sdk";
import { negotiationHashOf } from "./protocol.js";

export type Price = number | { refuse: string };

export interface SellerConfig {
  /** 56 for BNB Smart Chain, 97 for its testnet */
  chainId: number;
  /** the wallet your listing is registered with; the kernel pays it and takes submit only from it */
  providerWallet: string;
  /** the 0x private key of providerWallet; without it quotes come back unsigned */
  sellerKey: string | undefined;
  /** your ERC-8004 token id, or null before you are registered */
  agentId: number | null;
  agentName: string;
  /** the fee for one job in whole payment-token units, fixed or decided per task */
  price: number | ((task: string, data: Record<string, unknown>) => Price | Promise<Price>);
  /** where you serve the deliverable for a job id, byte for byte */
  deliverableUrl: (jobId: bigint) => string;
  /** how long a quote stays valid, in seconds; 1800 when unset */
  quoteTtlSeconds?: number;
  rpcUrl?: string;
}

export interface QuoteEnvelope {
  status: "quoted";
  price: string;
  currency: string;
  provider_address: string;
  valid_until: number;
  negotiation_hash: string;
  provider_sig: string;
  agent_id: number | null;
  fee_usd: number;
}

export type QuoteResult =
  | { ok: true; envelope: QuoteEnvelope }
  | { ok: false; status: "unsigned" | "refused"; unsigned_reason: string };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

const refused = (reason: string): QuoteResult => ({ ok: false, status: "refused", unsigned_reason: reason });

export function signerFor(cfg: SellerConfig) {
  if (!cfg.sellerKey || !KEY_RE.test(cfg.sellerKey)) return { ok: false as const, reason: "no seller key is configured" };
  const account = privateKeyToAccount(cfg.sellerKey as `0x${string}`);
  if (account.address.toLowerCase() !== cfg.providerWallet.toLowerCase()) {
    return { ok: false as const, reason: `the seller key controls ${account.address}, but the listing's wallet is ${cfg.providerWallet}` };
  }
  return { ok: true as const, account };
}

/** Answer a negotiate part with a signed price in the kernel's payment token. */
export async function quoteEnvelope(cfg: SellerConfig, negotiateData: Record<string, unknown>): Promise<QuoteResult> {
  let stack;
  try {
    stack = erc8183Addresses(cfg.chainId);
  } catch {
    return refused(`the ERC-8183 kernel is not deployed on chain ${cfg.chainId}`);
  }
  if (!ADDRESS_RE.test(cfg.providerWallet)) return refused("the seller has no registered wallet configured");
  const task = typeof negotiateData.task_description === "string" ? negotiateData.task_description.trim() : "";
  if (!task) return refused("the negotiate step carries no task_description");

  const asked = typeof cfg.price === "function" ? await cfg.price(task, negotiateData) : cfg.price;
  if (typeof asked === "object") return refused(asked.refuse);
  if (!Number.isFinite(asked) || asked <= 0) return refused("the seller's price is not a positive number");

  let price: string;
  try {
    // String() switches to exponent form below 1e-6, which parseUnits does not read
    price = parseUnits(asked < 1e-6 ? asked.toFixed(18) : String(asked), 18).toString();
  } catch {
    return refused("the quoted fee has more than 18 decimals");
  }

  const signer = signerFor(cfg);
  if (!signer.ok) {
    return cfg.sellerKey
      ? refused(signer.reason)
      : { ok: false, status: "unsigned", unsigned_reason: "the seller has no quote key configured, so it cannot sign a quote yet" };
  }

  const validUntil = Math.floor(Date.now() / 1000) + (cfg.quoteTtlSeconds ?? 1800);
  const negotiationHash = negotiationHashOf({
    task,
    terms: negotiateData.terms ?? null,
    provider: cfg.providerWallet,
    currency: stack.paymentToken,
    price,
    validUntil,
    agentId: cfg.agentId,
  });
  return {
    ok: true,
    envelope: {
      status: "quoted",
      price,
      currency: stack.paymentToken,
      provider_address: cfg.providerWallet,
      valid_until: validUntil,
      negotiation_hash: negotiationHash,
      provider_sig: await signer.account.signMessage({ message: { raw: toBytes(negotiationHash) } }),
      agent_id: cfg.agentId,
      fee_usd: asked,
    },
  };
}
