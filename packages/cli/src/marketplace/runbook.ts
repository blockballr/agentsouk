import { apiRequest, query } from "../core/http";
import type { CliConfig } from "../core/config";

// The live plan comes from the API, so the CLI and an MCP client read the same
// steps and the same live state.

export interface RunbookResult {
  intent: string;
  version: string;
  chainId: number;
  agent?: {
    tokenId?: string;
    name?: string;
    rails?: string[];
    endpoint?: string | null;
    executor?: string | null;
    policy?: string | null;
  };
  steps: { step: number; do: string; tool?: string; command?: string; note?: string }[];
  refusals: string[];
  docs: string;
  markdown: string;
}

export async function getRunbook(
  config: CliConfig,
  intent: string,
  tokenId?: string,
  chainId?: number,
): Promise<RunbookResult> {
  return apiRequest<RunbookResult>(
    config.apiUrl,
    `/api/runbook${query({ intent, tokenId, chainId })}`,
    { timeoutMs: 60_000 },
  );
}
