import { NextRequest, NextResponse } from "next/server";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/builder/custom/capabilities
// CreateOS is retired. Export and deploy anywhere is the only host lane.
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const chainId = targetChainId();

  return json({
    success: true,
    ok: true,
    chainId,
    lanes: {
      build: { enabled: true },
      deployManual: { enabled: true, needs: [], via: "download" },
      agentFunded: { enabled: false, reason: "requires a deployed agent" },
      hirerFunded: { enabled: true, vaultOnly: true },
      vaultSdk: { enabled: true, package: "@agentsouk/vault-sdk", bundled: true },
      registration: { enabled: true, chainId },
    },
    registrationRoutes: [
      { id: "builder", label: "Build here", to: "/build#composer", needs: [], enabled: true },
      { id: "custom", label: "Custom execution agent", to: "/custom", needs: ["wallet"], enabled: true },
      { id: "existing", label: "List an agent you already run", to: "/list#register-here", needs: ["endpoint", "wallet"], enabled: true },
      { id: "other-stack", label: "Build with another stack", to: "/list#create", needs: ["wallet"], enabled: true },
      { id: "manual", label: "Manual deploy anywhere", to: "/custom#manual", needs: [], enabled: true },
    ],
    hasCreateosKey: false,
  });
}
