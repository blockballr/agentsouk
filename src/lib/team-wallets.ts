// the wallets the team operates, as declared in the tracking addendum
// their activity is never a buyer's hire, a quest step, or an agent's track record
export const TEAM_WALLETS: ReadonlySet<string> = new Set(
  [
    "0xE5655aBBEfbB9E1427174F8Dc826880e9d1d4Bc4", // relay / broadcaster
    "0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713", // buyer / authorizer
    "0x84fedaBd1b83443aD86796C15619494878B64180", // agent owner, holds our five listings
    "0x52DA44aB471455437fc17979c52E501f6b8d0EAF", // deployment wallet
    "0x5188d3b15271bD0eD56B1dE86B50198d4497c4e5", // declared agent identity
  ].map((a) => a.toLowerCase()),
);

export function isTeamWallet(address: string | null | undefined): boolean {
  return !!address && TEAM_WALLETS.has(address.toLowerCase());
}

// the verifier pays for its own probes, so those receipts are sweeps, not hires
export function isVerifierPayment(paymentId: string | null | undefined): boolean {
  return String(paymentId ?? "").startsWith("verify_");
}
