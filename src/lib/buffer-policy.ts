// Buffer: the yield policy. Deploys only the sleeve the revoke window does not
// need. It scores venues net of exit cost, keeps a liquid buffer, and withdraws
// when the buffer breaches. The receipt names the buffer before and after and
// the exit latency.
//
// Execution surface: supply and withdraw on a testnet venue (Venus, Lista DAO, etc.)

export interface BufferPolicy {
  /** minimum liquid buffer as a fraction of total (e.g. 0.2 = 20%) */
  minBufferPct: number;
  /** minimum net yield (after exit cost) to justify deploying */
  minYieldPct: number;
  /** max exit latency in seconds before a venue is disqualified */
  maxExitLatencySec: number;
  /** max slippage in basis points for supply/withdraw */
  maxSlippageBps: number;
}

export const DEFAULT_MIN_BUFFER_PCT = 0.2;
export const DEFAULT_MIN_YIELD_PCT = 0.01;
export const DEFAULT_MAX_EXIT_LATENCY_SEC = 86400; // 24h
export const DEFAULT_BUFFER_SLIPPAGE_BPS = 50;

export function bufferPolicyFromEnv(env: Record<string, string | undefined>): BufferPolicy {
  const buf = Number(env.BUFFER_MIN_BUFFER_PCT ?? "");
  const yld = Number(env.BUFFER_MIN_YIELD_PCT ?? "");
  const exit = Number(env.BUFFER_MAX_EXIT_LATENCY_SEC ?? "");
  const slip = Number(env.BUFFER_MAX_SLIPPAGE_BPS ?? "");
  return {
    minBufferPct: Number.isFinite(buf) && buf > 0 && buf < 1 ? buf : DEFAULT_MIN_BUFFER_PCT,
    minYieldPct: Number.isFinite(yld) && yld >= 0 ? yld : DEFAULT_MIN_YIELD_PCT,
    maxExitLatencySec: Number.isFinite(exit) && exit > 0 ? exit : DEFAULT_MAX_EXIT_LATENCY_SEC,
    maxSlippageBps: Number.isInteger(slip) && slip > 0 ? slip : DEFAULT_BUFFER_SLIPPAGE_BPS,
  };
}

export interface BufferVenue {
  name: string;
  /** net yield after exit cost, as a fraction (e.g. 0.05 = 5%) */
  netYield: number;
  /** exit latency in seconds */
  exitLatencySec: number;
  /** whether the venue is available */
  available: boolean;
}

export interface BufferHireFacts {
  id: bigint;
  open: boolean;
  expiry: number;
  /** total sleeve in quote units */
  totalSleeve: bigint;
  /** currently deployed in venues */
  deployed: bigint;
  /** currently liquid (not deployed) */
  liquid: bigint;
  /** available venues with their scores */
  venues: BufferVenue[];
  maxSlippageBps: number;
}

export interface BufferState {
  generation: number;
  lastBlock: bigint;
  /** venue name currently deployed to, or null */
  currentVenue: string | null;
  /** amount currently in the venue */
  deployedAmount: bigint;
  /** actions already taken, "generation:action" */
  acted: string[];
}

export interface BufferIntent {
  key: string;
  /** "supply" or "withdraw" */
  action: "supply" | "withdraw";
  /** venue name */
  venue: string;
  /** amount to move, in quote units */
  amount: bigint;
  reason: string;
}

export type BufferOutcome =
  | { action: "stop"; reason: string; state: BufferState }
  | { action: "hold"; reason: string; state: BufferState; liquid: bigint; deployed: bigint }
  | { action: "refuse"; reason: string; state: BufferState; liquid: bigint; deployed: bigint }
  | { action: "trade"; reason: string; intents: BufferIntent[]; state: BufferState; liquid: bigint; deployed: bigint };

export function initialBufferState(lastBlock: bigint): BufferState {
  return { generation: 0, lastBlock, currentVenue: null, deployedAmount: 0n, acted: [] };
}

export function decideBuffer(input: {
  hire: BufferHireFacts;
  policy: BufferPolicy;
  state: BufferState | null;
  blockNumber: bigint;
  nowSec: number;
  kill: boolean;
}): BufferOutcome {
  const { hire, policy, blockNumber, nowSec, kill } = input;
  const base: BufferState = input.state ?? initialBufferState(blockNumber);

  if (kill) return { action: "stop", reason: "kill switch set", state: base };
  if (!hire.open) return { action: "stop", reason: "hire not open", state: base };
  if (nowSec >= hire.expiry) return { action: "stop", reason: "hire expired", state: base };

  const total = hire.totalSleeve;
  if (total === 0n) {
    return { action: "hold", reason: "empty sleeve", state: { ...base, lastBlock: blockNumber }, liquid: hire.liquid, deployed: hire.deployed };
  }

  const minLiquid = (total * BigInt(Math.floor(policy.minBufferPct * 10000))) / 10000n;
  const available = hire.liquid - minLiquid; // how much we can deploy

  // best venue: highest net yield among available venues
  const eligible = hire.venues
    .filter((v) => v.available && v.netYield >= policy.minYieldPct && v.exitLatencySec <= policy.maxExitLatencySec)
    .sort((a, b) => b.netYield - a.netYield);

  const bestVenue = eligible[0] ?? null;

  // if deployed and buffer breached, withdraw
  if (hire.deployed > 0n && hire.liquid < minLiquid) {
    const withdrawAmount = minLiquid - hire.liquid;
    const key = `${base.generation}:withdraw`;
    if (base.acted.includes(key)) {
      return { action: "hold", reason: "already withdrew this generation", state: { ...base, lastBlock: blockNumber }, liquid: hire.liquid, deployed: hire.deployed };
    }
    const intent: BufferIntent = {
      key,
      action: "withdraw",
      venue: base.currentVenue ?? "unknown",
      amount: withdrawAmount > hire.deployed ? hire.deployed : withdrawAmount,
      reason: `buffer breached: liquid ${hire.liquid} < floor ${minLiquid}, withdrawing ${withdrawAmount}`,
    };
    return {
      action: "trade",
      reason: `buffer breach, withdrawing ${intent.amount} from ${intent.venue}`,
      intents: [intent],
      state: { ...base, lastBlock: blockNumber, acted: [...base.acted, key].slice(-100) },
      liquid: hire.liquid,
      deployed: hire.deployed,
    };
  }

  // if we have available funds and a good venue, supply
  if (available > 0n && bestVenue) {
    const key = `${base.generation}:supply:${bestVenue.name}`;
    if (base.acted.includes(key)) {
      return { action: "hold", reason: "already supplied this generation", state: { ...base, lastBlock: blockNumber }, liquid: hire.liquid, deployed: hire.deployed };
    }
    const intent: BufferIntent = {
      key,
      action: "supply",
      venue: bestVenue.name,
      amount: available,
      reason: `deploying ${available} to ${bestVenue.name} at ${(bestVenue.netYield * 100).toFixed(2)}% net yield`,
    };
    return {
      action: "trade",
      reason: `supplying ${available} to ${bestVenue.name}`,
      intents: [intent],
      state: { ...base, lastBlock: blockNumber, currentVenue: bestVenue.name, deployedAmount: hire.deployed + available, acted: [...base.acted, key].slice(-100) },
      liquid: hire.liquid,
      deployed: hire.deployed,
    };
  }

  // nothing to do
  return {
    action: "hold",
    reason: `holding: available ${available}, best venue ${bestVenue?.name ?? "none"}`,
    state: { ...base, lastBlock: blockNumber },
    liquid: hire.liquid,
    deployed: hire.deployed,
  };
}
