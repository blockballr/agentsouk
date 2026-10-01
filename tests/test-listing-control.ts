// The owner signs the site's text and the delist route verifies the server's, so the two
// copies must stay identical; and the database, when it answers, decides what is delisted.
import { describe, expect, it } from "vitest";
import { listingControlMessage as serverMessage, pickDelisted } from "../src/lib/listing-control";
import { listingControlMessage as siteMessage } from "../apps/web/src/lib/listing-control";

const OWNER = "0x84FEdabd1b83443ad86796c15619494878b64180";

describe("listing control message", () => {
  it("is the same text on the site and the server", () => {
    for (const action of ["delist", "relist"] as const) {
      expect(siteMessage(97, "2524", OWNER, action)).toBe(serverMessage(97, "2524", OWNER, action));
    }
  });

  it("binds the chain, token, lowercased owner and action", () => {
    const text = serverMessage(97, "2524", OWNER, "relist");
    expect(text.split("\n")).toEqual([
      "Agent Souk listing control",
      "chainId: 97",
      "tokenId: 2524",
      `owner: ${OWNER.toLowerCase()}`,
      "action: relist",
    ]);
    expect(serverMessage(97, "2524", OWNER, "delist")).not.toBe(text);
    expect(serverMessage(97, "2522", OWNER, "relist")).not.toBe(text);
  });
});

describe("which tokens are delisted", () => {
  it("takes the database over memory when the database answered", () => {
    const rows = [{ tokenId: "2524", reason: "owner delist", delistedAt: "2026-10-01T08:00:00.000Z" }];
    // 2522 is a stale memory entry from another instance's earlier delist
    const picked = pickDelisted(rows, ["2522", "2524"]);
    expect([...picked.keys()]).toEqual(["2524"]);
    expect(picked.get("2524")?.reason).toBe("owner delist");
  });

  it("treats an empty database answer as nothing delisted", () => {
    expect(pickDelisted([], ["2522"]).size).toBe(0);
  });

  it("falls back to memory when there is no database answer", () => {
    const picked = pickDelisted(null, ["2522"]);
    expect([...picked.keys()]).toEqual(["2522"]);
    expect(picked.get("2522")?.reason).toBeNull();
  });
});
