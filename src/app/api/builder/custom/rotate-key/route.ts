import { NextRequest, NextResponse } from "next/server";
import { getCustomAgent, updateCustomAgent } from "@/lib/builder/custom";
import { createos } from "@/lib/builder/createos";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { verifyWalletAuth } from "@/lib/builder/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { owner?: unknown; id?: unknown; agentKey?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, error: "request body must be a JSON object" }, 400);
  }
  if (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, ok: false, error: "owner must be a wallet address" }, 400);
  }
  if (typeof body.id !== "string" || !body.id.trim()) {
    return json({ success: false, ok: false, error: "id is required" }, 400);
  }

  const auth = await verifyWalletAuth(req, body.owner, "rotate-key", body.id);
  if (!auth.ok) return json({ success: false, ok: false, error: auth.error }, 401);

  const owner = body.owner.toLowerCase();
  const agent = await getCustomAgent(body.id);
  if (!agent) return json({ success: false, ok: false, error: "agent not found" }, 404);
  if (agent.owner !== owner) return json({ success: false, ok: false, error: "not your agent" }, 403);

  const projectId = agent.deployment?.projectId;
  if (!projectId) {
    return json({ success: false, ok: false, error: "no CreateOS project; manual deployments must be rotated in CreateOS dashboard" }, 400);
  }

  let newKey: string;
  if (typeof body.agentKey === "string" && body.agentKey.trim()) {
    newKey = body.agentKey.trim();
    if (!newKey.startsWith("0x")) newKey = "0x" + newKey;
    if (!/^0x[0-9a-fA-F]{64}$/.test(newKey)) {
      return json({ success: false, ok: false, error: "agentKey must be a 32-byte hex private key" }, 400);
    }
  } else {
    newKey = "0x" + randomBytes(32).toString("hex");
  }
  const newAddress = privateKeyToAccount(newKey as `0x${string}`).address;

  const apiKey = process.env.CREATEOS_API_KEY ?? null;
  if (!apiKey) {
    return json({ success: false, ok: false, error: "no CreateOS API key configured" }, 503);
  }

  const envRes = await createos.createProjectEnvironment(apiKey, {
    project_id: projectId,
    body: {
      displayName: "Production (rotated)",
      uniqueName: "production-rotated",
      description: "rotated key environment",
      settings: { runEnvs: { AGENT_PRIVATE_KEY: newKey, RPC_URL: process.env.RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com" } },
      resources: { cpu: 200, memory: 500, replicas: 1 },
    },
  });
  if (!envRes.ok) {
    return json({ success: false, ok: false, error: envRes.error ?? "failed to create environment" }, 502);
  }

  await updateCustomAgent(agent.id, { walletAddress: newAddress });

  return json({
    success: true,
    ok: true,
    id: agent.id,
    newWallet: newAddress,
  }, 200);
}
