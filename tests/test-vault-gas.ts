// The form's gas figure starts as the measured constant and becomes the vault's
// own recent average per side once that side has enough receipts.
import { describe, expect, it } from "vitest";
import { DEFAULT_OPEN_GAS, DEFAULT_WITHDRAW_GAS, estimateRoundTrip } from "../src/lib/vault-gas";

describe("round trip gas", () => {
  it("uses the constants before there is history", () => {
    const out = estimateRoundTrip({ openGas: null, withdrawGas: null, openSamples: 0, withdrawSamples: 0 });
    expect(out.roundTripGas).toBe(DEFAULT_OPEN_GAS + DEFAULT_WITHDRAW_GAS);
    expect(out.source).toBe("constant");
  });

  it("moves one side at a time once that side has enough samples", () => {
    const out = estimateRoundTrip({
      openGas: 100_000,
      withdrawGas: 90_000,
      openSamples: 4,
      withdrawSamples: 2,
    });
    expect(out.openGas).toBe(100_000);
    expect(out.withdrawGas).toBe(DEFAULT_WITHDRAW_GAS);
    expect(out.source).toBe("partial");
  });

  it("uses the recent average on both sides once both are proven", () => {
    const out = estimateRoundTrip({
      openGas: 141_400,
      withdrawGas: 92_600,
      openSamples: 3,
      withdrawSamples: 3,
    });
    expect(out.openGas).toBe(141_400);
    expect(out.withdrawGas).toBe(92_600);
    expect(out.roundTripGas).toBe(234_000);
    expect(out.source).toBe("recent");
  });

  it("falls back when a sample count is high but the reading is missing", () => {
    const out = estimateRoundTrip({ openGas: null, withdrawGas: null, openSamples: 9, withdrawSamples: 9 });
    expect(out.roundTripGas).toBe(DEFAULT_OPEN_GAS + DEFAULT_WITHDRAW_GAS);
    expect(out.source).toBe("constant");
  });
});
