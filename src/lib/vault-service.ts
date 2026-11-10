// What an agent's card says about the vault: which strategy would run a hire,
// and who runs it. The marketplace only ever sweeps a hire whose named agent is
// one of its own executors, because the vault lets only that agent trade. A
// third-party agent declares the same policy and executes it itself with the
// vault SDK, and this field is how the marketplace knows not to expect to run it.

export const VAULT_POLICIES = ["porter", "band", "buffer", "grid"] as const;
export type VaultPolicy = (typeof VAULT_POLICIES)[number];

// soukdio: the marketplace sweep trades the hire. agent: its owner runs the SDK.
export type VaultExecutor = "soukdio" | "agent";

export interface VaultService {
  policy: VaultPolicy;
  executor: VaultExecutor;
}

export function isVaultPolicy(value: unknown): value is VaultPolicy {
  return typeof value === "string" && (VAULT_POLICIES as readonly string[]).includes(value);
}

// The card may publish services as an object keyed by protocol, which is how
// this marketplace writes them, or as the ERC-8004 list of named entries.
export function readVaultService(services: unknown): VaultService | null {
  let raw: unknown = null;
  if (Array.isArray(services)) {
    raw = services.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const record = entry as Record<string, unknown>;
      return String(record.name ?? record.protocol ?? "").toLowerCase() === "vault";
    }) ?? null;
  } else if (services && typeof services === "object") {
    raw = (services as Record<string, unknown>).vault;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const policy = String(record.policy ?? "").trim().toLowerCase();
  if (!isVaultPolicy(policy)) return null;
  // a card cannot claim the marketplace runs its hire: only a first-party agent
  // is swept here, and the tag route is the one that knows which those are
  return { policy, executor: "agent" };
}

export function vaultService(policy: VaultPolicy, executor: VaultExecutor = "agent"): VaultService {
  return { policy, executor };
}
