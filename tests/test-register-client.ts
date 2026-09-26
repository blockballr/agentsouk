// The wizard reads the minted token id out of the registration receipt because a wrong id gets
// confirmed against the wrong agent. ERC-721 Transfer carries the id in topic 3 for (from, to, tokenId).
import { describe, expect, it } from "vitest";
import { tokenIdFromReceipt } from "../apps/web/src/lib/register";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = `0x${"0".repeat(64)}`;
const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494bD9e";
const RECIPIENT = "0x000000000000000000000000a9abe4544cad2737429d0be537b23a108644e650";
const TOKEN_2500 = "0x00000000000000000000000000000000000000000000000000000000000009c4";

describe("reading the minted agent id from a receipt", () => {
  it("reads the token id from topic 3, not the recipient from topic 2", () => {
    const logs = [{ address: REGISTRY, topics: [TRANSFER, ZERO, RECIPIENT, TOKEN_2500], data: "0x" }];
    expect(tokenIdFromReceipt(logs, REGISTRY)).toBe("2500");
  });

  it("does not mistake the recipient address for a token id", () => {
    const logs = [{ address: REGISTRY, topics: [TRANSFER, ZERO, RECIPIENT, TOKEN_2500], data: "0x" }];
    const got = tokenIdFromReceipt(logs, REGISTRY);
    expect(got).not.toBe(BigInt(RECIPIENT).toString());
  });

  it("ignores a transfer that is not a mint", () => {
    const logs = [{ address: REGISTRY, topics: [TRANSFER, RECIPIENT, RECIPIENT, TOKEN_2500], data: "0x" }];
    expect(tokenIdFromReceipt(logs, REGISTRY)).toBeNull();
  });

  it("ignores a mint from another contract", () => {
    const logs = [
      {
        address: "0x9332b1aa9b3d5826f0b9b9e1659d962d2da13a53",
        topics: [TRANSFER, ZERO, RECIPIENT, TOKEN_2500],
        data: "0x",
      },
    ];
    expect(tokenIdFromReceipt(logs, REGISTRY)).toBeNull();
  });

  it("returns null when the id topic is absent rather than falling back", () => {
    const logs = [{ address: REGISTRY, topics: [TRANSFER, ZERO, RECIPIENT], data: "0x" }];
    expect(tokenIdFromReceipt(logs, REGISTRY)).toBeNull();
  });

  it("returns null for an empty receipt", () => {
    expect(tokenIdFromReceipt([], REGISTRY)).toBeNull();
  });

  it("matches the registry case insensitively", () => {
    const logs = [
      {
        address: REGISTRY.toLowerCase(),
        topics: [TRANSFER, ZERO, RECIPIENT, TOKEN_2500],
        data: "0x",
      },
    ];
    expect(tokenIdFromReceipt(logs, REGISTRY)).toBe("2500");
  });
});
