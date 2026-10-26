import "server-only";

import { createWalletClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { BNB, BNB_TESTNET, createClient, signerFromPrivateKey, type Call } from "@altananetwork/sdk";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { rpcTransport } from "./rpc";
import { BSC_CHAIN_ID, BSC_TESTNET_CHAIN_ID, targetChainId } from "./types";
import { loadAltanaSessionsFromDb, saveAltanaSession } from "./altana-store";


export interface VaultActor {
  readonly kind: "rawkey" | "altana";
  address(): Promise<string>;
  trade(call: Call): Promise<string>;
}

export interface AltanaSessionRecord {
  chainId: number;
  label?: string;
  tokenId?: string;
  walletAddress: string;
  sessionBlob: string;
  sessionKey: string;
}

function chainFor(chainId: number) {
  return chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc;
}

function rawKeyActor(chainId: number): VaultActor | null {
  const key = process.env.AGENT_EXECUTOR_KEY as `0x${string}` | undefined;
  if (!key) return null;
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: chainFor(chainId), transport: rpcTransport(chainId) });
  return {
    kind: "rawkey",
    async address() {
      return account.address;
    },
    async trade(call: Call) {
      const hash = await wallet.sendTransaction({ to: call.to as `0x${string}`, data: call.data as `0x${string}` ?? undefined, value: call.value ?? 0n });
      return hash;
    },
  };
}

function altanaActorFromSession(sessionBlob: string, sessionKey: string, chainId: number): VaultActor {
  let session: unknown;
  try {
    session = JSON.parse(sessionBlob);
  } catch {
    throw new Error("the granted session blob does not parse as a granted session");
  }
  const client = createClient({ chains: [chainId === BSC_TESTNET_CHAIN_ID ? BNB_TESTNET : BNB] });
  session = { ...(session as Record<string, unknown>), signer: signerFromPrivateKey(sessionKey as `0x${string}`) };
  return {
    kind: "altana",
    async address() {
      const granted = session as { walletAddress?: string; wallet?: { address?: string } };
      const walletAddress = granted.walletAddress ?? granted.wallet?.address;
      if (!walletAddress) throw new Error("the granted session does not carry the wallet address");
      return walletAddress;
    },
    async trade(call: Call) {
      const result = await client.execute({ session, calls: [call], chainId } as unknown as Parameters<typeof client.execute>[0]);
      const hash = (result as { transactionHash?: string }).transactionHash
        ?? ((result as { receipts?: { hash?: string }[] }).receipts?.[0]?.hash ?? (result as { callsId?: string }).callsId);
      if (!hash) throw new Error("the relay returned no receipt hash for the trade");
      return hash;
    },
  };
}

function altanaActorFromEnv(chainId: number): VaultActor | null {
  const sessionBlob = process.env.AGENT_ALTANA_SESSION;
  if (!sessionBlob) return null;
  const sessionKey = process.env.AGENT_ALTANA_SESSION_KEY as `0x${string}` | undefined;
  // an explicit session that cannot be used is a configuration error, not a
  // reason to fall through to another wallet without saying so
  if (!sessionKey) throw new Error("AGENT_ALTANA_SESSION is set but AGENT_ALTANA_SESSION_KEY is not");
  return altanaActorFromSession(sessionBlob, sessionKey, chainId);
}

export async function loadAltanaSessions(chainId: number): Promise<AltanaSessionRecord[]> {
  // DB first (production); file fallback (local dev).
  try {
    const fromDb = await loadAltanaSessionsFromDb(chainId);
    if (fromDb.length > 0) return fromDb;
  } catch {
    // fall through to file
  }
  try {
    const plural = path.join(process.cwd(), "data", "altana-sessions.json");
    if (existsSync(plural)) {
      const raw = JSON.parse(readFileSync(plural, "utf8")) as Record<string, {
        chainId?: number;
        label?: string;
        walletAddress?: string;
        sessionBlob?: string;
        sessionKey?: string;
      }>;
      const out: AltanaSessionRecord[] = [];
      for (const [tokenId, rec] of Object.entries(raw)) {
        if (!rec || rec.chainId !== chainId) continue;
        if (!rec.walletAddress || !rec.sessionBlob || !rec.sessionKey) continue;
        out.push({ chainId, label: rec.label ?? tokenId, tokenId, walletAddress: rec.walletAddress, sessionBlob: rec.sessionBlob, sessionKey: rec.sessionKey });
      }
      if (out.length > 0) return out;
    }
    const single = path.join(process.cwd(), "data", "altana-session.json");
    if (existsSync(single)) {
      const raw = JSON.parse(readFileSync(single, "utf8")) as { serialized?: unknown; sessionKey?: string; walletAddress?: string; chainId?: number };
      if (raw?.serialized && raw?.sessionKey) {
        const addr = raw.walletAddress ?? (raw.serialized as { walletAddress?: string })?.walletAddress;
        if (addr && (raw.chainId ?? chainId) === chainId) {
          return [{ chainId, label: "legacy", walletAddress: addr, sessionBlob: JSON.stringify(raw.serialized), sessionKey: raw.sessionKey }];
        }
      }
    }
    return [];
  } catch {
    return [];
  }
}

export async function resolveActors(
  preference = process.env.AGENT_EXECUTOR_ACTOR ?? "rawkey",
  chainId = targetChainId(),
): Promise<VaultActor[]> {
  if (chainId !== BSC_CHAIN_ID && chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(`the executor has no lane on chain ${chainId}`);
  }
  if (preference === "altana") {
    // an explicitly configured session is the operator's choice, so it wins over
    // the per-agent file; the file is the multi-actor lane when nothing is set
    const explicit = altanaActorFromEnv(chainId);
    if (explicit) return [explicit];
    const perAgent = await loadAltanaSessions(chainId);
    if (perAgent.length > 0) {
      const actors: VaultActor[] = [];
      for (const rec of perAgent) {
        try {
          actors.push(altanaActorFromSession(rec.sessionBlob, rec.sessionKey, chainId));
        } catch {
          // one unreadable record does not take the other agents' lane down
        }
      }
      if (actors.length > 0) return actors;
    }
    throw new Error("AGENT_EXECUTOR_ACTOR=altana but no sessions configured (run scripts/setup-altana-per-agent.mjs or set AGENT_ALTANA_SESSION)");
  }
  if (preference === "rawkey") {
    const actor = rawKeyActor(chainId);
    if (!actor) throw new Error("AGENT_EXECUTOR_ACTOR=rawkey but AGENT_EXECUTOR_KEY is not set");
    return [actor];
  }
  throw new Error(`AGENT_EXECUTOR_ACTOR must be rawkey or altana, not "${preference}"`);
}

export async function resolveActor(
  preference = process.env.AGENT_EXECUTOR_ACTOR ?? "rawkey",
  chainId = targetChainId(),
): Promise<VaultActor> {
  const actors = await resolveActors(preference, chainId);
  if (actors.length === 0) throw new Error("no executor actors configured");
  return actors[0];
}

export async function configuredAgentWallets(chainId = targetChainId()): Promise<string[]> {
  const preference = process.env.AGENT_EXECUTOR_ACTOR ?? "rawkey";
  if (preference === "altana") {
    // the same precedence the runner uses, so the page pairs against the wallet
    // the sweep will actually trade from
    const explicit = process.env.AGENT_ALTANA_SESSION;
    if (explicit) {
      try {
        const s = JSON.parse(explicit);
        const addr = s?.walletAddress ?? s?.wallet?.address;
        return typeof addr === "string" ? [addr] : [];
      } catch {
        return [];
      }
    }
    const perAgent = await loadAltanaSessions(chainId);
    if (perAgent.length > 0) return perAgent.map((r) => r.walletAddress);
    return [];
  }
  if (preference === "rawkey") {
    const key = process.env.AGENT_EXECUTOR_KEY as `0x${string}` | undefined;
    if (!key) return [];
    try {
      return [privateKeyToAccount(key).address];
    } catch { return []; }
  }
  return [];
}
