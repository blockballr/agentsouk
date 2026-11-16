import { describe, expect, it } from "vitest";
import { buildProofFeed, settledAmount } from "../src/lib/proof-feed";

const tx = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const WALLET = "0xb815E17D6138aE6C7D6961C86A44006da45b54ef";

const hires = [
  { at: "2026-11-09T18:47:58.488Z", agentName: "Souk Health Guard", tokenId: "404603", amount: "0.0200", symbol: "U", txHash: tx(1) },
  { at: "2026-11-10T10:00:00.000Z", agentName: "Souk Grid Pilot", tokenId: "376593", amount: "0.0200", symbol: "U", txHash: null },
  { at: "2026-10-26T22:19:00.082Z", agentName: "Souk Grid Pilot", tokenId: "376593", amount: "0.0200", symbol: "U", txHash: "not a hash" },
];

const trades = [
  { createdAt: "2026-11-05T23:28:00.000Z", agent: WALLET.toLowerCase(), hireId: "12", status: "traded", txHash: tx(2) },
  { createdAt: "2026-11-06T01:00:00.000Z", agent: WALLET, hireId: "12", status: "skipped", txHash: null },
  { createdAt: "2026-11-06T02:00:00.000Z", agent: WALLET, hireId: "12", status: "refused", txHash: tx(3) },
  { createdAt: "2026-11-07T02:00:00.000Z", agent: "0x0000000000000000000000000000000000000009", hireId: "3", status: "traded", txHash: tx(4) },
];

const agents = [{ tokenId: "368655", name: "Souk Drift Guard", wallet: WALLET.toLowerCase() }];

describe("proof feed", () => {
  it("keeps only actions a transaction backs, newest first", () => {
    const feed = buildProofFeed({ hires, trades, agents, limit: 10 });
    expect(feed.map((f) => f.txHash)).toEqual([tx(1), tx(4), tx(2)]);
    expect(feed[0]).toMatchObject({ agentName: "Souk Health Guard", rail: "x402", kind: "hire", amount: "0.0200", detail: "Paid call, settled on delivery" });
  });

  it("names a vault trade by the agent whose wallet sent it", () => {
    const feed = buildProofFeed({ hires: [], trades, agents, limit: 10 });
    expect(feed.find((f) => f.txHash === tx(2))).toMatchObject({ agentName: "Souk Drift Guard", tokenId: "368655", rail: "vault", kind: "trade" });
    expect(feed.find((f) => f.txHash === tx(4))).toMatchObject({ agentName: "Vault agent", tokenId: null });
  });

  it("filters to one agent, drops a repeated transaction and stops at the limit", () => {
    expect(buildProofFeed({ hires, trades, agents, limit: 10, tokenId: "368655" }).map((f) => f.txHash)).toEqual([tx(2)]);
    expect(buildProofFeed({ hires: [hires[0], { ...hires[0] }], trades: [], agents, limit: 10 })).toHaveLength(1);
    expect(buildProofFeed({ hires, trades, agents, limit: 1 })).toHaveLength(1);
  });

  it("formats a wei amount and leaves anything else as it came", () => {
    expect(settledAmount("20000000000000000")).toBe("0.0200");
    expect(settledAmount("2500000000000000000")).toBe("2.50");
    expect(settledAmount("0")).toBe("0");
    expect(settledAmount("1.5")).toBe("1.5");
  });
});
