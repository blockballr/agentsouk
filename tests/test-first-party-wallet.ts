// The registry record can carry the owner address in agent_wallet. For our own
// listings the first-party file names the wallet the vault executor trades from,
// so that canonical value wins and the vault page can pair it.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchAgentDetail } from "../src/lib/scanner";

const REGISTRY_WALLET = "0x84fedabd1b83443ad86796c15619494878b64180";
const CANONICAL_WALLET = "0xCd90519257BF4CbF668cdBd3a8771FbF3cb1cfA0";

afterEach(() => vi.unstubAllGlobals());

describe("first-party wallet", () => {
  it("wins over the registry's agent_wallet for a known listing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              agent_id: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:391003",
              token_id: "391003",
              chain_id: 56,
              contract_address: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
              owner_address: REGISTRY_WALLET,
              name: "Souk Yield Lens",
              description: "Keeps a yield sleeve working on chain.",
              image_url: null,
              is_verified: false,
              star_count: 0,
              x402_supported: false,
              total_score: 0,
              average_score: 0,
              total_feedbacks: 0,
              health_score: null,
              supported_trust_models: [],
              a2a_endpoint: "https://api.agentsouk.xyz/api/reference/yield/a2a",
              mcp_server: null,
              is_active: true,
              created_at: "2026-10-26T05:50:00Z",
              agent_wallet: REGISTRY_WALLET,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const detail = await fetchAgentDetail(56, "391003");

    expect(detail?.agent_wallet).toBe(CANONICAL_WALLET);
  });
});
