// the site signs an edit and the route verifies it, so the two copies of the rules
// have to stay identical: same limits, same canonical text, same message

import { describe, expect, it } from "vitest";
import {
  EDIT_LIMITS,
  canonicalEdit,
  checkListingEdit,
  editDigest,
  listingEditMessage,
  type ListingEdit,
} from "../src/lib/listing-edit";
import {
  EDIT_LIMITS as siteLimits,
  canonicalEdit as siteCanonicalEdit,
  checkListingEdit as siteCheckListingEdit,
  editDigest as siteEditDigest,
  listingEditMessage as siteListingEditMessage,
} from "../apps/web/src/lib/listing-edit";

const edit: ListingEdit = {
  description: "Rebalances a Venus position when the health factor falls.",
  examples: [{ task: "Show the health factor", input: '{"collateral":1000}' }],
  imageUrl: "https://agentsouk.xyz/icon.png",
};

const owner = "0x1111111111111111111111111111111111111111";
const args = [97, "1402", owner, "a".repeat(64), "2026-10-02T00:00:00.000Z"] as const;

describe("the site and the route hold the same edit rules", () => {
  it("holds the same limits", () => {
    expect(siteLimits).toEqual(EDIT_LIMITS);
  });

  it("canonicalises the same edit to the same text", async () => {
    expect(siteCanonicalEdit(edit)).toBe(canonicalEdit(edit));
    expect(await siteEditDigest(edit)).toBe(await editDigest(edit));
  });

  it("signs the same message", () => {
    expect(siteListingEditMessage(...args)).toBe(listingEditMessage(...args));
  });

  it("accepts and refuses the same bodies at the same edges", () => {
    const tooShort = { ...edit, description: "x".repeat(19) };
    const longEnough = { ...edit, description: "x".repeat(20) };
    const fourExamples = { ...edit, examples: [1, 2, 3, 4].map((n) => ({ task: `request number ${n}`, input: null })) };

    for (const body of [edit, tooShort, longEnough, fourExamples]) {
      expect(siteCheckListingEdit(body).ok).toBe(checkListingEdit(body).ok);
    }
    expect(checkListingEdit(tooShort).ok).toBe(false);
    expect(checkListingEdit(longEnough).ok).toBe(true);
    expect(checkListingEdit(fourExamples).ok).toBe(false);
  });
});
