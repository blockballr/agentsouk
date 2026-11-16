import { NextRequest, NextResponse } from "next/server";
import { BNB, BNB_TESTNET, createClient, deserializeSession, signerFromPrivateKey } from "@altananetwork/sdk";
import { createPublicClient, formatEther, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { rpcTransport } from "@/lib/rpc";
import { markAltanaSessionRevoked } from "@/lib/altana-store";
import { verifyWalletProof } from "@/lib/mfa-request";
import { CONSOLE_ACTIONS, consoleMessage, plainRelayError, type ConsoleAction } from "@/lib/session-console";
import { loadSessionsWithAdmin, renewSessions } from "@/lib/session-renewal";
import { readSessionScope } from "@/lib/session-scope";
import { isTeamWallet } from "@/lib/team-wallets";
import { BSC_TESTNET_CHAIN_ID } from "@/lib/types";
import { vaultFor } from "@/lib/vault";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/vault/sessions/console {action, chainId, tokenId?, wallet, signature, at}
// the session console: a team wallet signs each action, and the server acts with
// the admin key it already stores. no key ever leaves this route

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

async function balances(chainId: number, wallets: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const client = createPublicClient({ chain: chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc, transport: rpcTransport(chainId) });
  await Promise.all(
    [...new Set(wallets)].map(async (w) => {
      const wei = await client.getBalance({ address: w as Address }).catch(() => null);
      if (wei !== null) out.set(w.toLowerCase(), formatEther(wei));
    }),
  );
  return out;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
    chainId?: unknown;
    tokenId?: unknown;
    wallet?: unknown;
    signature?: unknown;
    at?: unknown;
  } | null;
  const action = body?.action as ConsoleAction;
  const chainId = Number(body?.chainId ?? 56);
  const tokenId = typeof body?.tokenId === "string" && /^\d+$/.test(body.tokenId) ? body.tokenId : null;
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  const at = Number(body?.at);
  if (!CONSOLE_ACTIONS.includes(action)) return json({ success: false, error: "unknown action" }, 400);
  if (action !== "list" && !tokenId) return json({ success: false, error: "name the agent" }, 400);
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet) || !Number.isFinite(at)) return json({ success: false, error: "sign in first" }, 400);
  if (!isTeamWallet(wallet)) return json({ success: false, error: "only a team wallet can use the session console" }, 403);
  const message = consoleMessage(action, chainId, tokenId, wallet, at);
  if (!(await verifyWalletProof(wallet, message, String(body?.signature ?? "")))) {
    return json({ success: false, error: "the signature did not match, or it is older than five minutes" }, 403);
  }

  const vault = vaultFor(chainId);
  const rows = await loadSessionsWithAdmin(chainId);

  if (action === "list") {
    const bnb = await balances(chainId, rows.map((r) => r.walletAddress));
    return json({
      success: true,
      chainId,
      vault,
      sessions: rows.map((row) => ({
        ...readSessionScope(row.tokenId, row.walletAddress, row.sessionBlob, row.expiry ?? null, vault),
        label: row.label,
        revokedAt: row.revokedAt ?? null,
        canAct: Boolean(row.adminKey),
        bnb: bnb.get(row.walletAddress.toLowerCase()) ?? null,
        grantedAt: row.createdAt,
      })),
    });
  }

  const row = rows.find((r) => r.tokenId === tokenId);
  if (!row) return json({ success: false, error: `no session for agent ${tokenId}` }, 404);
  if (!row.adminKey) return json({ success: false, error: "no admin key is stored for this wallet, so the console cannot act for it" }, 409);
  console.info(`[session-console] ${action} agent ${tokenId} on ${chainId} by ${wallet.toLowerCase()}`);

  if (action === "renew" || action === "regrant") {
    if (action === "renew" && row.revokedAt) return json({ success: false, error: "this session is revoked; grant it again instead" }, 409);
    const run = await renewSessions({ chainId, force: true, tokenIds: [row.tokenId], regrantRevoked: action === "regrant" });
    const outcome = run.outcomes[0];
    if (!outcome?.renewed) return json({ success: false, error: plainRelayError(outcome?.error ?? "the grant did not land") }, 502);
    return json({ success: true, action, tokenId, expiry: outcome.expiry });
  }

  // revoke: on chain first, then the record, so a failed revoke never reads as done
  if (row.revokedAt) return json({ success: true, action, tokenId, already: true });
  try {
    const client = createClient({ chains: [chainId === BSC_TESTNET_CHAIN_ID ? BNB_TESTNET : BNB] });
    const result = await client.revokeSession({
      wallet: { address: row.walletAddress as `0x${string}` },
      signer: signerFromPrivateKey(row.adminKey as `0x${string}`),
      session: deserializeSession(JSON.parse(row.sessionBlob), signerFromPrivateKey(row.sessionKey as `0x${string}`)),
      chainId,
    });
    const marked = await markAltanaSessionRevoked(row.tokenId, chainId);
    const txHash = (result as { transactionHash?: string }).transactionHash ?? null;
    return json({ success: true, action, tokenId, txHash, recorded: marked });
  } catch (e) {
    return json({ success: false, error: `the revoke did not land: ${plainRelayError((e as Error).message)}` }, 502);
  }
}
