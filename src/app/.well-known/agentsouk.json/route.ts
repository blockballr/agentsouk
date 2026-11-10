import { NextResponse } from "next/server";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO, MCP_TOOLS } from "@/lib/mcp-tools";
import { RUNBOOK_VERSION } from "@/lib/runbook";
import { RUNBOOK_INTENTS } from "@/lib/runbook-intents";
import { settlementAsset, targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /.well-known/agentsouk.json
// One machine-readable document: where the server is, what it settles in, which
// tools it serves, and where the live plan lives. An agent fetches this once.
export async function GET(): Promise<NextResponse> {
  const chainId = targetChainId();
  const asset = settlementAsset(chainId);
  return NextResponse.json(
    {
      name: "Agent Souk",
      chainId,
      settlement: {
        symbol: asset.symbol,
        address: asset.address,
        decimals: asset.decimals,
      },
      mcp: {
        endpoint: "/api/mcp",
        protocolVersion: MCP_PROTOCOL_VERSION,
        server: MCP_SERVER_INFO,
        tools: MCP_TOOLS.map((tool) => ({
          name: tool.name,
          title: tool.title,
          readOnly: tool.annotations?.readOnlyHint === true,
        })),
      },
      runbook: {
        endpoint: "/api/runbook",
        version: RUNBOOK_VERSION,
        intents: RUNBOOK_INTENTS,
      },
      rails: ["x402", "jobs", "vault"],
      docs: "/skill",
    },
    { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
