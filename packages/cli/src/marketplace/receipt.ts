import { createPublicClient, http, type Hex } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import type { CliConfig } from "../core/config";
import { apiRequest } from "../core/http";

// The receipt command is a chain verifier, not a ledger reader. It uses the
// ledger for context when a payment id is given, then reads the transaction
// itself and compares what was claimed with what the chain shows.

export interface PaymentProof {
  paymentId?: string;
  chainId?: number;
  tokenId?: string;
  agentName?: string;
  agentWallet?: string | null;
  agentOwner?: string | null;
  client?: string;
  payee?: string;
  payeeMatchesAgent?: boolean | null;
  amount?: number | string;
  symbol?: string;
  txHash?: string | null;
  explorer?: string | null;
  error?: string;
}

export interface ProofResponse {
  data?: PaymentProof | null;
  error?: string;
}

export interface TransferHit {
  token: string;
  from: string;
  to: string;
  value: bigint;
}

export interface Check {
  name: string;
  ok: boolean | null;
  expected: string;
  observed: string;
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function topicAddress(topic: string): string {
  return `0x${topic.slice(26)}`.toLowerCase();
}

// an ERC-20 Transfer is three topics and a value, so a payment can be found
// without knowing the token contract in advance
export function findTransfer(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
  from: string,
  to: string,
  value: bigint,
): TransferHit | null {
  for (const log of logs) {
    if (log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (topicAddress(log.topics[1]) !== from.toLowerCase()) continue;
    if (topicAddress(log.topics[2]) !== to.toLowerCase()) continue;
    const moved = BigInt(log.data);
    if (moved !== value) continue;
    return { token: log.address.toLowerCase(), from: from.toLowerCase(), to: to.toLowerCase(), value: moved };
  }
  return null;
}

export function verdict(checks: readonly Check[]): "verified" | "mismatch" | "unverifiable" {
  if (checks.some((check) => check.ok === null)) return "unverifiable";
  if (checks.some((check) => check.ok === false)) return "mismatch";
  return "verified";
}

function client(config: CliConfig) {
  return createPublicClient({ chain: config.chainId === 97 ? bscTestnet : bsc, transport: http(config.rpcUrl, { timeout: 20_000 }) });
}

export function isTxHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export interface ReceiptResult {
  kind: "payment" | "transfer";
  outcome: "verified" | "mismatch" | "unverifiable";
  checks: Check[];
  payment?: PaymentProof;
  txHash: string;
  explorer: string;
}

export async function verifyPayment(config: CliConfig, paymentId: string): Promise<ReceiptResult> {
  const proof = await apiRequest<ProofResponse>(config.apiUrl, `/api/hires/proof?paymentId=${encodeURIComponent(paymentId)}`, {
    timeoutMs: 30_000,
  });
  const payment = proof.data;
  if (!payment) {
    return {
      kind: "payment",
      outcome: "unverifiable",
      checks: [{ name: "ledger", ok: null, expected: paymentId, observed: proof.error ?? "no payment" }],
      txHash: "",
      explorer: "",
    };
  }
  if (!payment.txHash) {
    return {
      kind: "payment",
      outcome: "unverifiable",
      checks: [{ name: "transaction", ok: null, expected: "a hash", observed: "none recorded" }],
      payment,
      txHash: "",
      explorer: "",
    };
  }
  return verifyTransaction(config, payment.txHash, payment);
}

export async function verifyTransaction(config: CliConfig, txHash: string, payment?: PaymentProof): Promise<ReceiptResult> {
  const chainId = payment?.chainId ?? config.chainId;
  let receipt;
  try {
    receipt = await client({ ...config, chainId }).getTransactionReceipt({ hash: txHash as Hex });
  } catch (error) {
    return {
      kind: payment ? "payment" : "transfer",
      outcome: "unverifiable",
      checks: [{ name: "chain", ok: null, expected: txHash, observed: (error as Error).message.slice(0, 80) }],
      payment,
      txHash,
      explorer: explorerFor(chainId, txHash),
    };
  }

  const checks: Check[] = [
    { name: "status", ok: receipt.status === "success", expected: "success", observed: receipt.status },
  ];

  if (payment?.client && payment?.payee && payment.amount !== undefined && payment.amount !== null) {
    const expected = BigInt(Math.round(Number(payment.amount) * 1e18));
    const hit = findTransfer(receipt.logs, payment.client, payment.payee, expected);
    checks.push({
      name: "payer",
      ok: receipt.from.toLowerCase() === payment.client.toLowerCase(),
      expected: payment.client.toLowerCase(),
      observed: receipt.from.toLowerCase(),
    });
    checks.push({
      name: "transfer",
      ok: hit !== null,
      expected: `${Number(payment.amount)} ${payment.symbol ?? ""} to ${payment.payee.toLowerCase()}`,
      observed: hit ? `${Number(hit.value) / 1e18} ${payment.symbol ?? ""} ${hit.token}` : "no matching transfer",
    });
    if (payment.payeeMatchesAgent !== null && payment.payeeMatchesAgent !== undefined) {
      checks.push({
        name: "payee is the agent wallet",
        ok: payment.payeeMatchesAgent,
        expected: "true",
        observed: String(payment.payeeMatchesAgent),
      });
    }
  } else {
    for (const log of receipt.logs) {
      if (log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
      checks.push({
        name: "transfer",
        ok: true,
        expected: "any",
        observed: `${Number(BigInt(log.data)) / 1e18} from ${topicAddress(log.topics[1])} to ${topicAddress(log.topics[2])}`,
      });
    }
  }

  return {
    kind: payment ? "payment" : "transfer",
    outcome: verdict(checks),
    checks,
    payment,
    txHash,
    explorer: explorerFor(chainId, txHash),
  };
}

function explorerFor(chainId: number, txHash: string): string {
  const host = chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com";
  return `${host}/tx/${txHash}`;
}
