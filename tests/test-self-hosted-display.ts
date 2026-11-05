// display reading accepts on-chain documents; rebuild reading keeps its refusal
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { draftFromSelfHostedFile, draftFromSelfHostedFileForDisplay } from "@/lib/self-hosted-doc";

const document = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "Flux LP",
  description: "Liquidity agent for tokenized stock pools on BNB Chain.",
  services: [{ name: "A2A", endpoint: "https://fluxlp.agentsouk.xyz/a2a", version: "0.1.0" }],
  x402Support: false,
  active: true,
  registrations: [{ agentId: "406220", agentRegistry: "eip155:56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432" }],
};

const base = { name: "", description: "", category: "rebalancing" as const };

describe("self hosted document readers", () => {
  it("the rebuild reader refuses a document that already carries registrations", () => {
    const checked = draftFromSelfHostedFile(document, base);
    expect(checked.ok).toBe(false);
  });

  it("the display reader takes the same document", () => {
    const checked = draftFromSelfHostedFileForDisplay(document, base);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.draft.name).toBe("Flux LP");
    expect(checked.draft.endpoint).toBe("https://fluxlp.agentsouk.xyz/a2a");
    expect(checked.draft.description).toContain("tokenized stock pools");
  });

  it("both readers still refuse a malformed document", () => {
    const broken = { ...document, services: [] };
    expect(draftFromSelfHostedFileForDisplay(broken, base).ok).toBe(false);
    expect(draftFromSelfHostedFile(broken, base).ok).toBe(false);
  });
});
