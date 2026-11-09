// The CLI signs a listing edit and the route verifies it, so the CLI's copy of
// the rules has to stay identical to the one the route imports.
import { describe, expect, it } from "vitest";
import {
  EDIT_LIMITS,
  canonicalEdit,
  checkListingEdit,
  editDigest,
  listingEditMessage,
} from "../src/lib/listing-edit";
import {
  EDIT_LIMITS as cliLimits,
  canonicalEdit as cliCanonicalEdit,
  checkListingEdit as cliCheckListingEdit,
  editDigest as cliEditDigest,
  isEmptyEdit as cliIsEmptyEdit,
  listingEditMessage as cliListingEditMessage,
  prepareEdit,
} from "../packages/cli/src/marketplace/listing-edit";

const edit = {
  description: "Rebalances a Venus position when the health factor falls.",
  examples: [{ task: "Show the health factor", input: '{"collateral":1000}' }],
  imageUrl: "https://agentsouk.xyz/icon.png",
};

const owner = "0x1111111111111111111111111111111111111111";
const args = [97, "1402", owner, "a".repeat(64), "2026-10-02T00:00:00.000Z"] as const;

const bodies: unknown[] = [
  edit,
  { ...edit, description: "x".repeat(EDIT_LIMITS.descriptionMin - 1) },
  { ...edit, description: "x".repeat(EDIT_LIMITS.descriptionMin) },
  { ...edit, description: "  spaced \n out  " },
  { description: null, examples: [], imageUrl: null },
  { ...edit, examples: [1, 2, 3, 4].map((n) => ({ task: `request number ${n}`, input: null })) },
  { ...edit, examples: [{ task: "short" }] },
  { ...edit, examples: [{ task: "a long enough request", input: "[]" }] },
  { ...edit, examples: [{ task: "a long enough request", input: " { \"a\" : 1 } " }] },
  { ...edit, imageUrl: "http://agentsouk.xyz/icon.png" },
  { ...edit, imageUrl: `https://agentsouk.xyz/${"x".repeat(EDIT_LIMITS.imageMax)}` },
  { ...edit, description: 42 },
  [],
  "an edit",
];

describe("the CLI and the route hold the same edit rules", () => {
  it("holds the same limits", () => {
    expect(cliLimits).toEqual(EDIT_LIMITS);
  });

  it("accepts and refuses the same bodies at the same edges", () => {
    for (const body of bodies) {
      const route = checkListingEdit(body);
      const cli = cliCheckListingEdit(body);
      expect(cli.ok).toBe(route.ok);
      if (route.ok && cli.ok) expect(cli.edit).toEqual(route.edit);
      if (!route.ok && !cli.ok) expect(cli.errors).toEqual(route.errors);
    }
  });

  it("canonicalises the same edit to the same text and digest", async () => {
    for (const body of bodies) {
      const route = checkListingEdit(body);
      if (!route.ok) continue;
      expect(cliCanonicalEdit(route.edit)).toBe(canonicalEdit(route.edit));
      expect(await cliEditDigest(route.edit)).toBe(await editDigest(route.edit));
    }
  });

  it("signs the same message", () => {
    expect(cliListingEditMessage(...args)).toBe(listingEditMessage(...args));
  });

  it("treats the same edit as empty", () => {
    expect(cliIsEmptyEdit({ description: null, examples: [], imageUrl: null })).toBe(true);
    expect(cliIsEmptyEdit(edit)).toBe(false);
  });
});

describe("what the CLI asks the owner to sign", () => {
  it("binds the token, the owner, the content and the moment", async () => {
    const prepared = await prepareEdit(97, "1402", owner, edit);
    expect(prepared.clear).toBe(false);
    expect(prepared.message).toBe(listingEditMessage(97, "1402", owner, prepared.digest, prepared.issuedAt));
    expect(prepared.message).toContain("tokenId: 1402");
    expect(prepared.message).toContain(`owner: ${owner}`);
    expect(prepared.message).toContain(`content: sha256:${await editDigest(edit)}`);
  });

  it("marks a cleared edit", async () => {
    const prepared = await prepareEdit(97, "1402", owner, {});
    expect(prepared.clear).toBe(true);
    expect(prepared.edit).toEqual({ description: null, examples: [], imageUrl: null });
  });

  it("refuses an edit that would not pass the route", async () => {
    await expect(prepareEdit(97, "1402", owner, { description: "short" })).rejects.toThrow(/description must be/);
    await expect(prepareEdit(97, "1402", owner, [])).rejects.toThrow(/must be an object/);
  });
});
