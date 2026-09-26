import { describe, expect, it } from "vitest";
import {
  checkRegistrationProof,
  claimsMode,
  confirmClaim,
  createClaim,
  getClaim,
  isClaimExpired,
  isTxHash,
  isWalletAddress,
  newClaimId,
  parseAgentId,
  type ListingClaim,
  type RegistrationProof,
} from "../src/lib/listing-claims";
import {
  agentRegistryRef,
  buildRegistrationFile,
  encodeRegister,
  registrationUrl,
} from "../src/lib/registry-write";

// The claim is the only thing between a draft and a published registration document, and
// third parties fetch that document; so the lifecycle is pinned here: prepared means no id, confirmed means the id and hash are on the record.
const draft = {
  name: "Venus health monitor",
  description: "Watches a wallet's Venus positions and warns before liquidation.",
  category: "health-factor" as const,
  endpoint: "https://example.test/.well-known/agent-card.json",
  endpointKind: "A2A" as const,
};

const OWNER = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";
const TX = `0x${"ab".repeat(32)}`;
const BASE = "https://api.agentsouk.xyz";

async function prepare(overrides: Partial<Parameters<typeof createClaim>[0]> = {}) {
  const claimId = newClaimId();
  return createClaim({
    claimId,
    chainId: 97,
    owner: OWNER,
    agentUri: registrationUrl(BASE, claimId),
    draft,
    ...overrides,
  });
}

const fileFor = (claim: ListingClaim) =>
  buildRegistrationFile({
    agentId: claim.agentId ?? undefined,
    chainId: claim.chainId,
    draft: claim.draft,
  });

describe("claim id", () => {
  it("is a random uuid, not a counter a stranger could walk", () => {
    const id = newClaimId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("does not repeat across claims", async () => {
    const ids = new Set([newClaimId(), newClaimId(), (await prepare()).claimId]);
    expect(ids.size).toBe(3);
  });

  it("does not resolve a guessable id", async () => {
    await prepare();
    for (const guess of ["1", "2", "claim-1", "0", ""]) {
      expect(await getClaim(guess)).toBeNull();
    }
  });
});

describe("createClaim", () => {
  it("stores the submitted draft verbatim and nothing confirmed yet", async () => {
    const claim = await prepare();
    expect(claim.status).toBe("prepared");
    expect(claim.agentId).toBeNull();
    expect(claim.txHash).toBeNull();
    expect(claim.confirmedAt).toBeNull();
    expect(claim.chainId).toBe(97);
    expect(claim.draft).toEqual(draft);
    expect(claim.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("serves the document from the claim id in the url it handed out", async () => {
    const claim = await prepare();
    const url = registrationUrl(BASE, claim.claimId);
    expect(url).toBe(`${BASE}/api/agents/register/${claim.claimId}`);
    const segment = url.slice(url.lastIndexOf("/") + 1);
    expect((await getClaim(segment))?.claimId).toBe(claim.claimId);
  });

  it("serves a pending document that is already a valid registration-v1 file", async () => {
    const file = fileFor(await prepare());
    expect(file.registrations).toEqual([]);
    expect(file.services).toEqual([
      { name: "A2A", endpoint: "https://example.test/.well-known/agent-card.json" },
    ]);
  });

  it("keeps working with no database, which is the deployment without DATABASE_URL", async () => {
    const claim = await prepare();
    expect(claimsMode()).toBe(process.env.DATABASE_URL ? "postgres" : "memory");
    expect((await getClaim(claim.claimId))?.draft.name).toBe(draft.name);
  });

  it("returns null for an unknown or blank id", async () => {
    expect(await getClaim("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await getClaim("   ")).toBeNull();
  });
});

describe("confirmClaim", () => {
  it("records the id and the hash on the same claim the url already serves", async () => {
    const claim = await prepare();
    const confirmed = await confirmClaim(claim.claimId, { agentId: "4242", txHash: TX });
    expect(confirmed?.status).toBe("confirmed");
    expect(confirmed?.agentId).toBe("4242");
    expect(confirmed?.txHash).toBe(TX);
    expect(confirmed?.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(confirmed?.agentUri).toBe(claim.agentUri);

    const served = await getClaim(claim.claimId);
    expect(served?.agentId).toBe("4242");
    expect(fileFor(served!).registrations).toEqual([
      { agentId: "4242", agentRegistry: agentRegistryRef(97) },
    ]);
  });

  it("leaves the draft and the url untouched, so the document changes in place", async () => {
    const claim = await prepare();
    const before = fileFor(claim);
    const after = fileFor((await confirmClaim(claim.claimId, { agentId: "1", txHash: TX }))!);
    expect(after.name).toBe(before.name);
    expect(after.services).toEqual(before.services);
    expect(after.registrations).not.toEqual(before.registrations);
  });

  it("serialises to the same document on every fetch, which is what an indexer caches", async () => {
    const claim = await prepare();
    await confirmClaim(claim.claimId, { agentId: "7", txHash: TX });
    const first = JSON.stringify(fileFor((await getClaim(claim.claimId))!));
    const second = JSON.stringify(fileFor((await getClaim(claim.claimId))!));
    expect(first).toBe(second);
  });

  it("refuses to confirm a claim that does not exist", async () => {
    expect(await confirmClaim("nope", { agentId: "1", txHash: TX })).toBeNull();
  });
});

describe("isClaimExpired", () => {
  const at = (over: Partial<ListingClaim>): ListingClaim => ({
    claimId: "claim",
    chainId: 97,
    owner: OWNER,
    agentUri: registrationUrl(BASE, "claim"),
    draft,
    status: "prepared",
    agentId: null,
    txHash: null,
    createdAt: new Date(0).toISOString(),
    confirmedAt: null,
    expiresAt: 1_000_000,
    ...over,
  });

  it("honours a claim at and just before the expiry instant", () => {
    // expiresAt is the instant after which a claim is dead, so the instant
    // itself still serves and only the next millisecond closes it
    expect(isClaimExpired(at({}), 999_999)).toBe(false);
    expect(isClaimExpired(at({}), 1_000_000)).toBe(false);
  });

  it("expires a prepared claim one tick later", () => {
    expect(isClaimExpired(at({}), 1_000_001)).toBe(true);
  });

  it("never expires a confirmed claim, however far past its expiry", () => {
    const confirmed = at({
      status: "confirmed",
      agentId: "7",
      txHash: TX,
      confirmedAt: new Date(0).toISOString(),
    });
    expect(isClaimExpired(confirmed, 9_999_999_999)).toBe(false);
  });

  it("defaults to the current clock", () => {
    expect(isClaimExpired(at({ expiresAt: Date.now() - 1 }))).toBe(true);
    expect(isClaimExpired(at({ expiresAt: Date.now() + 60_000 }))).toBe(false);
  });
});

describe("parseAgentId", () => {
  it("accepts the decimal string the registry document carries", () => {
    expect(parseAgentId("4242")).toBe("4242");
    expect(parseAgentId("  4242 ")).toBe("4242");
    expect(parseAgentId("0")).toBe("0");
  });

  it("accepts the 0x form a wallet may send for the same number", () => {
    expect(parseAgentId("0x1092")).toBe("4242");
    expect(parseAgentId(`0x${"0".repeat(63)}1`)).toBe("1");
  });

  it("accepts a non-negative safe integer, as a JSON body may carry one", () => {
    expect(parseAgentId(4242)).toBe("4242");
  });

  it("rejects anything that is not a uint256", () => {
    for (const bad of ["", "  ", "abc", "-1", "1.5", "1e3", "0x", null, undefined, {}, [], true]) {
      expect(parseAgentId(bad)).toBeNull();
    }
    expect(parseAgentId(1.5)).toBeNull();
    expect(parseAgentId(-1)).toBeNull();
  });
});

describe("isTxHash", () => {
  it("takes 0x plus 64 hex characters", () => {
    expect(isTxHash(TX)).toBe(true);
    expect(isTxHash(TX.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("rejects a short, long, unprefixed or non-hex value", () => {
    expect(isTxHash(TX.slice(0, 63))).toBe(false);
    expect(isTxHash(`${TX}0`)).toBe(false);
    expect(isTxHash(TX.slice(2))).toBe(false);
    expect(isTxHash(`0x${"z".repeat(64)}`)).toBe(false);
    expect(isTxHash(undefined)).toBe(false);
  });
});

describe("isWalletAddress", () => {
  it("takes 0x plus 40 hex characters and nothing longer", () => {
    expect(isWalletAddress(OWNER)).toBe(true);
    expect(isWalletAddress(OWNER.toUpperCase().replace("0X", "0x"))).toBe(true);
    expect(isWalletAddress(TX)).toBe(false);
    expect(isWalletAddress("0x1234")).toBe(false);
  });
});

// This fixture is a real chain-97 registration (token 2494, minted to 0x4bb30e3b.. by
// register(string)); the confirm route turns it into a verdict, which is what stops a caller writing any id into a published document.
const REGISTRY_97 = "0x8004a818bfb912233c491871b3d84c89a494bd9e";
const REAL_URI =
  "https://raw.githubusercontent.com/Shenhan01-sys/Fabius/master/docs/agent-card.json";
const TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = `0x${"0".repeat(64)}`;
const word = (n: string) => `0x${n.padStart(64, "0")}`;

const realProof = (): RegistrationProof => ({
  registry: REGISTRY_97,
  agentId: "2494",
  agentUri: REAL_URI,
  owner: OWNER,
  receipt: {
    status: "success",
    to: REGISTRY_97,
    logs: [
      {
        address: REGISTRY_97,
        topics: [TRANSFER, ZERO, word(OWNER.slice(2)), word("9be")],
      },
      // the registry also emits its own AgentRegistered / wallet / metadata
      // events, which carry no token id and must not be mistaken for the mint
      { address: REGISTRY_97, topics: [`0x${"11".repeat(32)}`] },
    ],
  },
  calldata: encodeRegister(97, REAL_URI),
  tokenURI: REAL_URI,
  holder: OWNER,
});

describe("checkRegistrationProof", () => {
  it("accepts a real registration as the chain recorded it", () => {
    expect(checkRegistrationProof(realProof())).toEqual({ ok: true });
  });

  it("accepts a checksummed registry address and holder, since jsonrpc returns those", () => {
    const proof = realProof();
    expect(
      checkRegistrationProof({
        ...proof,
        registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
        holder: "0x4bb30E3b3bc22082c1935fE3bE7c07448e69c862",
      }),
    ).toEqual({ ok: true });
  });

  it("accepts a claim with no recorded owner, which cannot be cross-checked", () => {
    expect(checkRegistrationProof({ ...realProof(), owner: "" })).toEqual({ ok: true });
  });

  it("refuses a reverted transaction", () => {
    const proof = realProof();
    const result = checkRegistrationProof({
      ...proof,
      receipt: { ...proof.receipt, status: "reverted" },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/reverted/);
  });

  it("refuses a transaction that called something other than the registry", () => {
    const proof = realProof();
    const result = checkRegistrationProof({
      ...proof,
      receipt: { ...proof.receipt, to: "0x0000000000000000000000000000000000000001" },
    });
    expect(result.ok === false && result.reason).toMatch(/identity registry/);
  });

  it("refuses a receipt that minted no agent", () => {
    const proof = realProof();
    const result = checkRegistrationProof({ ...proof, receipt: { ...proof.receipt, logs: [] } });
    expect(result.ok === false && result.reason).toMatch(/minted no agent/);
  });

  it("refuses an id the transaction did not mint, which is the nonsense-id case", () => {
    const result = checkRegistrationProof({ ...realProof(), agentId: "999999" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe(
      "That transaction registered agent 2494, not 999999.",
    );
  });

  it("refuses a transaction that called something other than register(string)", () => {
    const result = checkRegistrationProof({ ...realProof(), calldata: "0xdeadbeef" });
    expect(result.ok === false && result.reason).toMatch(/register\(string\)/);
  });

  it("refuses calldata that claims the selector but is not decodable", () => {
    const result = checkRegistrationProof({ ...realProof(), calldata: `0xf2c298be${"00".repeat(8)}` });
    expect(result.ok === false && result.reason).toMatch(/not a register call/);
  });

  it("refuses a transaction that signed over somebody else's document", () => {
    const result = checkRegistrationProof({
      ...realProof(),
      calldata: encodeRegister(97, "https://elsewhere.test/card.json"),
    });
    expect(result.ok === false && result.reason).toMatch(/different agentURI/);
  });

  it("refuses when the registry itself records a different uri for that id", () => {
    const result = checkRegistrationProof({
      ...realProof(),
      tokenURI: "https://elsewhere.test/card.json",
    });
    expect(result.ok === false && result.reason).toMatch(/registry records a different agentURI/);
  });

  it("refuses an id held by a wallet other than the one the claim was prepared for", () => {
    const result = checkRegistrationProof({
      ...realProof(),
      holder: "0x0000000000000000000000000000000000000009",
    });
    expect(result.ok === false && result.reason).toMatch(/different wallet/);
  });
});
