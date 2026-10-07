import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import { fetchAgentDetail } from "@/lib/scanner";
import { settlementAsset, targetChainId } from "@/lib/types";
import {
  PaymentRequirements,
  PreviewResult,
  ResourceInfo,
  randomNonce,
} from "@/lib/x402";
import { parseUnits } from "@/lib/format";
import { JOB_SELLER_NOTE, sellsByJob } from "@agora/core";
import { fetchAgentCardSkills } from "@/lib/delivery";
import { loadDelisted } from "@/lib/delist-store";
import { isAgentOwner } from "@/lib/boost-auth";
import { escrowFunder } from "@/lib/escrow";

export const dynamic = "force-dynamic";

export const DEFAULT_HIRE_PRICE_USD = 2;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// the marketplace is the x402 merchant and the agent's receiving wallet is the payTo,
// matching how BNB Agent Studio routes payments; in production this comes from the agent's own merchant endpoint.
// With the funder deployed the payTo is the funder instead, and the agent's wallet
// travels in extra.agentPayTo for the settle step to re-bind to the registry
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    chainId?: number;
    tokenId?: string;
    amountUsd?: number;
    client?: string;
    purpose?: string;
  } | null;

  // a token id is a number in the registry. Anything else could steer the registry read to a
  // different agent than the one asked for
  const tokenId = typeof body?.tokenId === "string" || typeof body?.tokenId === "number" ? String(body.tokenId) : "";
  if (!body || !/^\d{1,78}$/.test(tokenId)) {
    return NextResponse.json({ success: false, error: "tokenId required" }, { status: 400 });
  }

  // default to the configured chain, not mainnet: this deployment declares BSC testnet, and
  // defaulting to BSC_CHAIN_ID gave a caller that omitted chain a mainnet asset and a different agent's wallet
  const chainId = body.chainId === undefined || body.chainId === null ? targetChainId() : Number(body.chainId);
  if (!Number.isSafeInteger(chainId) || chainId < 1) {
    return NextResponse.json({ success: false, error: "chainId must be a chain id" }, { status: 400 });
  }
  const detail = await fetchAgentDetail(chainId, tokenId);
  if (!detail) {
    return NextResponse.json({ success: false, error: "agent not found" }, { status: 404 });
  }
  // an agent that is off the market takes no new hires. A check of it still runs, because a
  // passing check is how it comes back. Anyone can claim to be a check here and gets nothing
  // by it: the settlement applies the same refusals to every payment that is not a probe
  if (body.purpose !== "check" && chainId === targetChainId()) {
    const offMarket = await loadDelisted().catch(() => new Set<string>());
    if (offMarket.has(String(detail.token_id))) {
      return NextResponse.json(
        { success: false, offMarket: true, error: `${detail.name} is off the market, so it is not taking new hires.` },
        { status: 409 },
      );
    }
  }
  // a wallet hiring the agent it owns, or the agent's own receiving wallet, pays itself.
  // An owner tests their agent with a check, which is free and signed, not with a hire
  if (body.purpose !== "check" && typeof body.client === "string" && body.client && isAgentOwner(body.client, detail)) {
    return NextResponse.json(
      {
        success: false,
        ownAgent: true,
        error: `${detail.name} is your own agent, so this wallet cannot hire it. Use Re-check now on your profile to test it.`,
      },
      { status: 409 },
    );
  }
  // a direct payment to a job seller settles and then delivers nothing, so it is refused here,
  // which every hire path (the site, MCP and the skill) passes through before anyone signs;
  // the live registry read carries no skills, so the card is read as the agent page reads it
  const skills =
    detail.skills ?? (detail.a2a_endpoint ? await fetchAgentCardSkills(detail.a2a_endpoint, 4000) : null);
  if (sellsByJob(skills)) {
    return NextResponse.json(
      { success: false, sellsByJob: true, error: `${detail.name}: ${JOB_SELLER_NOTE}` },
      { status: 409 },
    );
  }

  const priceUsd = body.amountUsd ?? DEFAULT_HIRE_PRICE_USD;
  // the asset is resolved per chain (97 settles in sUSD, 56 in $U), so the advertised
  // EIP-712 domain always matches what the relay will actually broadcast
  const token = settlementAsset(chainId);
  const amountRaw = parseUnits(String(priceUsd), token.decimals).toString();
  // wallets reject non-checksummed addresses in typed data, and the registry
  // stores them lowercase
  const rawPayTo = detail.agent_wallet ?? detail.owner_address;
  let payTo = rawPayTo;
  let asset: string = token.address;
  try {
    payTo = getAddress(rawPayTo);
    asset = getAddress(token.address);
  } catch {
    // keep the raw values; the settle step will reject them if truly invalid
  }
  // A funded hire is escrowed when the funder is deployed: the signed recipient
  // becomes the funder contract and the agent's real wallet rides beside it in
  // extra, which the settle step re-binds to the registry before spending. Our
  // own probe never escrows: a check pays the agent directly and is not a hire
  let agentPayTo: string | undefined;
  if (body.purpose !== "check" && escrowFunder() && ADDRESS.test(payTo)) {
    agentPayTo = payTo;
    payTo = escrowFunder() as string;
  }

  const resource: ResourceInfo = {
    url: `/agents/${chainId}/${detail.token_id}`,
    description: `Activate ${detail.name} for a paid session`,
    mimeType: "application/json",
  };

  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: `eip155:${chainId}`,
    amount: amountRaw,
    asset,
    payTo,
    maxTimeoutSeconds: 300,
    extra: {
      name: token.eip712Name,
      version: token.eip712Version,
      assetTransferMethod: "eip3009",
      signerAddress: body.client,
      resourceUrl: resource.url,
      resourceDescription: resource.description,
      // present only on an escrowed hire: who the money is ultimately for,
      // against the funder the signature above it is addressed to
      ...(agentPayTo ? { agentPayTo } : {}),
    },
  };

  const preview: PreviewResult = {
    paymentId: `req_${randomNonce().slice(0, 18)}`,
    options: [
      {
        index: 1,
        status: "READY_TO_SIGN",
        reasons: [],
        assetTransferMethod: "eip3009",
        tokenSymbol: token.symbol,
        amount: String(priceUsd),
        amountUsd: priceUsd,
        payTo,
        needApproveFirst: false,
        originalAccept: requirements,
      },
    ],
    resource,
  };

  return NextResponse.json({
    success: true,
    data: {
      paymentRequirements: requirements,
      preview,
      agent: {
        chainId,
        tokenId: detail.token_id,
        name: detail.name,
        image: detail.image_url,
        symbol: token.symbol,
      },
    },
  });
}