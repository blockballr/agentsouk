import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { isPlaceholderAgentName } from "@/lib/agent-name";
import { listPaymentsByClient, receiptsMode } from "@/lib/receipts-store";
import { queryAgents } from "@/lib/scanner";
import { CATEGORY_KEYS, type CategoryKey } from "@agora/core";
import { isTeamWallet, isVerifierPayment } from "@/lib/team-wallets";
import { REQUIRED_HIRES, questAwards } from "@/lib/quest-points";
import { issuePassport } from "@/lib/passport-store";
import { serialLabel } from "@/lib/passport-serial";
import { rpcTransport } from "@/lib/rpc";
import { vaultFor } from "@/lib/vault";
import { readHire } from "@/lib/vault-executor";
import { firstPartyBadges } from "@/lib/first-party-copy";
import { BSC_TESTNET_CHAIN_ID, targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HIRES_OF_ABI = [
  {
    name: "hiresOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "buyer", type: "address" }],
    outputs: [{ type: "uint256[]" }],
  },
] as const;

type QuestHire = {
  paymentId: string;
  agent: string;
  tokenId: string;
  agentName: string;
  category: string | null;
  txHash: string | null;
  mode: string;
  createdAt: string | null;
};

// One wallet's passport: the agents it has hired here, what it has listed, and whether
// that finishes it. Two different agents hired and one listed is a finished passport.
// A hire is counted only when it is the wallet's own, settled, non-excluded activity, so
// wash and team activity can never complete a wallet.

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ success: false, error: "wallet must be an address" }, { status: 400 });
  }
  const w = wallet.toLowerCase();
  try {

  // a stamp once earned stays: an agent that has since left the shelf still counts, both
  // as a hire and as a listing, so the whole catalogue is read and not only what is on show
  const [payments, catalogue] = await Promise.all([
    listPaymentsByClient(wallet),
    queryAgents({ limit: 5000, includeDelisted: true, includeHouse: true }),
  ]);
  const byToken = new Map(catalogue.items.map((a) => [`${a.chain_id}:${a.token_id}`, a]));
  const isTeam = isTeamWallet(w);

  const categories: Record<string, boolean> = {};
  for (const key of CATEGORY_KEYS) categories[key] = false;

  const hires: QuestHire[] = [];
  for (const p of payments) {
    // a revoked hire still counts: the payment settled, and revoking is part of the quest
    // the team's own activity and the verifier sweep are never a wallet's quest progress
    if (isTeam) continue;
    if (isVerifierPayment(p.paymentId)) continue;
    // sandbox moves no funds, so it is not a settlement
    if (p.mode !== "prod" && p.mode !== "b402") continue;
    const key = `${p.agent.chainId}:${p.agent.tokenId}`;
    const agent = byToken.get(key);
    // a wallet hiring an agent it owns, or one that pays it, is a self hire, excluded
    if (agent?.owner_address?.toLowerCase() === w) continue;
    if ((p.payTo ?? "").toLowerCase() === w) continue;
    const category = (agent?.category as string | undefined) ?? null;
    hires.push({
      paymentId: p.paymentId,
      // chain and token together name one agent, which is what a hire is counted by
      agent: key,
      tokenId: p.agent.tokenId,
      agentName:
        isPlaceholderAgentName(p.agent.name) && agent?.name
          ? agent.name
          : p.agent.name,
      category,
      txHash: p.txHash ?? null,
      mode: p.mode,
      createdAt: p.createdAt,
    });
    if (category && CATEGORY_KEYS.includes(category as CategoryKey)) categories[category] = true;
  }

  // a vault hire never touches the x402 or ERC-8183 payment tables: the vault
  // keeps its own buyer list, so the quest reads it from the contract and maps
  // the agent wallet back to its listing. a closed hire still counts.
  const vaultChainId = targetChainId();
  const vault = vaultFor(vaultChainId);
  if (!isTeam && vault) {
    try {
      const client = createPublicClient({
        chain: vaultChainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc,
        transport: rpcTransport(vaultChainId),
      });
      const byWallet = new Map(firstPartyBadges(vaultChainId).map((b) => [b.wallet.toLowerCase(), b]));
      const ids = (await client.readContract({
        address: vault as `0x${string}`,
        abi: HIRES_OF_ABI,
        functionName: "hiresOf",
        args: [wallet as `0x${string}`],
      })) as readonly bigint[];
      // read in parallel so a wallet with a long history does not serialise the
      // round trip, and let one failed read cost that hire only
      const views = await Promise.allSettled(ids.map((id) => readHire(client, vaultChainId, id)));
      for (let i = 0; i < ids.length; i += 1) {
        const view = views[i];
        if (view.status !== "fulfilled") continue;
        const hire = view.value;
        const id = ids[i];
        // a wallet cannot hire its own agent wallet
        if (hire.agent.toLowerCase() === w) continue;
        const badge = byWallet.get(hire.agent.toLowerCase());
        if (!badge) continue;
        const category = badge.category;
        hires.push({
          paymentId: `vault:${vaultChainId}:${id}`,
          agent: `${vaultChainId}:${badge.tokenId}`,
          tokenId: badge.tokenId,
          agentName: badge.name ?? "vault agent",
          category,
          txHash: null,
          mode: "prod",
          createdAt: null,
        });
        if (category && CATEGORY_KEYS.includes(category as CategoryKey)) categories[category] = true;
      }
    } catch {
      // a chain read that fails leaves the payment hires intact; it never turns
      // a real vault hire into a zero without saying so
    }
  }

  const listings = catalogue.items
    .filter((a) => a.owner_address?.toLowerCase() === w)
    .map((a) => ({
      tokenId: a.token_id,
      name: a.name,
      category: a.category ?? "general",
    }));

  const hiredAllFour = CATEGORY_KEYS.every((k) => categories[k]);
  const listedOne = listings.length > 0;
  const { points, awards, agentsHired, finished: completed } = questAwards(hires, listedOne);
  // the first read of a complete passport issues its number, kept with what it rested on
  const issued = completed
    ? await issuePassport(w, {
        hires: hires.map((h) => ({ paymentId: h.paymentId, tokenId: h.tokenId, category: h.category, txHash: h.txHash, createdAt: h.createdAt })),
        listings: listings.map((l) => l.tokenId),
      })
    : null;

  return NextResponse.json({
    success: true,
    wallet,
    categories,
    hiredAllFour,
    agentsHired,
    requiredHires: REQUIRED_HIRES,
    // our own wallets never earn a stamp, so a page must not read their empty list as "has not hired"
    team: isTeam,
    hires,
    listings,
    listedOne,
    completed,
    points,
    awards,
    passport: issued ? { serial: serialLabel(issued.number, issued.issuedAt), number: issued.number, issuedAt: issued.issuedAt } : null,
    // surfaced so a reader can tell a genuinely empty answer from an incomplete one
    source: receiptsMode(),
  });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
