import { createPublicClient, http, type Hex } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { CliError } from "../core/errors";
import { apiRequest } from "../core/http";
import type { CliConfig } from "../core/config";
import type { LoadedSigner } from "../core/wallet";

// The buyer's half of x402: ask the marketplace for terms, sign the EIP-3009
// authorization the terms name, settle it, then deliver against the payment id.
// The amount and the payee are shown before anything is signed, and the
// signature is the only thing that can move money.

export const X402_VERSION = 2;

export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
    assetTransferMethod?: string;
    signerAddress?: string;
    resourceUrl?: string;
    resourceDescription?: string;
    agentPayTo?: string;
  };
}

export interface ResourceInfo {
  url: string;
  description: string;
  mimeType: string;
}

export interface PaymentOption {
  index: number;
  status: "READY_TO_SIGN" | "ACTION_REQUIRED" | "NOT_SIGNABLE";
  reasons: string[];
  tokenSymbol: string;
  amount: string;
  amountUsd: number;
  payTo: string;
  needApproveFirst: boolean;
  originalAccept: PaymentRequirements;
}

export interface RequirementsData {
  paymentRequirements: PaymentRequirements;
  preview: { paymentId: string; options: PaymentOption[]; resource: ResourceInfo };
  agent: { chainId: number; tokenId: string; name: string; image: string | null; symbol: string };
}

export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface SettleResult {
  success: boolean;
  paymentId: string;
  txHash?: string;
  error?: string;
  refused?: boolean;
  details?: {
    mode?: "sandbox" | "prod" | "b402";
    symbol?: string;
    amount?: string;
    client?: string;
    payTo?: string;
    txLink?: string;
  };
}

export interface Receipt {
  paymentId: string;
  createdAt: string;
  txHash: string;
  mode: "sandbox" | "prod" | "b402";
  amount: string;
  symbol: string;
  [key: string]: unknown;
}

export interface DeliverOutcome {
  protocol: "mcp" | "a2a";
  ok: boolean;
  kind?: "capabilities" | "deliverable";
  text?: string;
  gated?: boolean;
  isError?: boolean;
  error?: string;
  tools?: { name: string; description: string; schema: Record<string, unknown> }[];
  skills?: unknown[];
  taskId?: string;
}

// copied from src/lib/x402.ts and apps/web/src/core/x402.ts; a test signs with
// this and verifies with the server's copy, so the two cannot drift
export const TRANSFER_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function x402ChainId(req: PaymentRequirements): number {
  return Number.parseInt(req.network.split(":")[1] ?? "0", 10);
}

export function x402Domain(req: PaymentRequirements) {
  return {
    name: req.extra.name,
    version: req.extra.version,
    chainId: BigInt(x402ChainId(req)),
    verifyingContract: req.asset as `0x${string}`,
  };
}

export function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `0x${hex}`;
}

export async function fetchRequirements(
  config: CliConfig,
  chainId: number,
  tokenId: string,
  client: string,
): Promise<RequirementsData> {
  const body = await apiRequest<{ success?: boolean; data?: RequirementsData; error?: string }>(
    config.apiUrl,
    "/api/x402/requirements",
    { method: "POST", body: { chainId, tokenId, client }, timeoutMs: 30_000 },
  );
  if (!body?.success || !body.data?.paymentRequirements || !body.data.preview) {
    throw new CliError(body?.error ?? "the marketplace returned no payment requirements", "not_payable");
  }
  return body.data;
}

// the first option the buyer can sign, held to the caller's cap; a listing with
// no signable option says why rather than asking for a signature it cannot use
export function signableOption(data: RequirementsData, maxUsd?: number): PaymentOption {
  const option = (data.preview.options ?? []).find((o) => o.status === "READY_TO_SIGN");
  if (!option) {
    const reasons = (data.preview.options ?? []).flatMap((o) => o.reasons ?? []).filter(Boolean);
    throw new CliError(
      reasons[0] ?? "this agent has no signable payment option right now",
      "not_payable",
    );
  }
  if (option.needApproveFirst) {
    throw new CliError("the payment token needs an approval first, which the CLI does not do yet", "approval_required");
  }
  if (maxUsd !== undefined && option.amountUsd > maxUsd) {
    throw new CliError(
      `the hire is ${option.amountUsd} ${option.tokenSymbol}, above the ${maxUsd} cap`,
      "over_cap",
    );
  }
  return option;
}

// validity is anchored to chain time, so a host clock that runs fast cannot sign
// an authorization the chain rejects as not yet valid
async function chainNow(config: CliConfig, chainId: number): Promise<bigint> {
  try {
    const client = createPublicClient({
      chain: chainId === 97 ? bscTestnet : bsc,
      transport: http(config.rpcUrl, { timeout: 10_000 }),
    });
    const block = await client.getBlock({ blockTag: "latest" });
    return block.timestamp;
  } catch {
    return BigInt(Math.floor(Date.now() / 1000));
  }
}

export async function signTransfer(
  account: LoadedSigner["account"],
  req: PaymentRequirements,
  now: bigint,
): Promise<{ authorization: Authorization; signature: Hex }> {
  const authorization: Authorization = {
    from: account.address,
    to: req.payTo,
    value: req.amount,
    validAfter: (now - 60n).toString(),
    validBefore: (now + BigInt(req.maxTimeoutSeconds)).toString(),
    nonce: randomNonce(),
  };
  const signature = await account.signTypedData({
    domain: x402Domain(req),
    types: TRANSFER_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from as `0x${string}`,
      to: authorization.to as `0x${string}`,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce as `0x${string}`,
    },
  });
  return { authorization, signature };
}

// the exact body the settle route reads, kept pure so a test can compare it with
// the server's PaymentPayload shape
export function settleBody(
  data: RequirementsData,
  authorization: Authorization,
  signature: string,
) {
  const resource = data.preview.resource;
  return {
    paymentId: data.preview.paymentId,
    paymentRequirements: data.paymentRequirements,
    paymentPayload: {
      x402Version: X402_VERSION,
      payload: { authorization: { ...authorization, signature }, resource },
      resource,
      accepted: data.paymentRequirements,
    },
    agent: {
      chainId: data.agent.chainId,
      tokenId: data.agent.tokenId,
      name: data.agent.name,
      symbol: data.agent.symbol,
    },
  };
}

// A settle refusal arrives as the route's own sentence, except when the relay
// itself could not pay gas: that one is a wall of viem text, and the buyer needs
// to know no money moved.
export function settleErrorText(raw: string): string {
  const text = raw ?? "";
  if (/insufficient funds for gas|exceeds the balance of the account|total cost .* exceeds/i.test(text)) {
    return "the relay that broadcasts hires is out of BNB for gas, so nothing was charged; try again later";
  }
  if (/authorization expired/i.test(text)) {
    return "the authorization expired before it settled, so nothing was charged; run the call again";
  }
  if (/signature verification failed|invalid signature/i.test(text)) {
    return "the marketplace could not verify the signature, so nothing was charged";
  }
  if (/already been used|already used|nonce/i.test(text)) {
    return "that authorization was already used, so nothing was charged; run the call again";
  }
  // a short sentence from the marketplace is already plain English
  if (text.length > 0 && text.length <= 200 && !text.includes("0x") && !/viem|gas \* gas fee/i.test(text)) {
    return text;
  }
  return "the payment did not settle, so nothing was charged";
}

export async function settlePayment(
  config: CliConfig,
  body: ReturnType<typeof settleBody>,
): Promise<SettleResult> {
  let result: SettleResult;
  try {
    result = await apiRequest<SettleResult>(config.apiUrl, "/api/x402/settle", {
      method: "POST",
      body,
      timeoutMs: 90_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(settleErrorText(message), "settle_failed");
  }
  if (!result?.success) {
    throw new CliError(settleErrorText(result?.error ?? ""), "settle_failed");
  }
  return result;
}

export async function getReceipt(config: CliConfig, paymentId: string): Promise<Receipt | null> {
  try {
    return await apiRequest<Receipt>(config.apiUrl, `/api/receipts/${encodeURIComponent(paymentId)}`, {
      method: "GET",
      timeoutMs: 20_000,
    });
  } catch {
    return null;
  }
}

export async function deliverHire(
  config: CliConfig,
  paymentId: string,
  wallet: string,
  work: { task?: string; tool?: string; args?: Record<string, unknown> },
): Promise<DeliverOutcome> {
  const body = await apiRequest<{ success?: boolean; data?: DeliverOutcome; error?: string }>(
    config.apiUrl,
    "/api/x402/deliver",
    {
      method: "POST",
      body: { paymentId, wallet, task: work.task, tool: work.tool, args: work.args },
      timeoutMs: 90_000,
    },
  );
  if (!body?.success || !body.data) {
    throw new CliError(body?.error ?? "the agent returned nothing", "delivery_failed");
  }
  return body.data;
}

export interface PreparedPayment {
  data: RequirementsData;
  option: PaymentOption;
}

export async function preparePayment(
  config: CliConfig,
  chainId: number,
  tokenId: string,
  client: string,
  maxUsd?: number,
): Promise<PreparedPayment> {
  const data = await fetchRequirements(config, chainId, tokenId, client);
  const signedChain = x402ChainId(data.paymentRequirements);
  if (signedChain !== chainId) {
    throw new CliError(
      `these terms settle on chain ${signedChain}, but this CLI is set to ${chainId}`,
      "wrong_chain",
    );
  }
  return { data, option: signableOption(data, maxUsd) };
}

export interface PaidCallResult {
  data: RequirementsData;
  option: PaymentOption;
  settle: SettleResult;
  receipt: Receipt | null;
  delivery?: DeliverOutcome;
  deliveryError?: string;
}

// sign, settle, then deliver. A settlement that succeeded and a delivery that
// failed is reported as such: the money moved, and hiding that would be worse
// than the failure itself.
export async function paidCall(
  config: CliConfig,
  signer: LoadedSigner,
  prepared: PreparedPayment,
  work: { task?: string; tool?: string; args?: Record<string, unknown> },
): Promise<PaidCallResult> {
  const { data } = prepared;
  const now = await chainNow(config, x402ChainId(data.paymentRequirements));
  const { authorization, signature } = await signTransfer(signer.account, data.paymentRequirements, now);
  const settle = await settlePayment(config, settleBody(data, authorization, signature));
  const receipt = await getReceipt(config, settle.paymentId);
  const result: PaidCallResult = { data, option: prepared.option, settle, receipt };
  if (!work.task && !work.tool) return result;
  try {
    result.delivery = await deliverHire(config, settle.paymentId, signer.address, work);
  } catch (error) {
    result.deliveryError = error instanceof Error ? error.message : String(error);
  }
  return result;
}
