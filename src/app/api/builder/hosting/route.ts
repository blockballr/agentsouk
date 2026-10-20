import { NextRequest, NextResponse } from "next/server";
import { getHosting, provisionHosting, provisionMarketplaceOwned, setApiKey } from "@/lib/builder/hosting";
import { createos } from "@/lib/builder/createos";

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

// POST /api/builder/hosting  { owner, createosEmail?, createosApiKey?, marketplaceOwned? }
// records a Free-tier principal for the wallet. When marketplaceOwned is true
// (or no apiKey/email is given), the marketplace provisions a principal under a
// marketplace-controlled email (the fallback when CreateOS signup automation is
// brittle). The buyer never visits NodeOps.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { owner?: unknown; createosEmail?: unknown; createosApiKey?: unknown; marketplaceOwned?: unknown } | null;
  if (typeof body?.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, error: "owner must be a wallet address" }, 400);
  }
  const email = typeof body.createosEmail === "string" ? body.createosEmail.trim() : null;
  const apiKey = typeof body.createosApiKey === "string" ? body.createosApiKey.trim() : null;
  const marketplaceOwned = body?.marketplaceOwned === true || (!apiKey && !email);
  try {
    let row;
    if (marketplaceOwned) {
      row = await provisionMarketplaceOwned(body.owner);
    } else {
      row = await provisionHosting(body.owner, email || null, apiKey || null);
      if (apiKey) {
        const check = await createos.getCurrentUser(apiKey);
        if (!check.ok) return json({ success: false, error: `CreateOS rejected the key: ${check.error}` }, 401);
        await setApiKey(body.owner, apiKey);
        row = (await getHosting(body.owner)) ?? row;
      }
    }
    return json({ success: true, hosting: row });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "provisioning failed" }, 503);
  }
}
