import { encodeFunctionData, type PublicClient } from "viem";
import { HIRE_ABI, VAULT_READ_ABI } from "./abi.js";

export interface Hire {
  id: bigint;
  buyer: `0x${string}`;
  agent: `0x${string}`;
  expiry: number;
  maxSlippageBps: number;
  open: boolean;
  balanceA: bigint;
  balanceB: bigint;
  refPriceX96: bigint;
  fee: number;
  depositInToken0: bigint;
  deployedB: bigint;
  agentFeeBps: number;
  highWaterMark: bigint;
  maxLossBps: number;
  // zero when the hire has never supplied to a venue
  venue: `0x${string}`;
}

const ZERO = "0x0000000000000000000000000000000000000000";

// every field of the struct is static, so the words can be read straight out of
// the return data. that keeps an older vault (one without the venue field) and a
// newer one readable by the same client, which an exact ABI decode cannot do.
function words(data: `0x${string}`): string[] {
  const body = data.startsWith("0x") ? data.slice(2) : data;
  const out: string[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) out.push(body.slice(i, i + 64));
  return out;
}

const big = (w: string | undefined): bigint => (w ? BigInt(`0x${w}`) : 0n);
const num = (w: string | undefined): number => Number(big(w));
const bool = (w: string | undefined): boolean => big(w) !== 0n;
const addr = (w: string | undefined): `0x${string}` => (w ? `0x${w.slice(24)}` : ZERO);

export function decodeHire(id: bigint, data: `0x${string}`): Hire {
  const w = words(data);
  if (w.length < 14) throw new Error(`hire ${id} returned ${w.length} words, expected at least 14`);
  return {
    id,
    buyer: addr(w[0]),
    agent: addr(w[1]),
    expiry: num(w[2]),
    maxSlippageBps: num(w[3]),
    open: bool(w[4]),
    balanceA: big(w[5]),
    balanceB: big(w[6]),
    refPriceX96: big(w[7]),
    fee: num(w[8]),
    depositInToken0: big(w[9]),
    deployedB: big(w[10]),
    agentFeeBps: num(w[11]),
    highWaterMark: big(w[12]),
    maxLossBps: num(w[13]),
    venue: addr(w[14]),
  };
}

export async function readHire(client: PublicClient, vault: `0x${string}`, id: bigint): Promise<Hire> {
  const data = encodeFunctionData({ abi: HIRE_ABI, functionName: "hire", args: [id] });
  const out = await client.call({ to: vault, data });
  return decodeHire(id, out.data ?? "0x");
}

export async function readHiresFor(client: PublicClient, vault: `0x${string}`, agent: `0x${string}`): Promise<bigint[]> {
  const ids = (await client.readContract({
    address: vault,
    abi: VAULT_READ_ABI,
    functionName: "hiresFor",
    args: [agent],
  })) as readonly bigint[];
  return [...ids];
}

// the agent only ever sees the hires that named its own wallet, and only those
// still open. a closed hire cannot be traded, so it is not offered to a strategy
export async function readOpenHires(
  client: PublicClient,
  vault: `0x${string}`,
  agent: `0x${string}`,
): Promise<Hire[]> {
  const ids = await readHiresFor(client, vault, agent);
  const hires = await Promise.all(ids.map((id) => readHire(client, vault, id)));
  return hires.filter((h) => h.open);
}
