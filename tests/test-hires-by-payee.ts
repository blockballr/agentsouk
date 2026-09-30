// the payee read names the asset from chain config rather than the receipt's label,
// and says who paid so our probes and a lister's own tests never read as customers
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const LISTER = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const RELAY = "0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4";

function receipt(paymentId: string, client: string, symbol = "USDC") {
  return {
    paymentId,
    createdAt: "2026-09-29T00:00:00.000Z",
    txHash: null,
    mode: "prod",
    agent: { chainId: 97, tokenId: "2504", name: "Health Guard" },
    client,
    payTo: LISTER,
    amount: "2000000000000000000",
    symbol,
    activated: true,
  };
}

const receipts = vi.hoisted(() => ({
  listPaymentsByPayee: vi.fn(async (): Promise<unknown[]> => []),
  receiptsMode: vi.fn(() => "postgres"),
}));
vi.mock("@/lib/receipts-store", () => receipts);

async function read() {
  const { GET } = await import("@/app/api/hires/by-payee/route");
  const res = await GET(new NextRequest(`http://test/api/hires/by-payee?payee=${LISTER}`));
  return (await res.json()) as { hires: { paymentId: string; symbol: string; decimals: number; payer: string }[] };
}

describe("hires by payee", () => {
  it("renders the chain's settlement asset even when the receipt stored another label", async () => {
    receipts.listPaymentsByPayee.mockResolvedValueOnce([receipt("pay_1", BUYER, "USDC")]);
    const { hires } = await read();
    expect(hires[0].symbol).toBe("sUSD");
    expect(hires[0].decimals).toBe(18);
  });

  it("names a verifier probe, a self hire, a team wallet, and a buyer apart", async () => {
    receipts.listPaymentsByPayee.mockResolvedValueOnce([
      receipt("verify_abc", RELAY),
      receipt("pay_self", LISTER.toUpperCase().replace("0X", "0x")),
      receipt("pay_team", RELAY),
      receipt("pay_buyer", BUYER),
    ]);
    const { hires } = await read();
    expect(hires.map((h) => [h.paymentId, h.payer])).toEqual([
      ["verify_abc", "check"],
      ["pay_self", "self"],
      ["pay_team", "team"],
      ["pay_buyer", "buyer"],
    ]);
  });
});
