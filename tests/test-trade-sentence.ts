import { describe, expect, it } from "vitest";
import { tradeSentence } from "../apps/web/src/components/ReceiptsList";

// a receipt recorded on mainnet for vault hire 13, 9 November 2026
const sold = {
  before: { balanceA: "241216689005300", balanceB: "1834635095016217701" },
  after: { balanceA: "219287899095728", balanceB: "1849589852084156063" },
  trigger: { side: "sellA", rungPrice: 682.3102529251387, refPrice: 682.3102529251387 },
};

describe("a vault trade in words", () => {
  it("says what was sold, for how much, at what price", () => {
    expect(tradeSentence(sold)).toBe("Sold 0.0000219 WBNB for 0.015 USDT at 682.31 USDT");
  });

  it("reads a buy the other way round", () => {
    const bought = { before: sold.after, after: sold.before, trigger: { side: "buyA", rungPrice: 680 } };
    expect(tradeSentence(bought)).toBe("Bought 0.0000219 WBNB for 0.015 USDT at 680 USDT");
  });

  it("falls back to what it knows when the balances are missing", () => {
    expect(tradeSentence({ before: null, after: null, trigger: { side: "sellA", rungPrice: 700 } })).toBe("Sold WBNB at 700 USDT");
    expect(tradeSentence({ before: null, after: null, trigger: null })).toBe("Traded inside the hire");
  });
});

describe("engine reasons for people", () => {
  it("rounds long prices and leaves short numbers alone", async () => {
    const { roundNumbers } = await import("../apps/web/src/components/ReceiptsList");
    expect(roundNumbers("price 682.3102529251387 left the band [683.79682221529, 690.6691520868004]; generation 3")).toBe(
      "price 682.31 left the band [683.8, 690.67]; generation 3",
    );
  });
});
