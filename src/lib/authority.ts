// Three ways an agent may act for a buyer, and the rule that picks between them.
// The dial everyone ships is a leash: one cap, one expiry, no account of who
// carries the loss. This module keeps the leash and adds two facts the leash
// ignores, a track record that widens it and a bond that stands behind it.

export type AuthorityModel = "job-scoped" | "earned" | "underwritten";

export type EarnedTier = "new" | "known" | "proven";

export type LossBearer = "escrow" | "owner-bond";

export interface AuthorityFacts {
  hires: number;
  completed: number;
  distinctBuyers: number;
  successRate: number | null;
  firstHireAt: string | null;
  verified: boolean;
  bondUsd: number | null;
  priceUsd: number;
  symbol?: string;
  now?: number;
}

export interface AuthorityGrant {
  model: AuthorityModel;
  tier: EarnedTier;
  spendCapUsd: number;
  expiresInHours: number;
  lossBearer: LossBearer;
  bondBackedUsd: number;
  reasons: string[];
}

export const MIN_BOND_USD = 5;
export const BOND_BACKING = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const WIDTH: Record<EarnedTier, number> = { new: 1, known: 1.5, proven: 2.5 };
const EXPIRY_HOURS: Record<EarnedTier, number> = { new: 24, known: 72, proven: 168 };

function ageDays(firstHireAt: string | null, now: number): number {
  if (!firstHireAt) return 0;
  const started = Date.parse(firstHireAt);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, (now - started) / DAY_MS);
}

function money(value: number): number {
  return Number(value.toFixed(2));
}

export function earnedTier(facts: AuthorityFacts): EarnedTier {
  const rate = facts.successRate ?? 0;
  const age = ageDays(facts.firstHireAt, facts.now ?? Date.now());
  if (facts.distinctBuyers >= 5 && facts.completed >= 10 && rate >= 0.9 && age >= 14) return "proven";
  if (facts.distinctBuyers >= 2 && facts.completed >= 2 && rate >= 0.8) return "known";
  return "new";
}

export interface DeclaredCeiling {
  model: "leash" | "job-scoped" | "underwritten";
  capUsd: number | null;
  expiresHours: number | null;
  bondUsd: number | null;
}

export function assessAuthority(
  facts: AuthorityFacts,
  declared?: DeclaredCeiling | null,
): AuthorityGrant {
  const base = baseGrant(facts);
  if (!declared) return base;

  const reasons = [...base.reasons];
  let cap = base.spendCapUsd;
  let expires = base.expiresInHours;
  let model = base.model;

  if (declared.model === "leash" || declared.model === "job-scoped") {
    cap = Math.min(cap, money(Math.max(0, facts.priceUsd)));
    model = "job-scoped";
    reasons.unshift("the owner declared a job-scoped lease, so the cap is one hire");
  } else if (declared.model === "underwritten" && base.model !== "underwritten") {
    reasons.unshift("the declared bond does not cover a hire at this price, so the record decides");
  }

  if (declared.capUsd !== null) {
    cap = Math.min(cap, money(declared.capUsd));
    reasons.push(`the owner declared a ceiling of ${money(declared.capUsd)}, which holds`);
  }
  if (declared.expiresHours !== null) {
    expires = Math.min(expires, declared.expiresHours);
    reasons.push(`the owner declared a shorter life of ${declared.expiresHours} hours`);
  }

  return { ...base, model, spendCapUsd: money(cap), expiresInHours: expires, reasons };
}

function baseGrant(facts: AuthorityFacts): AuthorityGrant {
  const price = Math.max(0, facts.priceUsd);
  const symbol = facts.symbol ?? "U";
  const tier = earnedTier(facts);
  const earnedCap = money(price * WIDTH[tier]);
  const bond = facts.bondUsd !== null && facts.bondUsd >= MIN_BOND_USD ? facts.bondUsd : null;
  const bondCap = bond === null ? 0 : money(bond / BOND_BACKING);

  if (bond !== null && bondCap >= price) {
    const cap = money(Math.min(Math.max(earnedCap, price), bondCap));
    return {
      model: "underwritten",
      tier,
      spendCapUsd: cap,
      expiresInHours: EXPIRY_HOURS[tier],
      lossBearer: "owner-bond",
      bondBackedUsd: money(bond),
      reasons: [
        `the owner holds ${money(bond)} ${symbol}, which backs ${bondCap} ${symbol} of work`,
        `the cap is the smaller of the earned width and the bond`,
        `the bond is a held balance, so a lost dispute is charged to it by policy, not yet by contract`,
      ],
    };
  }

  if (tier !== "new") {
    return {
      model: "earned",
      tier,
      spendCapUsd: earnedCap,
      expiresInHours: EXPIRY_HOURS[tier],
      lossBearer: "escrow",
      bondBackedUsd: 0,
      reasons: [
        `${facts.distinctBuyers} distinct buyers and ${facts.completed} completions put this agent at ${tier}`,
        `the cap is ${WIDTH[tier]} times the quoted price at this tier`,
        `no bond is posted, so the loss stops at the job escrow`,
      ],
    };
  }

  return {
    model: "job-scoped",
    tier,
    spendCapUsd: money(price),
    expiresInHours: EXPIRY_HOURS[tier],
    lossBearer: "escrow",
    bondBackedUsd: 0,
    reasons: [
      facts.hires === 0 ? "no buyer hire has been observed yet" : "the record is too thin to widen the cap",
      "the cap is one quoted price, so the agent can only ever spend this job",
      "the money sits in escrow and never enters the agent",
    ],
  };
}

export function describeAuthority(grant: AuthorityGrant): string {
  const bearer = grant.lossBearer === "owner-bond" ? "owner bond" : "the job escrow";
  return `${grant.model}, ${grant.spendCapUsd} U cap, loss borne by ${bearer}`;
}
