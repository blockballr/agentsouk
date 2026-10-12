// A probe's verdict in the shape the on-chain liveness record takes: the grade
// the answer earned, what was called, and a hash of what was seen. Grades are
// the contract's own enum order, so a posting cannot drift from the record.

import {
  createPublicClient,
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

// the sweep's own cadence, so a reading the oracle still counts as fresh is the
// same age the marketplace's own pages would trust
export const LIVENESS_WINDOW_SECONDS = 6 * 60 * 60;

const HEARTBEAT_ABI = [
  {
    name: "verdict",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "window", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "heartbeat",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "grade", type: "uint8" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "grade", type: "uint8" },
          { name: "method", type: "uint8" },
          { name: "checkedAt", type: "uint64" },
          { name: "responseMs", type: "uint32" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "reporter", type: "address" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
] as const;

export interface LivenessReading {
  tokenId: string;
  verdict: string;
  exists: boolean;
  method: string | null;
  checkedAt: string | null;
  responseMs: number | null;
  evidenceHash: string | null;
  reporter: string | null;
}

const GRADE_NAMES: Record<number, string> = {
  [LIVENESS_GRADE.unknown]: "unknown",
  [LIVENESS_GRADE.reachable]: "reachable",
  [LIVENESS_GRADE.delivered]: "delivered",
  [LIVENESS_GRADE.gated]: "gated",
  [LIVENESS_GRADE.dead]: "dead",
  [LIVENESS_GRADE.unreachable]: "unreachable",
};
const gradeName = (n: number): string => GRADE_NAMES[n] ?? "unknown";

const METHOD_NAMES: Record<number, string> = {
  [LIVENESS_METHOD.none]: "none",
  [LIVENESS_METHOD.card]: "card",
  [LIVENESS_METHOD.a2a]: "a2a",
  [LIVENESS_METHOD.mcp]: "mcp",
  [LIVENESS_METHOD.execution]: "execution",
};
const methodName = (n: number): string => METHOD_NAMES[n] ?? "none";

// the on-chain record of what a probe observed, read back from the oracle. a
// listing with no reading reads as unknown, which is not the same as the oracle
// being unconfigured: that reads as null, so a caller can tell the two apart
export async function readLiveness(
  chainId: number,
  tokenId: string,
  windowSeconds: number = LIVENESS_WINDOW_SECONDS,
): Promise<LivenessReading | null> {
  const address = process.env.LIVENESS_ORACLE_ADDRESS as Address | undefined;
  if (!address) return null;
  let id: bigint;
  try {
    id = BigInt(tokenId);
  } catch {
    return null;
  }
  try {
    const client = createPublicClient({ transport: rpcTransport(chainId, process.env.REGISTRY_RPC_URL) });
    const verdictRaw = Number(
      await client.readContract({
        address,
        abi: HEARTBEAT_ABI,
        functionName: "verdict",
        args: [id, BigInt(windowSeconds)],
      }),
    );
    const hb = (await client.readContract({
      address,
      abi: HEARTBEAT_ABI,
      functionName: "heartbeat",
      args: [id, verdictRaw],
    })) as {
      grade: number;
      method: number;
      checkedAt: bigint;
      responseMs: number;
      evidenceHash: string;
      reporter: string;
      exists: boolean;
    };
    return {
      tokenId: String(tokenId),
      verdict: gradeName(verdictRaw),
      exists: Boolean(hb.exists),
      method: hb.exists ? methodName(Number(hb.method)) : null,
      checkedAt:
        hb.exists && Number(hb.checkedAt) > 0
          ? new Date(Number(hb.checkedAt) * 1000).toISOString()
          : null,
      responseMs: hb.exists ? Number(hb.responseMs) : null,
      evidenceHash: hb.exists ? hb.evidenceHash : null,
      reporter: hb.exists ? hb.reporter : null,
    };
  } catch {
    // a read that fails leaves the caller with nothing rather than a guess
    return null;
  }
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
    const transport = rpcTransport(args.chainId, process.env.REGISTRY_RPC_URL);
    // a posting to an address with no code on the target chain is a transaction
    // that mines, costs gas and records nothing, so the chain is checked first
    const deployed = await createPublicClient({ transport })
      .getCode({ address: address as Address })
      .catch(() => null);
    if (!deployed || deployed === "0x") {
      return {
        ok: false,
        error: `no oracle contract at ${address} on chain ${args.chainId}, so a posting would record nothing`,
      };
    }
    const wallet = createWalletClient({ account, chain, transport });
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
