// One buyer's defence is spread over two contracts and a watcher: a mandate,
// a prepaid plan and the watch's own health. This is the single derivation of
// what that relationship is, so the page, the API and an agent read the same
// state instead of re-deriving "active but expired" in three places.

export type MandatePhase = "none" | "active" | "expiring" | "expired";
export type PlanPhase = "none" | "active" | "expired";
export type WatchPhase = "unknown" | "healthy" | "degraded" | "stale";
export type GasPhase = "unknown" | "ok" | "low";

export type DefencePhase = "unprotected" | "protected" | "expiring" | "lapsed" | "degraded";

export type DefenceAction =
  | "set-mandate"
  | "revoke"
  | "fund"
  | "cancel"
  | "withdraw"
  | "top-up";

export interface DefenceMandate {
  active: boolean;
  expiry: number;
  positions: number;
}

export interface DefencePlan {
  agent: string;
  expiry: number;
}

export interface DefenceWatch {
  stale: boolean;
  consecutiveFailures: number;
  ok: boolean;
}

export interface DefenceInput {
  /** unix seconds */
  now: number;
  mandate: DefenceMandate | null;
  plan: DefencePlan | null;
  feeBalance: bigint;
  watch: DefenceWatch | null;
  gasLow: boolean | null;
  /** how close to expiry reads as expiring, default one day */
  expiringWithinSec?: number;
}

export interface DefenceView {
  phase: DefencePhase;
  mandate: MandatePhase;
  plan: PlanPhase;
  watch: WatchPhase;
  gas: GasPhase;
  allowedActions: DefenceAction[];
  nextEvent: { kind: "mandate-expiry" | "plan-expiry" | "none"; at: number | null };
  reason: string;
}

const ZERO = "0x0000000000000000000000000000000000000000";
const DEFAULT_EXPIRING_SEC = 24 * 60 * 60;

function mandatePhase(mandate: DefenceMandate | null, now: number, expiringWithin: number): MandatePhase {
  if (!mandate || !mandate.active) return "none";
  if (mandate.expiry <= now) return "expired";
  if (mandate.expiry - now <= expiringWithin) return "expiring";
  return "active";
}

function planPhase(plan: DefencePlan | null, now: number): PlanPhase {
  if (!plan || !plan.agent || plan.agent.toLowerCase() === ZERO) return "none";
  if (plan.expiry <= now) return "expired";
  return "active";
}

function watchPhase(watch: DefenceWatch | null): WatchPhase {
  if (!watch) return "unknown";
  if (watch.stale) return "stale";
  if (!watch.ok || watch.consecutiveFailures >= 2) return "degraded";
  return "healthy";
}

function gasPhase(gasLow: boolean | null): GasPhase {
  if (gasLow === null) return "unknown";
  return gasLow ? "low" : "ok";
}

function reasonFor(
  phase: DefencePhase,
  watch: WatchPhase,
  gas: GasPhase,
  interval: number,
): string {
  if (phase === "unprotected") {
    return "No mandate. The agent cannot touch a position until you write one.";
  }
  if (phase === "lapsed") {
    return "The mandate has expired. The agent cannot act until you write a new one.";
  }
  if (phase === "degraded") {
    if (gas === "low") {
      return "The mandate is active, but the guard cannot pay network fees, so a repayment may fail.";
    }
    if (watch === "stale") {
      return "The mandate is active, but the watcher has gone quiet, so nothing is checking the position.";
    }
    return "The mandate is active, but the last watch runs failed. Check the guard before relying on it.";
  }
  if (phase === "expiring") {
    return `The mandate is active and expires in about ${Math.max(1, Math.round(interval / 3600))} hours.`;
  }
  return "The mandate is active and the watcher is checking the position.";
}

export function deriveDefence(input: DefenceInput): DefenceView {
  const now = input.now;
  const expiringWithin = input.expiringWithinSec ?? DEFAULT_EXPIRING_SEC;
  const mandate = mandatePhase(input.mandate, now, expiringWithin);
  const plan = planPhase(input.plan, now);
  const watch = watchPhase(input.watch);
  const gas = gasPhase(input.gasLow);

  const interval = input.mandate ? input.mandate.expiry - now : 0;

  let phase: DefencePhase;
  if (mandate === "none") phase = "unprotected";
  else if (mandate === "expired") phase = "lapsed";
  else if (watch === "stale" || watch === "degraded" || gas === "low") phase = "degraded";
  else if (mandate === "expiring") phase = "expiring";
  else phase = "protected";

  const allowedActions: DefenceAction[] = [];
  if (mandate === "none" || mandate === "expired" || mandate === "expiring") allowedActions.push("set-mandate");
  if (mandate !== "none") allowedActions.push("revoke");
  if (plan === "none" || plan === "expired") allowedActions.push("fund");
  if (plan === "active") allowedActions.push("cancel");
  if (input.feeBalance > 0n) allowedActions.push("withdraw");
  if (gas === "low") allowedActions.push("top-up");

  let nextEvent: DefenceView["nextEvent"] = { kind: "none", at: null };
  if (mandate === "active" || mandate === "expiring") {
    nextEvent = { kind: "mandate-expiry", at: input.mandate?.expiry ?? null };
  } else if (plan === "active") {
    nextEvent = { kind: "plan-expiry", at: input.plan?.expiry ?? null };
  }

  return {
    phase,
    mandate,
    plan,
    watch,
    gas,
    allowedActions,
    nextEvent,
    reason: reasonFor(phase, watch, gas, interval),
  };
}
