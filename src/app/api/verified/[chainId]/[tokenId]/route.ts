import { NextResponse } from "next/server";
import { loadDelisted } from "@/lib/delist-store";
import { firstPartyAgentsFor } from "@/lib/first-party-copy";
import { registryAddress } from "@/lib/registry-write";
import { getAgentByToken } from "@/lib/scanner";
import { isTeamWallet } from "@/lib/team-wallets";
import { decideMark, markMessage, signMark } from "@/lib/verified-mark";
import { loadVerifications } from "@/lib/verifications";

export const dynamic = "force-dynamic";

const KEY = /^0x[0-9a-fA-F]{64}$/;

// GET /api/verified/56/404603
// whether the agent carries "Verified by Agent Souk", and if so the signed mark,
// in a form any other site can check against the published attestor address
export async function GET(_req: Request, { params }: { params: Promise<{ chainId: string; tokenId: string }> }) {
  const { chainId: chainRaw, tokenId } = await params;
  const chainId = Number(chainRaw);
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !/^\d{1,78}$/.test(tokenId)) {
    return NextResponse.json({ success: false, error: "chainId and tokenId must be numbers" }, { status: 400 });
  }

  let registry;
  try {
    registry = registryAddress(chainId);
  } catch {
    return NextResponse.json({ success: false, error: `no registry on chain ${chainId}` }, { status: 404 });
  }

  const [verifications, delisted, agent] = await Promise.all([
    loadVerifications(chainId),
    loadDelisted(),
    getAgentByToken(chainId, tokenId).catch(() => null),
  ]);
  const endpoint = agent ? `${agent.a2a_endpoint ?? ""} ${agent.mcp_server ?? ""}` : "";
  const decision = decideMark({
    status: verifications.get(tokenId)?.status ?? null,
    delisted: delisted.has(tokenId),
    // ours if it is on the house list, or owned by a wallet the team operates;
    // agents built in their own repos, such as Flux LP, are only the second
    house: firstPartyAgentsFor(chainId).some((a) => a.tokenId === tokenId) || isTeamWallet(agent?.owner_address),
    hosted: endpoint.includes("/api/built/"),
  });

  const headers = { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" };
  if (!decision.verified) {
    return NextResponse.json({ success: true, chainId, tokenId, verified: false, reason: decision.reason }, { headers });
  }

  const key = process.env.AGENT_SOUK_ATTESTOR_KEY;
  if (!key || !KEY.test(key)) {
    // qualifying is a fact even without a key; the signature is what is missing, and the reply says so
    return NextResponse.json(
      { success: true, chainId, tokenId, verified: true, basis: decision.basis, reason: decision.reason, signed: false, unsigned_reason: "no attestor key is configured" },
      { headers },
    );
  }

  const message = markMessage(registry, tokenId, decision.basis, Math.floor(Date.now() / 1000));
  const { signer, signature } = await signMark(key as `0x${string}`, chainId, message);
  return NextResponse.json(
    {
      success: true,
      chainId,
      tokenId,
      verified: true,
      basis: decision.basis,
      reason: decision.reason,
      signed: true,
      mark: {
        domain: { name: "Agent Souk", version: "1", chainId },
        primaryType: "VerifiedAgent",
        message: { ...message, tokenId: message.tokenId.toString(), issuedAt: Number(message.issuedAt), expiresAt: Number(message.expiresAt) },
        signer,
        signature,
      },
    },
    { headers },
  );
}
