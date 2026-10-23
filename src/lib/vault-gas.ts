// The round-trip gas shown on the hire form: an average of the vault's own recent
// opens and exits once there are enough of them, and a measured constant until
// then. The constant is the number the deployed vault showed, not a guess; the
// average replaces it per side as soon as that side has samples.
export const DEFAULT_OPEN_GAS = 150_000;
export const DEFAULT_WITHDRAW_GAS = 100_000;
export const MIN_GAS_SAMPLES = 3;

export interface GasReading {
  openGas: number | null;
  withdrawGas: number | null;
  openSamples: number;
  withdrawSamples: number;
}

export interface GasEstimate {
  roundTripGas: number;
  openGas: number;
  withdrawGas: number;
  source: "recent" | "partial" | "constant";
}

export function estimateRoundTrip(reading: GasReading): GasEstimate {
  const openRecent = reading.openSamples >= MIN_GAS_SAMPLES && reading.openGas != null;
  const withdrawRecent = reading.withdrawSamples >= MIN_GAS_SAMPLES && reading.withdrawGas != null;
  const open = openRecent ? Math.round(reading.openGas as number) : DEFAULT_OPEN_GAS;
  const withdraw = withdrawRecent ? Math.round(reading.withdrawGas as number) : DEFAULT_WITHDRAW_GAS;
  const source = openRecent && withdrawRecent
    ? "recent"
    : openRecent || withdrawRecent
      ? "partial"
      : "constant";
  return { roundTripGas: open + withdraw, openGas: open, withdrawGas: withdraw, source };
}
