import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, isAddress } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { BSC_CHAIN_ID, targetChainId } from "@/lib/types";
import { registryAddress } from "@/lib/registry-write";
import { rpcTransport } from "@/lib/rpc";
import { LISTABLE_CATEGORIES, ENDPOINT_KINDS, type RegistrationDraft, type ListableCategory, type EndpointKind } from "@agora/core";
import { admitConfirmedAgent, getAgentByToken, summaryFromRegistration } from "@/lib/scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A listing whose confirm call never landed has a token on chain but no shelf
// summary, so it carries no category and never reaches browse. This rebuilds
// that summary from the live record and admits it, for tokens the house wallet
// owns. Guarded like the other ops writes: the cron secret, then an on-chain
// owner check.

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { tokenId?: unknown; category?: unknown } = { tokenId: null, category: null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body must be json" }, { status: 400 });
  }
  const tokenId = Number(body?.tokenId);
  if (!Number.isInteger(tokenId) || tokenId <= 0) {
    return NextResponse.json({ error: "tokenId must be a positive integer" }, { status: 400 });
  }
  const category = typeof body?.category === "string" ? body.category : "";
  if (!(LISTABLE_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: "category must be a shelf category" }, { status: 400 });
  }

  const chainId = targetChainId();
  if (chainId !== BSC_CHAIN_ID) {
    return NextResponse.json({ error: "ops writes settle on BSC only" }, { status: 400 });
  }

  const sellerKey = (process.env.SELLER8183_PRIVATE_KEY_TAJIR ?? process.env.SELLER8183_PRIVATE_KEY ?? "").trim();
  const normalized = sellerKey.startsWith("0x") ? sellerKey : `0x${sellerKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    return NextResponse.json({ error: "house wallet key is not configured" }, { status: 503 });
  }
  const signer = privateKeyToAccount(normalized as `0x${string}`);

  const publicClient = createPublicClient({ chain: bsc, transport: rpcTransport(chainId) });
  const owner = (await publicClient.readContract({
    address: registryAddress(chainId),
    abi: [{ name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] }] as const,
    functionName: "ownerOf",
    args: [BigInt(tokenId)],
  }).catch(() => null)) as string | null;
  if (!owner || !isAddress(owner)) {
    return NextResponse.json({ error: "cannot read the token on chain" }, { status: 502 });
  }
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    return NextResponse.json(
      { error: "the house wallet does not own this token, so its summary is not rewritten", owner },
      { status: 403 },
    );
  }

  const detail = await getAgentByToken(chainId, String(tokenId));
  if (!detail) return NextResponse.json({ error: "the registry did not answer for this token" }, { status: 502 });

  const kinds: EndpointKind[] = [];
  if (detail.web_endpoint) kinds.push("web");
  if (detail.a2a_endpoint) kinds.push("A2A");
  if (detail.mcp_server) kinds.push("MCP");
  const endpoint = detail.a2a_endpoint ?? detail.web_endpoint ?? detail.mcp_server ?? "";
  if (!endpoint) {
    return NextResponse.json({ error: "the token publishes no endpoint to file" }, { status: 422 });
  }
  const draft: RegistrationDraft = {
    name: detail.name,
    description: detail.description ?? "",
    category: category as ListableCategory,
    endpoint,
    endpointKinds: kinds.filter((k) => (ENDPOINT_KINDS as readonly string[]).includes(k)),
    ...(detail.image_url ? { image: detail.image_url } : {}),
    x402Support: detail.x402_supported,
    ...(("agent_wallet" in detail && detail.agent_wallet) ? { agentWallet: detail.agent_wallet } : {}),
  };
  const summary = summaryFromRegistration({
    chainId,
    tokenId: String(tokenId),
    owner,
    registry: registryAddress(chainId),
    draft,
    createdAt: detail.created_at ?? new Date().toISOString(),
  });
  const admission = await admitConfirmedAgent(summary);
  return NextResponse.json({ success: admission.admitted, category, endpoint, kinds, ...admission });
}
