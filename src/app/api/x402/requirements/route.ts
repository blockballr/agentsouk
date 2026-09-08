import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import { fetchAgentDetail } from "@/lib/scanner";
import { BSC_CHAIN_ID, BSC_TOKENS } from "@/lib/types";
import {
  PaymentRequirements,
  PreviewResult,
  ResourceInfo,
  randomNonce,
} from "@/lib/x402";
import { parseUnits } from "@/lib/format";

export const dynamic = "force-dynamic";

export const DEFAULT_HIRE_PRICE_USD = 2;

// the marketplace acts as the x402 merchant and the agent's receiving wallet is
// the payTo, which is how BNB Agent Studio routes payments via Binance x402
// in production this data comes from the agent's own x402 merchant endpoint
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    chainId?: number;
    tokenId?: string;
    amountUsd?: number;
    client?: string;
  } | null;

  if (!body?.tokenId) {
    return NextResponse.json({ success: false, error: "tokenId required" }, { status: 400 });
  }

  const chainId = body.chainId ?? BSC_CHAIN_ID;
  const detail = await fetchAgentDetail(chainId, body.tokenId);
  if (!detail) {
    return NextResponse.json({ success: false, error: "agent not found" }, { status: 404 });
  }

  const priceUsd = body.amountUsd ?? DEFAULT_HIRE_PRICE_USD;
  const token = BSC_TOKENS.USDC;
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
      name: "USD Coin",
      version: "2",
      assetTransferMethod: "eip3009",
      signerAddress: body.client,
      resourceUrl: resource.url,
      resourceDescription: resource.description,
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