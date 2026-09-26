// Self-serve registration claims: one ERC-8004 register() flow, minted before the owner signs.

import { randomUUID } from "node:crypto";
import { decodeFunctionData } from "viem";
import { REGISTER_ABI, type RegistrationDraft } from "./registry-write";

export type ClaimStatus = "prepared" | "confirmed";

export interface ListingClaim {
  claimId: string;
  chainId: number;
  owner: string;
  agentUri: string;
  draft: RegistrationDraft;
  status: ClaimStatus;
  agentId: string | null;
  txHash: string | null;
  createdAt: string;
  confirmedAt: string | null;
  expiresAt: number;
}

const memory = new Map<string, ListingClaim>();

type Sql = {
  (t: TemplateStringsArray, ...v: unknown[]): Promise<unknown>;
  json: (v: unknown) => unknown;
};

// Every write and read is capped: a database that misses its deadline is a slower store, not a broken one.
const DB_DEADLINE_MS = 5000;

let client: Promise<Sql | null> | null = null;
let tableReady: Promise<boolean> | null = null;

async function withinDeadline<T>(work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then((value) => value, () => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), DB_DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function createClient(): Promise<Sql | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const mod = (await import("postgres")) as unknown as {
      default: (url: string, opts?: object) => unknown;
    };
    return mod.default(url, { max: 1, idle_timeout: 20, connect_timeout: 5 }) as Sql;
  } catch {
    return null;
  }
}

// Only a successful connection is memoised, so a database that is down at boot does not poison the process.
async function db(): Promise<Sql | null> {
  if (!client) {
    const sql = await createClient();
    if (!sql) return null;
    client = Promise.resolve(sql);
  }
  return client;
}

async function ensureTable(sql: Sql): Promise<boolean> {
  if (!tableReady) {
    tableReady = (async () => {
      try {
        await sql`
          create table if not exists listing_claims (
            claim_id text primary key,
            payload jsonb not null,
            created_at timestamptz default now()
          )
        `;
        return true;
      } catch {
        tableReady = null;
        return false;
      }
    })();
  }
  return tableReady;
}

async function persist(claim: ListingClaim): Promise<boolean> {
  const sql = await db();
  if (!sql) return false;
  const written = await withinDeadline(
    (async () => {
      if (!(await ensureTable(sql))) return false;
      await sql`
        insert into listing_claims (claim_id, payload)
        values (${claim.claimId}, ${sql.json(claim as never)})
        on conflict (claim_id) do update set payload = excluded.payload
      `;
      return true;
    })(),
  );
  return written === true;
}

// A row that does not parse is treated as absent rather than published half served.
function isListingClaim(value: unknown): value is ListingClaim {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<ListingClaim>;
  return (
    typeof c.claimId === "string" &&
    c.claimId.length > 0 &&
    typeof c.chainId === "number" &&
    typeof c.agentUri === "string" &&
    !!c.draft &&
    typeof c.draft === "object" &&
    (c.status === "prepared" || c.status === "confirmed")
  );
}

async function readThrough(claimId: string): Promise<ListingClaim | null> {
  const sql = await db();
  if (!sql) return null;
  return withinDeadline(
    (async () => {
      if (!(await ensureTable(sql))) return null;
      const rows = (await sql`
        select payload from listing_claims where claim_id = ${claimId} limit 1
      `) as Array<{ payload?: unknown }>;
      const payload = rows[0]?.payload;
      return isListingClaim(payload) ? payload : null;
    })(),
  );
}

export function claimsMode(): "postgres" | "memory" {
  return process.env.DATABASE_URL ? "postgres" : "memory";
}

// A v4 uuid, not a counter: the claim id is all that stands between a published document and a guessed url.
export function newClaimId(): string {
  return randomUUID();
}

// A prepared claim is public storage plus an open confirm endpoint, so it expires.
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

export function isClaimExpired(claim: ListingClaim, now = Date.now()): boolean {
  return claim.status !== "confirmed" && now > claim.expiresAt;
}

export async function createClaim(input: {
  claimId: string;
  chainId: number;
  owner: string;
  agentUri: string;
  draft: RegistrationDraft;
}): Promise<ListingClaim> {
  const claim: ListingClaim = {
    claimId: input.claimId,
    chainId: input.chainId,
    owner: input.owner,
    agentUri: input.agentUri,
    draft: input.draft,
    status: "prepared",
    agentId: null,
    txHash: null,
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    expiresAt: Date.now() + CLAIM_TTL_MS,
  };
  memory.set(claim.claimId, claim);
  await persist(claim);
  return claim;
}

export async function getClaim(claimId: string): Promise<ListingClaim | null> {
  const key = (claimId ?? "").trim();
  if (!key) return null;
  const cached = memory.get(key);
  if (cached) return cached;
  const stored = await readThrough(key);
  if (stored) memory.set(key, stored);
  return stored;
}

export async function confirmClaim(
  claimId: string,
  patch: { agentId: string; txHash: string },
): Promise<ListingClaim | null> {
  const existing = await getClaim(claimId);
  if (!existing) return null;
  const next: ListingClaim = {
    ...existing,
    status: "confirmed",
    agentId: patch.agentId,
    txHash: patch.txHash,
    confirmedAt: new Date().toISOString(),
  };
  memory.set(next.claimId, next);
  await persist(next);
  return next;
}

// An agent id is a uint256 carried as a decimal string; accept the 0x form too, since wallets differ.
export function parseAgentId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = BigInt(raw);
    return parsed < 0n ? null : parsed.toString();
  } catch {
    return null;
  }
}

export function isTxHash(value: unknown): boolean {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

export function isWalletAddress(value: unknown): boolean {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

// ERC-721 Transfer: the mint is the only log tying a transaction hash to the new agent id.
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
// register(string), pinned in test-registry-write.ts
const REGISTER_SELECTOR = "0xf2c298be";

export interface RegistrationProof {
  registry: string;
  agentId: string;
  agentUri: string;
  owner: string;
  receipt: {
    status: string;
    to: string | null;
    logs: ReadonlyArray<{ address: string; topics: readonly string[] }>;
  };
  calldata: `0x${string}`;
  tokenURI: string;
  holder: string;
}

export type ProofResult = { ok: true } | { ok: false; reason: string };

// Judge everything the chain said about one registration in one pure place, so the rule can be pinned without an RPC.
export function checkRegistrationProof(proof: RegistrationProof): ProofResult {
  const registry = proof.registry.toLowerCase();
  const { receipt } = proof;

  if (receipt.status !== "success") {
    return { ok: false, reason: "That transaction reverted, so no agent was registered." };
  }
  if ((receipt.to ?? "").toLowerCase() !== registry) {
    return { ok: false, reason: "That transaction did not call the ERC-8004 identity registry." };
  }

  let minted: bigint | null = null;
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() === registry &&
      log.topics[0] === TRANSFER_TOPIC &&
      log.topics.length === 4
    ) {
      minted = BigInt(log.topics[3]);
      break;
    }
  }
  if (minted === null) {
    return { ok: false, reason: "That transaction minted no agent in the registry." };
  }
  if (minted.toString() !== proof.agentId) {
    return {
      ok: false,
      reason: `That transaction registered agent ${minted}, not ${proof.agentId}.`,
    };
  }

  if (proof.calldata.slice(0, 10) !== REGISTER_SELECTOR) {
    return { ok: false, reason: "That transaction did not call register(string)." };
  }
  let signedUri: string;
  try {
    signedUri = decodeFunctionData({ abi: REGISTER_ABI, data: proof.calldata }).args[0];
  } catch {
    return { ok: false, reason: "That transaction's input is not a register call." };
  }
  if (signedUri.trim() !== proof.agentUri) {
    return { ok: false, reason: "That transaction registered a different agentURI than this claim." };
  }

  if (proof.tokenURI.trim() !== proof.agentUri) {
    return { ok: false, reason: "The registry records a different agentURI for that agent." };
  }
  if (proof.owner && proof.holder.toLowerCase() !== proof.owner.toLowerCase()) {
    return {
      ok: false,
      reason: "That agent is registered to a different wallet than this claim was prepared for.",
    };
  }

  return { ok: true };
}
