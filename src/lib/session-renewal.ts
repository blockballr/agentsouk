// Session renewal. A grant carries an expiry and a set of contracts it may
// call, so it lapses on its own and breaks when the vault is redeployed. This
// re-grants the same wallet with its own admin key, to the vault the chain
// reads now, and writes the new record back. It never returns key material.
import "server-only";

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, signerFromPrivateKey, serializeSession, BNB, BNB_TESTNET } from "@altananetwork/sdk";
import { generatePrivateKey } from "viem/accounts";
import { loadAltanaSessionsFromDb, saveAltanaSession, type AltanaSessionRecord } from "./altana-store";
import { needsRenewal, readSessionScope } from "./session-scope";
import { vaultFor } from "./vault";
import { BSC_TESTNET_CHAIN_ID, targetChainId } from "./types";

const SPEND_LIMIT = 1_000_000_000_000_000_000n;
const EXPIRY_DAYS = 30;
// the grant names the vault's functions, not its address, so a redeploy does not
// break it. the vault still bounds every call it receives.
const CALL_SCOPE = [
  { signature: "trade(uint256,address,uint256,uint256)" },
  { signature: "supplyToVenue(uint256,address,uint256)" },
  { signature: "withdrawFromVenue(uint256,address,uint256)" },
  { signature: "closeIfGoal(uint256,uint256)" },
] as const;

export interface RenewalOutcome {
  tokenId: string;
  walletAddress: string;
  reason: "expiring" | "stale" | "forced" | null;
  renewed: boolean;
  expiry: number | null;
  error?: string;
}

export interface RenewalRun {
  chainId: number;
  vault: string | null;
  windowDays: number;
  dry: boolean;
  outcomes: RenewalOutcome[];
  renewed: string[];
}

// the database is the production store; the file stands in for local runs, and
// it is the only copy that carries the admin key outside the database
export async function loadSessionsWithAdmin(chainId: number): Promise<AltanaSessionRecord[]> {
  const fromDb = await loadAltanaSessionsFromDb(chainId).catch(() => []);
  if (fromDb.length > 0) return fromDb;
  const file = path.join(process.cwd(), "data", "altana-sessions.json");
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, AltanaSessionRecord & { chainId?: number }>;
  const out: AltanaSessionRecord[] = [];
  for (const [tokenId, rec] of Object.entries(raw)) {
    if (!rec || rec.chainId !== chainId) continue;
    if (!rec.walletAddress || !rec.sessionBlob || !rec.sessionKey) continue;
    out.push({ ...rec, tokenId, chainId, label: rec.label ?? tokenId });
  }
  return out;
}

export async function renewSessions(options: {
  chainId?: number;
  windowDays?: number;
  dry?: boolean;
  force?: boolean;
} = {}): Promise<RenewalRun> {
  const chainId = options.chainId ?? targetChainId();
  const windowDays = options.windowDays ?? 7;
  const dry = options.dry === true;
  const force = options.force === true;
  const vault = vaultFor(chainId);
  const rows = await loadSessionsWithAdmin(chainId);
  const outcomes: RenewalOutcome[] = [];
  const renewed: string[] = [];

  if (!vault) {
    return {
      chainId,
      vault,
      windowDays,
      dry,
      outcomes: rows.map((row) => ({
        tokenId: row.tokenId,
        walletAddress: row.walletAddress,
        reason: null,
        renewed: false,
        expiry: row.expiry ?? null,
        error: `no vault on chain ${chainId}`,
      })),
      renewed,
    };
  }

  const client = createClient({ chains: [chainId === BSC_TESTNET_CHAIN_ID ? BNB_TESTNET : BNB] });

  for (const row of rows) {
    const scope = readSessionScope(
      row.tokenId,
      row.walletAddress,
      row.sessionBlob,
      row.expiry ?? null,
      vault,
    );
    const reason: "expiring" | "stale" | "forced" | null = force
      ? "forced"
      : scope.stale
        ? "stale"
        : needsRenewal(row.expiry ?? null, Date.now(), windowDays)
          ? "expiring"
          : null;
    if (reason === null) {
      outcomes.push({
        tokenId: row.tokenId,
        walletAddress: row.walletAddress,
        reason: null,
        renewed: false,
        expiry: row.expiry ?? null,
      });
      continue;
    }
    if (!row.adminKey) {
      outcomes.push({
        tokenId: row.tokenId,
        walletAddress: row.walletAddress,
        reason,
        renewed: false,
        expiry: row.expiry ?? null,
        error: "no admin key stored for this wallet",
      });
      continue;
    }
    if (dry) {
      outcomes.push({
        tokenId: row.tokenId,
        walletAddress: row.walletAddress,
        reason,
        renewed: false,
        expiry: row.expiry ?? null,
      });
      continue;
    }

    try {
      const adminSigner = signerFromPrivateKey(row.adminKey as `0x${string}`);
      const sessionKey = generatePrivateKey();
      const sessionSigner = signerFromPrivateKey(sessionKey);
      const expiry = Math.floor(Date.now() / 1000) + EXPIRY_DAYS * 24 * 60 * 60;
      const granted = await client.grantSession({
        wallet: { address: row.walletAddress as `0x${string}` },
        signer: adminSigner,
        chainId,
        permissions: {
          calls: CALL_SCOPE,
          spend: [{ limit: SPEND_LIMIT, period: "day" }],
        },
        expiry,
        sessionSigner,
        register: false,
      });
      const saved = await saveAltanaSession({
        tokenId: row.tokenId,
        chainId,
        label: row.label ?? row.tokenId,
        walletAddress: row.walletAddress,
        sessionBlob: JSON.stringify(serializeSession(granted)),
        sessionKey,
        adminKey: row.adminKey,
        expiry,
        createdAt: new Date().toISOString(),
      });
      if (!saved) throw new Error("the grant landed but the record did not save");
      renewed.push(row.tokenId);
      outcomes.push({
        tokenId: row.tokenId,
        walletAddress: row.walletAddress,
        reason,
        renewed: true,
        expiry,
      });
    } catch (e) {
      outcomes.push({
        tokenId: row.tokenId,
        walletAddress: row.walletAddress,
        reason,
        renewed: false,
        expiry: row.expiry ?? null,
        error: (e as Error).message.slice(0, 200),
      });
    }
  }

  return { chainId, vault, windowDays, dry, outcomes, renewed };
}
