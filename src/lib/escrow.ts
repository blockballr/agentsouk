import "server-only";

// The funded-hire escrow: where a settled hire is held on chain rather than
// claimed to be. Two deployed contracts, both relay-gated, both keyed off the
// paymentId the marketplace already hands out:
//
//   EIP3009Funder  the money path. The buyer's EIP-3009 authorization is
//                  consumed inside fund(), so the relay never holds funds and
//                  the agent is not paid until verify() plus the dispute
//                  window, or the buyer's own approve().
//   ReceiptLedger  the settlement record: one receipt per paymentId, claimable
//                  exactly once, so a boost or a quest point cannot be scored
//                  twice off one payment.
//
// Everything here is off until the addresses exist in env. A missing address
// reads as escrow disabled and the settlement path falls back to the direct
// transfer it has always run.

import {
  encodeFunctionData,
  createPublicClient,
  createWalletClient,
  getAddress,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet, bsc } from "viem/chains";
import { BSC_TESTNET_CHAIN_ID, targetChainId } from "./types";
import { rpcTransport } from "./rpc";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// one payment, one id, on both contracts
export function escrowJobId(paymentId: string): `0x${string}` {
  return keccak256(toBytes(paymentId));
}

export function escrowFunder(): `0x${string}` | null {
  const addr = process.env.ESCROW_FUNDER_ADDRESS ?? "";
  return ADDRESS.test(addr) ? getAddress(addr) : null;
}

export function receiptLedger(): `0x${string}` | null {
  const addr = process.env.RECEIPT_LEDGER_ADDRESS ?? "";
  return ADDRESS.test(addr) ? getAddress(addr) : null;
}

// the payable job in escrow terms: the signed recipient is the funder, the
// agent's real wallet travels beside it, and a settlement without both of
// them is not an escrowed hire
export interface EscrowTerms {
  funder: `0x${string}`;
  agentPayTo: `0x${string}`;
}

export function escrowTermsFor(
  payTo: string | undefined,
  agentPayTo: string | undefined,
): EscrowTerms | null {
  const funder = escrowFunder();
  if (!funder) return null;
  if (!payTo || !ADDRESS.test(payTo)) return null;
  if (!agentPayTo || !ADDRESS.test(agentPayTo)) return null;
  if (getAddress(payTo) !== funder) return null;
  return { funder, agentPayTo: getAddress(agentPayTo) };
}

function chainConfig(chainId: number) {
  const chain = chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc;
  return { chain, transport: rpcTransport(chainId) };
}

function relayAccount() {
  const key = process.env.RELAY_PRIVATE_KEY;
  if (!key) return null;
  return privateKeyToAccount(key as `0x${string}`);
}

const FUNDER_ABI = [
  {
    name: "fund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "buyer", type: "address" },
      { name: "payTo", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "verify",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "bytes32" },
      { name: "receiptId", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "release",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "jobOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "buyer", type: "address" },
          { name: "payTo", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "fundedAt", type: "uint64" },
          { name: "verifiedAt", type: "uint64" },
          { name: "receiptId", type: "bytes32" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

const LEDGER_ABI = [
  {
    name: "issue",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiptId", type: "bytes32" },
      { name: "buyer", type: "address" },
      { name: "payTo", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

async function send(to: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`> {
  const relay = relayAccount();
  if (!relay) throw new Error("no relay key configured");
  const { chain, transport } = chainConfig(targetChainId());
  const wallet = createWalletClient({ account: relay, chain, transport });
  const publicClient = createPublicClient({ chain, transport });
  const hash = await wallet.sendTransaction({ to, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`escrow tx reverted: ${hash}`);
  return hash;
}

// fund one escrowed hire: the token validates the buyer's authorization inside
// this call, so a forged or replayed signature reverts the whole transaction
// and nothing is escrowed twice
export async function fundEscrow(input: {
  paymentId: string;
  token: `0x${string}`;
  buyer: `0x${string}`;
  agentPayTo: `0x${string}`;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
  signature: `0x${string}`;
}): Promise<`0x${string}`> {
  const funder = escrowFunder();
  if (!funder) throw new Error("escrow funder not configured");
  const data = encodeFunctionData({
    abi: FUNDER_ABI,
    functionName: "fund",
    args: [
      escrowJobId(input.paymentId),
      input.token,
      input.buyer,
      input.agentPayTo,
      input.value,
      input.validAfter,
      input.validBefore,
      input.nonce,
      input.signature,
    ],
  });
  return send(funder, data);
}

// publish the settlement to the ledger: the same paymentId, claimable once.
// Best effort by design: the fund has already moved, and a ledger outage
// records a warning rather than unwinding an escrowed hire
export async function issueSettlementReceipt(input: {
  paymentId: string;
  buyer: `0x${string}`;
  agentPayTo: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  nonce: `0x${string}`;
}): Promise<string | null> {
  const ledger = receiptLedger();
  if (!ledger) return null;
  try {
    const data = encodeFunctionData({
      abi: LEDGER_ABI,
      functionName: "issue",
      args: [
        escrowJobId(input.paymentId),
        input.buyer,
        input.agentPayTo,
        input.token,
        input.amount,
        input.nonce,
      ],
    });
    return await send(ledger, data);
  } catch (e) {
    console.error("[escrow] receipt issue failed:", (e as Error).message);
    return null;
  }
}

// the delivery's on-chain attestation: the relay gated the delivery before
// recording it, so this is the verifier's verdict made visible, and it opens
// the dispute window
export async function verifyEscrowDelivery(paymentId: string): Promise<string | null> {
  const funder = escrowFunder();
  if (!funder) return null;
  try {
    const data = encodeFunctionData({
      abi: FUNDER_ABI,
      functionName: "verify",
      args: [escrowJobId(paymentId), escrowJobId(paymentId)],
    });
    return await send(funder, data);
  } catch (e) {
    console.error("[escrow] delivery verify failed:", (e as Error).message);
    return null;
  }
}

export interface EscrowJobRow {
  fundedAt: bigint;
  verifiedAt: bigint;
  status: number;
  amount: bigint;
  payTo: string;
}

const ESCROW_FUNDED = 0;
const ESCROW_RELEASED = 1;

export async function escrowJobOf(paymentId: string): Promise<EscrowJobRow | null> {
  const funder = escrowFunder();
  if (!funder) return null;
  try {
    const { chain, transport } = chainConfig(targetChainId());
    const publicClient = createPublicClient({ chain, transport });
    const row = await publicClient.readContract({
      address: funder,
      abi: FUNDER_ABI,
      functionName: "jobOf",
      args: [escrowJobId(paymentId)],
    });
    const job = row as unknown as {
      buyer: string;
      payTo: string;
      token: string;
      amount: bigint;
      fundedAt: bigint;
      verifiedAt: bigint;
      receiptId: `0x${string}`;
      status: number;
    };
    if (job.fundedAt === 0n) return null;
    return {
      fundedAt: job.fundedAt,
      verifiedAt: job.verifiedAt,
      status: job.status,
      amount: job.amount,
      payTo: job.payTo,
    };
  } catch (e) {
    console.error("[escrow] job read failed:", (e as Error).message);
    return null;
  }
}

// release once the dispute window has passed. Permissionless on the contract,
// so anyone may call it; the marketplace calls it because it is the party that
// knows a delivery was verified. Nothing to release reads as no error
export async function releaseEscrowIfDue(paymentId: string): Promise<string | null> {
  const funder = escrowFunder();
  if (!funder) return null;
  const job = await escrowJobOf(paymentId);
  if (!job) return null;
  if (job.status !== ESCROW_FUNDED || job.verifiedAt === 0n) return null;
  try {
    const data = encodeFunctionData({
      abi: FUNDER_ABI,
      functionName: "release",
      args: [escrowJobId(paymentId)],
    });
    return await send(funder, data);
  } catch (e) {
    // not due yet is the normal case: the window is still open
    const message = (e as Error).message ?? "";
    if (message.includes("DisputeOpen")) return null;
    console.error("[escrow] release failed:", message);
    return null;
  }
}

export { ESCROW_FUNDED, ESCROW_RELEASED };
