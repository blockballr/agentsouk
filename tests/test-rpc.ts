import { describe, expect, it } from "vitest";
import { rpcUrlsFor } from "../packages/core/src/rpc";

// The dead dataseed hosts are why this module exists: a deployment whose only endpoint cannot
// resolve cannot broadcast a hire; these pin the order (override first, verified defaults behind it).
const DEAD_HOSTS = ["data-seed-prebsc", "dataseed.binance.org"];

describe("rpcUrlsFor", () => {
  it("offers a fallback list for each chain this app settles on", () => {
    expect(rpcUrlsFor(56).length).toBeGreaterThanOrEqual(2);
    expect(rpcUrlsFor(97).length).toBeGreaterThanOrEqual(2);
  });

  it("puts the override first and keeps the verified defaults behind it", () => {
    const urls = rpcUrlsFor(97, "https://my-node.example");
    expect(urls[0]).toBe("https://my-node.example");
    expect(urls).toContain("https://bsc-testnet-rpc.publicnode.com");
    expect(urls.length).toBeGreaterThan(1);
  });

  it("accepts a comma separated override and trims it", () => {
    const urls = rpcUrlsFor(56, "https://a.example, https://b.example");
    expect(urls.slice(0, 2)).toEqual(["https://a.example", "https://b.example"]);
  });

  it("does not repeat an override that already appears in the defaults", () => {
    const urls = rpcUrlsFor(56, "https://bsc-rpc.publicnode.com");
    expect(urls.filter((u) => u === "https://bsc-rpc.publicnode.com")).toHaveLength(1);
  });

  it("ships no host that stopped resolving", () => {
    for (const chainId of [56, 97]) {
      for (const url of rpcUrlsFor(chainId)) {
        for (const dead of DEAD_HOSTS) expect(url).not.toContain(dead);
      }
    }
  });
});
