import "server-only";

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface FirstPartySkill {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
}

export interface FirstPartyAgent {
  chainId: number;
  tokenId: string;
  name?: string;
  claimId?: string;
  wallet?: string;
  policy?: string;
  category?: string;
  vaultOnly?: boolean;
  description?: string;
  minDepositUsd?: number;
  skills?: FirstPartySkill[];
  // the permanent registration URL and the A2A card it serves
  slug?: string;
  card?: string;
  // a planned mainnet agent whose token id is not minted yet
  pending?: boolean;
}

let cache: FirstPartyAgent[] | null = null;
let cacheMtime = 0;

function all(): FirstPartyAgent[] {
  try {
    const file = path.join(process.cwd(), "data", "first-party-agents.json");
    const mtime = statSync(file).mtimeMs;
    if (cache && mtime === cacheMtime) return cache;
    const raw = JSON.parse(readFileSync(file, "utf8")) as { agents?: FirstPartyAgent[] };
    cache = Array.isArray(raw?.agents) ? raw.agents.filter((a) => !a.pending) : [];
    cacheMtime = mtime;
  } catch {
    if (!cache) cache = [];
  }
  return cache ?? [];
}

function byToken(chainId: number, tokenId: string): FirstPartyAgent | null {
  return all().find((a) => a.chainId === Number(chainId) && a.tokenId === String(tokenId)) ?? null;
}

function byClaim(claimId: string): FirstPartyAgent | null {
  const id = claimId.toLowerCase();
  return all().find((a) => a.claimId?.toLowerCase() === id) ?? null;
}

export function firstPartyDescription(chainId: number, tokenId: string): string | null {
  return byToken(chainId, tokenId)?.description ?? null;
}

export function firstPartyWallet(chainId: number, tokenId: string): string | null {
  return byToken(chainId, tokenId)?.wallet ?? null;
}

export function firstPartySkills(chainId: number, tokenId: string): FirstPartySkill[] | null {
  const agent = byToken(chainId, tokenId);
  const skills = agent?.skills;
  if (!skills || skills.length === 0) return null;
  return skills.map((skill) => ({
    ...skill,
    tags: [...(skill.tags ?? []), ...(agent.category ? [agent.category] : [])],
  }));
}

export function firstPartyCategory(chainId: number, tokenId: string): string | null {
  return byToken(chainId, tokenId)?.category ?? null;
}

export function firstPartyImage(chainId: number, tokenId: string): string | null {
  if (!byToken(chainId, tokenId)) return null;
  return `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(`${chainId}/${tokenId}`)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&backgroundType=gradientLinear`;
}

export function firstPartyVaultOnly(chainId: number, tokenId: string): boolean {
  return byToken(chainId, tokenId)?.vaultOnly === true;
}

// an agent may set a higher entry than the vault's floor; the page reads this so
// the buyer sees the real minimum before signing, not a revert
export function firstPartyMinDeposit(chainId: number, tokenId: string): number | null {
  const value = byToken(chainId, tokenId)?.minDepositUsd;
  return typeof value === "number" && value > 0 ? value : null;
}

export function firstPartyPolicy(chainId: number, wallet: string): { policy: string; tokenId: string } | null {
  const id = wallet.toLowerCase();
  const agent = all().find((a) => a.chainId === Number(chainId) && a.wallet?.toLowerCase() === id);
  return agent?.policy ? { policy: agent.policy, tokenId: agent.tokenId } : null;
}

// the badge a hire row shows: the strategy the listing declared, not a guess
// from the agent's name or from what its last trade happened to look like
export interface FirstPartyBadge {
  tokenId: string;
  name: string | null;
  wallet: string;
  category: string | null;
  policy: string | null;
  vaultOnly: boolean;
}

export function firstPartyBadges(chainId: number): FirstPartyBadge[] {
  return all()
    .filter((a) => a.chainId === Number(chainId) && a.wallet)
    .map((a) => ({
      tokenId: a.tokenId,
      name: a.name ?? null,
      wallet: (a.wallet as string).toLowerCase(),
      category: a.category ?? null,
      policy: a.policy ?? null,
      vaultOnly: a.vaultOnly === true,
    }));
}

export function firstPartyClaimDescription(claimId: string): string | null {
  return byClaim(claimId)?.description ?? null;
}

export function firstPartyClaimWallet(claimId: string): string | null {
  return byClaim(claimId)?.wallet ?? null;
}

export function firstPartyClaimVaultOnly(claimId: string): boolean {
  return byClaim(claimId)?.vaultOnly === true;
}

export function firstPartyClaimCategory(claimId: string): string | null {
  return byClaim(claimId)?.category ?? null;
}
