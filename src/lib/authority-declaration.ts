// What an owner declares about how their agent may act, at registration and after.
// The declaration is a ceiling: the hire time grant can narrow it from the
// record, never widen it, so a fresh listing cannot buy itself authority.

export type DeclaredModel = "leash" | "job-scoped" | "underwritten";

export const DECLARED_MODELS: DeclaredModel[] = ["leash", "job-scoped", "underwritten"];

export interface AuthorityDeclaration {
  model: DeclaredModel;
  capUsd: number | null;
  expiresHours: number | null;
  bondUsd: number | null;
  bondWallet: string | null;
  scope: string[];
}

export interface StoredDeclaration extends AuthorityDeclaration {
  updatedAt: string;
  updatedBy: string;
}

export type DeclarationCheck =
  | { ok: true; value: AuthorityDeclaration }
  | { ok: false; errors: string[] };

const MAX_CAP_USD = 10_000;
const MAX_EXPIRY_HOURS = 24 * 365;
const MAX_BOND_USD = 1_000_000;
const MAX_SCOPE = 8;

function money(value: number): number {
  return Number(value.toFixed(2));
}

function wallet(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function normaliseDeclaration(input: unknown): DeclarationCheck {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return { ok: false, errors: ["declaration must be an object"] };
  const raw = input as Record<string, unknown>;

  const model = raw.model;
  if (model !== "leash" && model !== "job-scoped" && model !== "underwritten") {
    errors.push(`model must be one of ${DECLARED_MODELS.join(", ")}`);
  }

  const capRaw = raw.capUsd;
  let capUsd: number | null = null;
  if (capRaw !== null && capRaw !== undefined) {
    const value = Number(capRaw);
    if (!Number.isFinite(value) || value < 0 || value > MAX_CAP_USD) {
      errors.push(`capUsd must be between 0 and ${MAX_CAP_USD}`);
    } else {
      capUsd = money(value);
    }
  }

  const expiryRaw = raw.expiresHours;
  let expiresHours: number | null = null;
  if (expiryRaw !== null && expiryRaw !== undefined) {
    const value = Number(expiryRaw);
    if (!Number.isInteger(value) || value < 1 || value > MAX_EXPIRY_HOURS) {
      errors.push(`expiresHours must be a whole number from 1 to ${MAX_EXPIRY_HOURS}`);
    } else {
      expiresHours = value;
    }
  }

  const bondRaw = raw.bondUsd;
  let bondUsd: number | null = null;
  if (bondRaw !== null && bondRaw !== undefined) {
    const value = Number(bondRaw);
    if (!Number.isFinite(value) || value < 0 || value > MAX_BOND_USD) {
      errors.push(`bondUsd must be between 0 and ${MAX_BOND_USD}`);
    } else {
      bondUsd = money(value);
    }
  }

  const bondWalletRaw = raw.bondWallet;
  let bondWallet: string | null = null;
  if (typeof bondWalletRaw === "string" && bondWalletRaw.trim()) {
    if (!wallet(bondWalletRaw.trim())) errors.push("bondWallet must be a wallet address");
    else bondWallet = bondWalletRaw.trim();
  }

  const scopeRaw = raw.scope;
  let scope: string[] = [];
  if (Array.isArray(scopeRaw)) {
    scope = scopeRaw
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && s.length <= 32);
    if (scope.length > MAX_SCOPE) errors.push(`scope may name at most ${MAX_SCOPE} categories`);
    scope = [...new Set(scope)];
  } else if (scopeRaw !== undefined && scopeRaw !== null) {
    errors.push("scope must be an array of category names");
  }

  if (model === "underwritten" && (bondUsd === null || bondUsd <= 0)) {
    errors.push("an underwritten agent must declare a bond");
  }
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      model: model as DeclaredModel,
      capUsd,
      expiresHours,
      bondUsd,
      bondWallet,
      scope,
    },
  };
}

export function declarationDigest(value: AuthorityDeclaration): Promise<string> {
  const canonical = JSON.stringify({
    model: value.model,
    capUsd: value.capUsd,
    expiresHours: value.expiresHours,
    bondUsd: value.bondUsd,
    bondWallet: value.bondWallet?.toLowerCase() ?? null,
    scope: [...value.scope].sort(),
  });
  const bytes = new TextEncoder().encode(canonical);
  return crypto.subtle.digest("SHA-256", bytes).then((hash) =>
    [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
}

export function declarationMessage(
  chainId: number,
  tokenId: string,
  owner: string,
  digest: string,
  issuedAt: string,
): string {
  return [
    "Agent Souk authority declaration",
    `chain: ${chainId}`,
    `token: ${tokenId}`,
    `owner: ${owner.toLowerCase()}`,
    `declaration: ${digest}`,
    `issued: ${issuedAt}`,
  ].join("\n");
}

export const DECLARATION_SIGNATURE_WINDOW_MS = 10 * 60 * 1000;
