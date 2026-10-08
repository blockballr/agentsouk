import "server-only";

import { createWalletClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { BNB_TESTNET, createClient, signerFromPrivateKey, type Call } from "@altananetwork/sdk";
import type { HireView } from "./vault";

// the custody fork. Who may initiate is the other half of the split, and the
// executor carries it as a deployment choice rather than a code branch, so the
// same run works under a raw key today and swaps to the session key at cutover
// without touching the trade policy.
//
//  AGENT_EXECUTOR_ACTOR=rawkey  the smoke's shape: the trade goes out signed by
//                               one funded key read from the environment
//  AGENT_EXECUTOR_ACTOR=altana  the junction: nothing server-side holds a key
//                               to the hire, a granted session initiates the
//                               trade through the account, capped per period

export interface VaultActor {
  readonly kind: "rawkey" | "altana";
  address(): Promise<string>;
  trade(call: Call): Promise<string>;
}

function rawKeyActor(): VaultActor | null {
  const key = process.env.AGENT_EXECUTOR_KEY as `0x${string}` | undefined;
  if (!key) return null;
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: bscTestnet, transport: http() });
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

function altanaActor(): VaultActor | null {
  const sessionBlob = process.env.AGENT_ALTANA_SESSION;
  const sessionKey = process.env.AGENT_ALTANA_SESSION_KEY as `0x${string}` | undefined;
  if (!sessionBlob || !sessionKey) return null;
  const client = createClient({ chains: [BNB_TESTNET] });
  let session: unknown;
  try {
    session = JSON.parse(sessionBlob);
  } catch {
    throw new Error("AGENT_ALTANA_SESSION is set but does not parse as a granted session");
  }
  return {
    kind: "altana",
    async address() {
      // the SDK's granted session carries the wallet as walletAddress on the
      // top level; the hashed-down shape some older blobs use must keep working
      const granted = session as { walletAddress?: string; wallet?: { address?: string } };
      const walletAddress = granted.walletAddress ?? granted.wallet?.address;
      if (!walletAddress) throw new Error("the granted session does not carry the wallet address");
      return walletAddress;
    },
    async trade(call: Call) {
      const result = await client.execute({ session, calls: [call], chainId: 97 } as unknown as Parameters<typeof client.execute>[0]);
      const hash = (result as { receipts?: { hash?: string }[] }).receipts?.[0]?.hash;
      if (!hash) throw new Error("the relay returned no receipt hash for the trade");
      return hash;
    },
  };
}

// the fork itself: "altana" is chosen first only when configured, so a tree
// that loses its session config falls to the raw half loudly rather than
// pretending the junction still runs. resolve() throws rather than guessing.
export function resolveActor(preference = process.env.AGENT_EXECUTOR_ACTOR ?? "rawkey"): VaultActor {
  if (preference === "altana") {
    const actor = altanaActor();
    if (!actor) throw new Error("AGENT_EXECUTOR_ACTOR=altana but AGENT_ALTANA_SESSION and AGENT_ALTANA_SESSION_KEY are not both set");
    return actor;
  }
  if (preference === "rawkey") {
    const actor = rawKeyActor();
    if (!actor) throw new Error("AGENT_EXECUTOR_ACTOR=rawkey but AGENT_EXECUTOR_KEY is not set");
    return actor;
  }
  throw new Error(`AGENT_EXECUTOR_ACTOR must be rawkey or altana, not "${preference}"`);
}
