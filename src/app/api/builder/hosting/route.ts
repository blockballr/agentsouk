import { NextRequest, NextResponse } from "next/server";
import { getHosting, provisionHosting, setApiKey } from "@/lib/builder/hosting";
import { createos } from "@/lib/builder/createos";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/builder/hosting?owner=0x...   reads the hosting row for a wallet
export async function GET(req: NextRequest): Promise<NextResponse> {
  const owner = req.nextUrl.searchParams.get("owner") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return json({ success: false, error: "owner must be a wallet address" }, 400);
  const row = await getHosting(owner).catch(() => null);
  return json({ success: true, hosting: row });
}

// POST /api/builder/hosting  { owner, createosEmail? }
// records a Free-tier principal for the wallet. The CreateOS signup itself is
// performed out of band by an operator until their programmatic surface exists;
// this route only links the resulting email to the wallet.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { owner?: unknown; createosEmail?: unknown; createosApiKey?: unknown } | null;
  if (typeof body?.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, error: "owner must be a wallet address" }, 400);
  }
  const email = typeof body.createosEmail === "string" ? body.createosEmail.trim() : null;
  const apiKey = typeof body.createosApiKey === "string" ? body.createosApiKey.trim() : null;
  try {
    const row = await provisionHosting(body.owner, email || null, apiKey || null);
    // if an api key was supplied, verify it against CreateOS and record the principal
    if (apiKey) {
      const check = await createos.getCurrentUser(apiKey);
      if (!check.ok) return json({ success: false, error: `CreateOS rejected the key: ${check.error}` }, 401);
      await setApiKey(body.owner, apiKey);
    }
    return json({ success: true, hosting: await getHosting(body.owner) });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "provisioning failed" }, 503);
  }
}
