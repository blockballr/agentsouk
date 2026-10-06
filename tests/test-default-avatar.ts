import { describe, expect, it } from "vitest";
import { defaultAvatarFor } from "../apps/web/src/lib/default-avatar";

describe("defaultAvatarFor", () => {
  it("returns a member of the house glyph set for any agent", () => {
    expect(defaultAvatarFor(97, "2554")).toMatch(/^\/inserts\/[a-z]+\.svg$/);
    expect(defaultAvatarFor(56, "1200")).toMatch(/^\/inserts\/[a-z]+\.svg$/);
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
