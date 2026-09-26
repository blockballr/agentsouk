import { describe, expect, it } from "vitest";
import {
  REGISTRY_ADDRESSES,
  agentRegistryRef,
  buildRegistrationFile,
  encodeRegister,
  registrationUrl,
  registryAddress,
  validateDraft,
  LISTABLE_CATEGORIES,
  type RegistrationDraft,
} from "../src/lib/registry-write";

// Spec conformance for self-serve listing: if the registration document or registry reference
// drifts, an indexer or verifier fetching agentURI will reject the listing, so pin it here.
const goodDraft: RegistrationDraft = {
  name: "Venus health monitor",
  description: "Watches a wallet's Venus positions and warns before liquidation.",
  category: "health-factor",
  endpoint: "https://example.test/.well-known/agent-card.json",
  endpointKind: "A2A",
};

describe("registry addressing", () => {
  it("knows the registry on both chains the campaign uses", () => {
    // registryAddress returns the checksummed form, the table holds literals
    expect(registryAddress(56).toLowerCase()).toBe(REGISTRY_ADDRESSES[56].toLowerCase());
    expect(registryAddress(97).toLowerCase()).toBe(REGISTRY_ADDRESSES[97].toLowerCase());
  });

  it("refuses a chain with no registry rather than defaulting to mainnet", () => {
    expect(() => registryAddress(1)).toThrow(/No ERC-8004 identity registry/);
    expect(() => registryAddress(8453)).toThrow(/No ERC-8004 identity registry/);
  });

  it("builds the agentRegistry identifier the spec defines", () => {
    const ref = agentRegistryRef(97);
    expect(ref).toBe(`eip155:97:${REGISTRY_ADDRESSES[97].toLowerCase()}`);
    expect(ref.split(":")).toHaveLength(3);
  });
});

describe("encodeRegister", () => {
  it("produces the selector for register(string)", () => {
    const data = encodeRegister(97, "https://api.agentsouk.xyz/api/agents/register/abc123");
    // register(string) is keccak("register(string)")[0:4]
    expect(data.slice(0, 10)).toBe("0xf2c298be");
    expect(data).toContain("616263313233"); // abc123, hex encoded
  });
});

describe("validateDraft", () => {
  it("accepts a complete listing", () => {
    expect(validateDraft(goodDraft)).toEqual({ ok: true, errors: [] });
  });

  it("requires a name, a description, a category and an https endpoint", () => {
    const result = validateDraft({ name: " ", description: "", category: "yield", endpoint: "" });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.join(" ")).toMatch(/Name is required/);
    expect(result.errors.join(" ")).toMatch(/Description is required/);
    expect(result.errors.join(" ")).toMatch(/Endpoint is required/);
  });

  it("rejects an endpoint that is not https", () => {
    const result = validateDraft({ ...goodDraft, endpoint: "http://example.test/card.json" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/https/);
  });

  it("rejects an endpoint that is not a URL at all", () => {
    const result = validateDraft({ ...goodDraft, endpoint: "not a url" });
    expect(result.ok).toBe(false);
  });

  it("only allows the four campaign categories", () => {
    for (const category of LISTABLE_CATEGORIES) {
      expect(validateDraft({ ...goodDraft, category }).ok).toBe(true);
    }
    const result = validateDraft({ ...goodDraft, category: "general" as never });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Category must be one of/);
  });

  it("enforces length limits", () => {
    expect(validateDraft({ ...goodDraft, name: "x".repeat(81) }).ok).toBe(false);
    expect(validateDraft({ ...goodDraft, description: "x".repeat(1001) }).ok).toBe(false);
  });

  it("trims before validating so padding cannot smuggle an empty field past it", () => {
    expect(validateDraft({ ...goodDraft, name: "   Venus   " }).ok).toBe(true);
    expect(validateDraft({ ...goodDraft, name: "    " }).ok).toBe(false);
  });
});

describe("buildRegistrationFile", () => {
  it("emits a registration-v1 document with the reserved fields present", () => {
    const file = buildRegistrationFile({ agentId: 4242, chainId: 97, draft: goodDraft });
    expect(file.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(file.name).toBe("Venus health monitor");
    expect(file.active).toBe(true);
    expect(file.x402Support).toBe(true);
  });

  it("records the agent id and registry once the registration has confirmed", () => {
    const file = buildRegistrationFile({ agentId: 4242, chainId: 97, draft: goodDraft });
    expect(file.registrations).toEqual([
      { agentId: "4242", agentRegistry: `eip155:97:${REGISTRY_ADDRESSES[97].toLowerCase()}` },
    ]);
  });

  it("leaves registrations empty while pending, and still a valid document", () => {
    const file = buildRegistrationFile({ chainId: 97, draft: goodDraft });
    expect(file.registrations).toEqual([]);
    expect(file.type).toContain("registration-v1");
    expect(file.name).toBeTruthy();
  });

  it("carries the endpoint as a service so the listing says how it is invoked", () => {
    const file = buildRegistrationFile({ agentId: 1, chainId: 97, draft: goodDraft });
    expect(file.services).toEqual([
      { name: "A2A", endpoint: "https://example.test/.well-known/agent-card.json" },
    ]);
  });

  it("defaults the endpoint kind to web and omits an absent image", () => {
    const file = buildRegistrationFile({
      agentId: 1,
      chainId: 97,
      draft: { ...goodDraft, endpointKind: undefined, image: "  " },
    });
    expect(file.services[0].name).toBe("web");
    expect("image" in file).toBe(false);
  });

  it("serialises to JSON, since this document is fetched over http", () => {
    const file = buildRegistrationFile({ agentId: 7, chainId: 97, draft: goodDraft });
    const round = JSON.parse(JSON.stringify(file));
    expect(round.registrations[0].agentId).toBe("7");
  });
});

describe("registrationUrl", () => {
  it("builds a stable absolute url for the claim", () => {
    expect(registrationUrl("https://api.agentsouk.xyz", "claim-1")).toBe(
      "https://api.agentsouk.xyz/api/agents/register/claim-1",
    );
  });

  it("tolerates a trailing slash on the base", () => {
    expect(registrationUrl("https://api.agentsouk.xyz/", "claim-1")).toBe(
      "https://api.agentsouk.xyz/api/agents/register/claim-1",
    );
  });

  it("escapes a claim id", () => {
    expect(registrationUrl("https://x.test", "a/b")).toBe("https://x.test/api/agents/register/a%2Fb");
  });
});
