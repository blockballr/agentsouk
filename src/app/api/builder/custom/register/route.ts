import { NextRequest, NextResponse } from "next/server";
import { getCustomAgent, validateCustomManifest, saveCustomAgent, updateCustomAgent } from "@/lib/builder/custom";
import { verifyWalletAuth } from "@/lib/builder/auth";
import { pickPublicOrigin } from "@/lib/house-agent";
import { registryAddress, encodeRegister } from "@/lib/registry-write";
import { targetChainId } from "@/lib/types";
import { emitNotification } from "@/lib/notifications";
import { enqueueSweep } from "@/lib/verifications-store";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// POST /api/builder/custom/register  { owner, id?, agentId?, manifest? }
// Prepares (never sends) an ERC-8004 registration for the builder's wallet.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { owner?: unknown; id?: unknown; agentId?: unknown; manifest?: unknown; image?: unknown; buildId?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, error: "request body must be a JSON object" }, 400);
  }
  if (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, ok: false, error: "owner must be a wallet address" }, 400);
  }
  const regSubject = (typeof body.id === "string" ? body.id : (typeof body.agentId === "string" ? body.agentId : "")) as string;
  const regAuth = await verifyWalletAuth(req, body.owner, "register", regSubject);
  if (!regAuth.ok) return json({ success: false, ok: false, error: regAuth.error }, 401);
  const owner = body.owner.toLowerCase();
  const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : (typeof body.agentId === "string" && body.agentId.trim() ? body.agentId.trim() : null);

  let agent = id ? await getCustomAgent(id) : null;
  let manifest = null;
  if (agent) {
    manifest = agent.manifest;
  } else if (body.manifest !== undefined) {
    const check = validateCustomManifest(body.manifest);
    if (!check.ok) return json({ success: false, ok: false, valid: false, errors: check.errors, error: check.errors[0] }, 422);
    manifest = check.manifest;
    // create a custom agent record so we have an ID for the metadata URL
    agent = await saveCustomAgent(owner, manifest, typeof body.buildId === "string" ? body.buildId : null);
    if (typeof body.image === "string" && body.image.trim()) {
      await updateCustomAgent(agent.id, { image: body.image.trim() });
      agent = await getCustomAgent(agent.id) ?? agent;
    }
  } else {
    return json({ success: false, ok: false, error: "id or manifest is required" }, 400);
  }
  if (!agent) return json({ success: false, ok: false, error: "agent not found" }, 404);

  const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
  const image = typeof body.image === "string" && body.image.trim() ? body.image.trim() : null;
  const metadataUrl = `${origin.replace(/\/+$/, "")}/api/builder/custom/agent/${agent.id}/metadata`;
  const chainId = targetChainId();
  let regAddress: string | null = null;
  let calldata: string | null = null;
  if (metadataUrl) {
    try {
      regAddress = registryAddress(chainId);
      calldata = encodeRegister(chainId, metadataUrl);
    } catch { /* chain not configured */ }
  }
  const registration = {
    owner,
    type: "erc8004",
    prepared: true,
    sendsTransaction: false,
    manifest,
    image,
    endpoint: `${origin.replace(/\/+$/, "")}/api/built/${agent.id}/a2a`,
    agentUri: metadataUrl,
    chainId,
    registryAddress: regAddress,
    registerCalldata: calldata,
    note: "Send register(agentUri) to registryAddress from your wallet. Other marketplaces will fetch live metadata from agentUri.",
  };
  // enqueue for verification so the marketplace checks the endpoint and activity
  void enqueueSweep(agent.id, manifest.name, manifest.category ?? "general").catch(() => {});

  // notify the owner that their agent is registered
  void emitNotification({
    wallet: owner,
    kind: "custom_registered",
    eventKey: agent.id,
    title: "Agent registered",
    body: `${manifest.name} is registered on chain. The marketplace will verify the endpoint and activity proof before listing.`,
    href: `/profile#signals`,
  }).catch(() => {});

  return json({ success: true, ok: true, prepared: true, id: agent.id, registration }, 200);
}