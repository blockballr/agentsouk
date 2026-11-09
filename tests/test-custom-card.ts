// A custom agent is deployed on its owner's host and the owner holds the key, so
// its card has to name the owner's endpoint and wallet, never ours.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  customCardMetadata,
  validateCustomManifest,
  type CustomAgent,
} from "../src/lib/builder/custom";

const OWNER = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const WALLET = "0x1111111111111111111111111111111111111111";
const HELD = "0x2222222222222222222222222222222222222222";

const manifestInput = {
  name: "Range Keeper",
  category: "rebalancing",
  description: "Keeps a two-asset position inside a drift band.",
  runtime: "node20",
  entrypoint: "server.mjs",
  endpoint: "/a2a",
  wallet: "agent",
  payment: "job",
  deliverable: "position",
  release: "on chain",
  actions: [],
  env: ["RPC_URL"],
  healthcheck: "/health",
};

function agent(overrides: Partial<CustomAgent> = {}, wallet: string | undefined = undefined): CustomAgent {
  return {
    id: "0123456789abcdef",
    owner: OWNER,
    manifest: { ...manifestInput, wallet: "agent", ...(wallet ? { agentWallet: wallet } : {}) } as CustomAgent["manifest"],
    buildId: null,
    image: null,
    walletAddress: null,
    onChainTokenId: null,
    deployment: null,
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("the agent wallet in a custom manifest", () => {
  it("accepts an address, with or without one", () => {
    expect(validateCustomManifest(manifestInput).ok).toBe(true);
    const withWallet = validateCustomManifest({ ...manifestInput, agentWallet: WALLET });
    expect(withWallet.ok).toBe(true);
    if (withWallet.ok) expect(withWallet.manifest.agentWallet).toBe(WALLET);
  });

  it("refuses a key pasted where an address belongs", () => {
    const check = validateCustomManifest({ ...manifestInput, agentWallet: `0x${"11".repeat(32)}` });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors.join(" ")).toContain("never a private key");
  });

  it("refuses anything that is not an address", () => {
    for (const agentWallet of ["agent-wallet", "0x1234", 42]) {
      expect(validateCustomManifest({ ...manifestInput, agentWallet }).ok, String(agentWallet)).toBe(false);
    }
  });
});

describe("the card a custom agent's agentURI serves", () => {
  it("points at the owner's attached endpoint", () => {
    const card = customCardMetadata(
      agent({ deployment: { ok: true, url: "https://range.example/a2a" } }),
      { origin: "https://api.agentsouk.xyz" },
    );
    expect(card.endpoint).toBe("https://range.example/a2a");
    expect(JSON.stringify(card)).not.toContain("api/built");
  });

  it("advertises no endpoint before one is attached", () => {
    const card = customCardMetadata(agent(), { origin: "https://api.agentsouk.xyz" });
    expect(card.endpoint).toBeUndefined();
  });

  it("names the manifest's wallet, else the owner", () => {
    expect(customCardMetadata(agent({}, WALLET), { origin: "https://api.agentsouk.xyz" }).agentWallet).toBe(WALLET);
    expect(customCardMetadata(agent(), { origin: "https://api.agentsouk.xyz" }).agentWallet).toBe(OWNER);
    const none = agent({ manifest: { ...manifestInput, wallet: "none", payment: "x402" } as CustomAgent["manifest"] });
    expect(customCardMetadata(none, { origin: "https://api.agentsouk.xyz" }).agentWallet).toBeUndefined();
  });

  it("keeps the image it was given and falls back otherwise", () => {
    const withImage = customCardMetadata(agent({ image: "https://img.example/agent.png" }), {
      origin: "https://api.agentsouk.xyz",
      image: "https://img.example/agent.png",
    });
    expect(withImage.image).toBe("https://img.example/agent.png");
    const fallback = customCardMetadata(agent(), { origin: "https://api.agentsouk.xyz" });
    expect(String(fallback.image)).toContain("dicebear");
  });

  it("never carries a key the marketplace holds", () => {
    const card = customCardMetadata(agent({ walletAddress: HELD, deployment: { ok: true, url: "https://range.example/a2a" } }), {
      origin: "https://api.agentsouk.xyz",
    });
    expect(JSON.stringify(card)).not.toContain(HELD);
  });
});
