import { describe, expect, it } from "vitest";
import { defaultAvatarFor } from "../apps/web/src/lib/default-avatar";

describe("defaultAvatarFor", () => {
  it("returns a deterministic remote glyph for any agent", () => {
    // the default face is a DiceBear Bottts URL keyed on the listing, so an
    // agent without an image keeps one face without a hosted asset to maintain
    expect(defaultAvatarFor(97, "2554")).toMatch(/^https:\/\/api\.dicebear\.com\/9\.x\/bottts\/svg\?/);
    expect(defaultAvatarFor(56, "1200")).toMatch(/^https:\/\/api\.dicebear\.com\/9\.x\/bottts\/svg\?/);
  });

  it("keeps one agent on one default forever, and differs between agents", () => {
    for (const tokenId of ["2554", "2521", "2173", "9"]) {
      expect(defaultAvatarFor(97, tokenId)).toBe(defaultAvatarFor(97, tokenId));
    }
    // 64 sample tokens should not all collapse onto one face
    const faces = new Set<string>();
    for (let i = 0; i < 64; i++) faces.add(defaultAvatarFor(97, String(2500 + i)));
    expect(faces.size).toBeGreaterThan(2);
  });
});
