// What a stored Altana session may call, and whether it can still reach the
// vault this chain reads. A grant names either a contract, a function selector,
// or both, so a redeploy only breaks the grants that pinned a contract. The
// relay answers an out of scope call with an opaque UnauthorizedCall, so the
// executor reads the grant first and names the session instead.

// the functions the executor needs against a HireVault, by signature
export const VAULT_FUNCTIONS = [
  "trade(uint256,address,uint256,uint256)",
  "supplyToVenue(uint256,address,uint256)",
  "withdrawFromVenue(uint256,address,uint256)",
  "closeIfGoal(uint256,uint256)",
] as const;

export interface CallRule {
  // null when the rule does not name a contract
  to: string | null;
  // null when the rule allows every function on that contract
  signature: string | null;
}

export interface CallScope {
  rules: CallRule[];
  // true when the grant carries no calls list, which allows every call
  unrestricted: boolean;
}

export interface SessionScope {
  tokenId: string;
  walletAddress: string;
  expiry: number | null;
  targets: string[];
  signatures: string[];
  unrestricted: boolean;
  // true when the grant cannot reach the live vault for every needed function
  stale: boolean;
  expiresInDays: number | null;
}

export function readCallScope(blob: string): CallScope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    // an unreadable grant cannot be trusted to reach the vault
    return { rules: [], unrestricted: false };
  }
  const permissions = (parsed as { permissions?: { calls?: unknown } } | null)?.permissions;
  const calls = permissions?.calls;
  if (!Array.isArray(calls)) return { rules: [], unrestricted: true };
  const rules: CallRule[] = [];
  for (const call of calls) {
    const entry = call as { to?: unknown; signature?: unknown } | null;
    const to = typeof entry?.to === "string" && entry.to.length > 0 ? entry.to.toLowerCase() : null;
    const signature = typeof entry?.signature === "string" && entry.signature.length > 0 ? entry.signature : null;
    rules.push({ to, signature });
  }
  return { rules, unrestricted: false };
}

// the vault functions a grant can actually reach
export function reachableFunctions(scope: CallScope, vault: string | null): Set<string> {
  if (scope.unrestricted) return new Set(VAULT_FUNCTIONS);
  const covered = new Set<string>();
  for (const rule of scope.rules) {
    const onVault = rule.to === null || (vault !== null && rule.to === vault.toLowerCase());
    if (!onVault) continue;
    if (rule.signature === null) {
      for (const fn of VAULT_FUNCTIONS) covered.add(fn);
    } else {
      covered.add(rule.signature);
    }
  }
  return covered;
}

export function missingFunctions(scope: CallScope, vault: string | null): string[] {
  const covered = reachableFunctions(scope, vault);
  return VAULT_FUNCTIONS.filter((fn) => !covered.has(fn));
}

export function isStaleTarget(scope: CallScope, vault: string | null): boolean {
  if (!vault) return false;
  return missingFunctions(scope, vault).length > 0;
}

export function daysUntil(expiry: number | null, now: number = Date.now()): number | null {
  if (expiry == null || !Number.isFinite(expiry) || expiry <= 0) return null;
  return Math.floor((expiry * 1000 - now) / 86_400_000);
}

export function needsRenewal(expiry: number | null, now: number = Date.now(), windowDays = 7): boolean {
  const days = daysUntil(expiry, now);
  // no expiry is a grant that never lapses, so there is nothing to renew
  if (days == null) return false;
  return days <= windowDays;
}

export function readSessionScope(
  tokenId: string,
  walletAddress: string,
  blob: string,
  expiry: number | null,
  vault: string | null,
  now: number = Date.now(),
): SessionScope {
  const scope = readCallScope(blob);
  return {
    tokenId,
    walletAddress,
    expiry,
    targets: scope.rules.map((rule) => rule.to).filter((to): to is string => to !== null),
    signatures: scope.rules.map((rule) => rule.signature).filter((sig): sig is string => sig !== null),
    unrestricted: scope.unrestricted,
    stale: isStaleTarget(scope, vault),
    expiresInDays: daysUntil(expiry, now),
  };
}
