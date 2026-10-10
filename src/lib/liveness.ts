// A probe's verdict in the shape the on-chain liveness record takes: the grade
// the answer earned, what was called, and a hash of what was seen. Grades are
// the contract's own enum order, so a posting cannot drift from the record.

import {
  createWalletClient,
  encodeFunctionData,
  keccak256,
  type Address,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { BSC_TESTNET_CHAIN_ID } from "./types";
import { rpcTransport } from "./rpc";

export const LIVENESS_GRADE = {
  unknown: 0,
  reachable: 1,
  delivered: 2,
  gated: 3,
  dead: 4,
  unreachable: 5,
} as const;

export const LIVENESS_METHOD = {
  none: 0,
  card: 1,
  a2a: 2,
  mcp: 3,
  execution: 4,
} as const;

export type LivenessGrade = (typeof LIVENESS_GRADE)[keyof typeof LIVENESS_GRADE];
export type LivenessMethod = (typeof LIVENESS_METHOD)[keyof typeof LIVENESS_METHOD];

// How the endpoint answered, in the oracle's terms. An endpoint that answered
// proves reachability, not a delivery: the two grades are held apart on purpose,
// so a probe never posts a claim it did not observe.
export function livenessGrade(probe: { ok: boolean; detail: string }): LivenessGrade {
  if (probe.ok) return LIVENESS_GRADE.reachable;
  if (/^(a2a|mcp) (401|403)$/.test(probe.detail)) return LIVENESS_GRADE.gated;
  if (probe.detail.includes("no callable")) return LIVENESS_GRADE.unreachable;
  return LIVENESS_GRADE.dead;
}

export function livenessMethod(protocol: "mcp" | "a2a" | null | undefined): LivenessMethod {
  if (protocol === "mcp") return LIVENESS_METHOD.mcp;
  if (protocol === "a2a") return LIVENESS_METHOD.a2a;
  return LIVENESS_METHOD.card;
}

// The reading itself, hashed: the record can be audited against what was seen
// without carrying the text of a reply.
export function livenessEvidence(tokenId: string, detail: string): `0x${string}` {
  const text = Buffer.from(`${tokenId}:${detail}`, "utf8").toString("hex");
  return keccak256(`0x${text}`);
}

const REPORT_ABI = [
  {
    name: "report",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "grade", type: "uint8" },
      { name: "method", type: "uint8" },
      { name: "responseMs", type: "uint32" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "checkedAt", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

export interface LivenessPost {
  ok: boolean;
  skipped?: boolean;
  hash?: string;
  error?: string;
}

// One heartbeat from the marketplace's own wallet. Best effort by design: a
// posting that cannot go through leaves the probe's reading in place, and the
// sweep carries on, because a gas line is not a reason to stop checking.
export async function postLiveness(args: {
  chainId: number;
  tokenId: string;
  grade: LivenessGrade;
  method: LivenessMethod;
  responseMs: number;
  detail: string;
  now?: number;
}): Promise<LivenessPost> {
  const address = process.env.LIVENESS_ORACLE_ADDRESS;
  const key = process.env.RELAY_PRIVATE_KEY;
  if (!address || !key) {
    return { ok: false, skipped: true, error: "no liveness oracle is configured" };
  }
  try {
    const chain = args.chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc;
    const account = privateKeyToAccount(key as `0x${string}`);
    const wallet = createWalletClient({
      account,
      chain,
      transport: rpcTransport(args.chainId, process.env.REGISTRY_RPC_URL),
    });
    const data = encodeFunctionData({
      abi: REPORT_ABI,
      functionName: "report",
      args: [
        BigInt(args.tokenId),
        args.grade,
        args.method,
        Math.max(0, Math.round(args.responseMs)),
        livenessEvidence(args.tokenId, args.detail),
        BigInt(Math.floor((args.now ?? Date.now()) / 1000)),
      ],
    });
    const hash = await wallet.sendTransaction({ to: address as Address, data });
    return { ok: true, hash };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).split("\n")[0].slice(0, 160) };
  }
}
