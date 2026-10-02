// the team panel's figures, worked out from plain records so they can be tested without a store

import { formatUnits } from "./format";
import { isTeamWallet, isVerifierPayment } from "./team-wallets";

export type PayerKind = "buyer" | "check" | "team" | "self";

export interface PaymentRow {
  paymentId: string;
  createdAt: string;
  client: string;
  payTo: string;
  amount: string;
  symbol: string;
  // decimals of the settlement asset, or null on a chain that is not configured
  decimals: number | null;
  mode: string;
  chainId: number;
  tokenId: string;
  agentName: string;
  txHash: string | null;
}

// our own checks, our own wallets and a wallet paying itself are never a buyer's hire
export function payerKind(p: { paymentId: string; client: string; payTo?: string }): PayerKind {
  if (isVerifierPayment(p.paymentId)) return "check";
  if (isTeamWallet(p.client)) return "team";
  return p.payTo && p.payTo.toLowerCase() === p.client.toLowerCase() ? "self" : "buyer";
}

export function isSettled(p: { mode: string }): boolean {
  return p.mode === "prod" || p.mode === "b402";
}

export interface SettledTotal {
  chainId: number;
  symbol: string;
  amount: string;
}

// amounts are raw units, so two assets are never added together, nor one symbol across two chains
export function settledTotals(rows: readonly PaymentRow[]): SettledTotal[] {
  const totals = new Map<string, { chainId: number; symbol: string; raw: bigint; decimals: number | null; count: number }>();
  for (const p of rows) {
    const key = `${p.chainId}:${p.symbol}`;
    const entry = totals.get(key) ?? { chainId: p.chainId, symbol: p.symbol, raw: BigInt(0), decimals: p.decimals, count: 0 };
    try {
      entry.raw += BigInt(p.amount);
    } catch {
      // an amount that cannot be read is left out, not guessed
    }
    entry.count += 1;
    totals.set(key, entry);
  }
  return [...totals.values()].map((t) => ({
    chainId: t.chainId,
    symbol: t.symbol,
    amount: t.decimals === null ? `${t.count} payments` : formatUnits(t.raw, t.decimals),
  }));
}

export interface WindowFigures {
  key: "today" | "week" | "all";
  buyerHires: number;
  ownChecks: number;
  settled: SettledTotal[];
}

// a window that starts at zero is all time, and keeps a receipt whose date cannot be read
export function windowFigures(rows: readonly PaymentRow[], key: WindowFigures["key"], since: number): WindowFigures {
  const inside = rows.filter((p) => isSettled(p) && (since <= 0 || Date.parse(p.createdAt) >= since));
  const buyers = inside.filter((p) => payerKind(p) === "buyer");
  return {
    key,
    buyerHires: buyers.length,
    ownChecks: inside.filter((p) => payerKind(p) === "check").length,
    settled: settledTotals(buyers),
  };
}

export function lastDays(days: number, now: number): string[] {
  return Array.from({ length: days }, (_, i) => new Date(now - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export function countByDay(dates: readonly string[], days: number, now: number): { day: string; count: number }[] {
  const out = lastDays(days, now).map((day) => ({ day, count: 0 }));
  const at = new Map(out.map((d, i) => [d.day, i]));
  for (const d of dates) {
    const t = Date.parse(d);
    if (!Number.isFinite(t)) continue;
    const i = at.get(new Date(t).toISOString().slice(0, 10));
    if (i !== undefined) out[i].count += 1;
  }
  return out;
}

// a gated agent answered, so it passes; only no answer at all is a failed check
export function checkPassed(status: string): boolean {
  return status === "delivered" || status === "gated";
}

export function checksByDay(
  checks: readonly { status: string; checkedAt: string }[],
  days: number,
  now: number,
): { day: string; passed: number; failed: number }[] {
  const out = lastDays(days, now).map((day) => ({ day, passed: 0, failed: 0 }));
  const at = new Map(out.map((d, i) => [d.day, i]));
  for (const c of checks) {
    const t = Date.parse(c.checkedAt);
    if (!Number.isFinite(t)) continue;
    const i = at.get(new Date(t).toISOString().slice(0, 10));
    if (i === undefined) continue;
    if (checkPassed(c.status)) out[i].passed += 1;
    else out[i].failed += 1;
  }
  return out;
}

export interface StuckItem {
  kind: "delivery failed" | "paid, nothing delivered";
  id: string;
  since: string;
  note: string;
}

const HOUR_MS = 60 * 60 * 1000;
const STUCK_CAP = 100;

// a failed task, or a job paid an hour ago with nothing delivered against it
// each kind is capped on its own, so a run of failures cannot hide a job that is still waiting
export function stuckItems(
  jobs: readonly { id: string; status: string; paymentId?: string; agentName: string; updatedAt: string }[],
  tasks: readonly { id: string; status: string; paymentId: string; agentName: string; error?: string; updatedAt: string }[],
  now: number,
): StuckItem[] {
  const failed: StuckItem[] = [];
  for (const t of tasks) {
    if (t.status !== "failed" || isVerifierPayment(t.paymentId)) continue;
    failed.push({ kind: "delivery failed", id: t.id, since: t.updatedAt, note: `${t.agentName}: ${(t.error ?? "no reason recorded").slice(0, 160)}` });
  }
  const waiting: StuckItem[] = [];
  for (const j of jobs) {
    if (j.status !== "Funded" || isVerifierPayment(j.paymentId)) continue;
    if (now - Date.parse(j.updatedAt) < HOUR_MS) continue;
    waiting.push({ kind: "paid, nothing delivered", id: j.id, since: j.updatedAt, note: j.agentName });
  }
  const newest = (a: StuckItem, b: StuckItem) => b.since.localeCompare(a.since);
  // the latest failures, and the jobs that have waited longest
  const kept = [...failed.sort(newest).slice(0, STUCK_CAP), ...waiting.sort(newest).slice(-STUCK_CAP)];
  return kept.sort(newest);
}
