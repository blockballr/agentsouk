import { describe, expect, it } from "vitest";
import { deriveAgentSector } from "../src/lib/categories";

// the sector answers what an agent trades, never how it trades: the strategy
// keywords that classify rebalancing stay untouched, and an unscored text
// returns null so every untagged snapshot row keeps rendering normally
describe("deriveAgentSector", () => {
  it("claims the stocks sector on one dedicated phrase", () => {
    expect(deriveAgentSector("Tokenized stock LP desk for BNB")).toBe("stocks");
    expect(deriveAgentSector("manages tokenized stocks exposure")).toBe("stocks");
    expect(deriveAgentSector("tokenized equity ranges")).toBe("stocks");
  });

  it("needs two weak signals: a stock word plus rwa or a ticker", () => {
    expect(deriveAgentSector("the stock pool builder")).toBe(null);
    expect(deriveAgentSector("a stock and an rwa desk")).toBe("stocks");
    // the ticker convention alone never claims the sector
    expect(deriveAgentSector("provides liquidity for AAPLB and SPYB pools")).toBe(null);
    expect(deriveAgentSector("TSLA B range builder")).toBe(null);
    expect(deriveAgentSector("TSLA-B and tokenized equity")).toBe("stocks");
  });

  it("never reads lending vocabulary as a stock", () => {
    expect(deriveAgentSector("aave and venus collateral monitor")).toBe(null);
    // an allcaps word that merely ends in b is not a ticker
    expect(deriveAgentSector("the OPENB vault rebalancer")).toBe(null);
  });
});
