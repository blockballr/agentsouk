export type VenueStatus = "live" | "candidate" | "mock";

export interface Venue {
  id: string;
  chainId: number;
  name: string;
  protocol: string;
  kind: "lending" | "erc4626" | "mock";
  asset: string;
  pool: string;
  receipt: string;
  adapter?: string;
  // the protocol's addresses provider, when its own pool does not expose the
  // reserve configuration a risk read needs
  provider?: string;
  rateBps: number | null;
  rateAsOf: string | null;
  status: VenueStatus;
  note: string;
}

export const VENUES: Venue[] = [
  {
    id: "aave-v3-usdt",
    chainId: 56,
    name: "Aave V3 USDT",
    protocol: "Aave",
    kind: "lending",
    asset: "0x55d398326f99059fF775485246999027B3197955",
    pool: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
    receipt: "0xa9251ca9DE909CB71783723713B21E4233fbf1B1",
    provider: "0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D",
    adapter: "0x1928578a29abab83520209cdd3a9b00c74c26e0f",
    rateBps: 307,
    rateAsOf: "2026-10-25",
    status: "live",
    note: "adapter deployed on chain 56; the buffer guard reads the reserve before supply",
  },
  {
    id: "venus-core-vusdt",
    chainId: 56,
    name: "Venus Core vUSDT",
    protocol: "Venus",
    kind: "lending",
    asset: "0x55d398326f99059fF775485246999027B3197955",
    pool: "0xfD36E2c2a6789Db23113685031d7F16329158384",
    receipt: "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
    rateBps: 51,
    rateAsOf: "2026-10-25",
    status: "candidate",
    note: "below the 1 percent buffer floor; not selected",
  },
  {
    id: "venus-hub-usdt",
    chainId: 56,
    name: "Venus Liquidity Hub USDT",
    protocol: "Venus",
    kind: "erc4626",
    asset: "0x55d398326f99059fF775485246999027B3197955",
    pool: "0x18AfDACF30F8671021dec4b78297E39d2FE87226",
    receipt: "0x18AfDACF30F8671021dec4b78297E39d2FE87226",
    rateBps: null,
    rateAsOf: null,
    status: "candidate",
    note: "erc4626 hub; no APY view, aggregate source rates off chain",
  },
  {
    id: "mock-venue-97",
    chainId: 97,
    name: "Testnet mock venue",
    protocol: "Agent Souk",
    kind: "mock",
    asset: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
    pool: "0x6b81b6fff9f6920b309e511159f737454870f8e8",
    receipt: "0x6b81b6fff9f6920b309e511159f737454870f8e8",
    rateBps: 100,
    rateAsOf: "2026-10-25",
    status: "mock",
    note: "testnet only, never on mainnet",
  },
];

export function venuesFor(chainId: number): Venue[] {
  return VENUES.filter((v) => v.chainId === chainId);
}

// the address a hire records is the contract the vault calls supply on. for an
// adapter venue that is the adapter, never the underlying pool. a mock venue has
// no adapter, so its address is the mock itself.
export function venueAddresses(v: Venue): string[] {
  return [v.adapter, v.kind === "mock" ? v.pool : null].filter((a): a is string => Boolean(a));
}

export function venueByAddress(chainId: number, address: string): Venue | null {
  const a = address.toLowerCase();
  return VENUES.find((v) => v.chainId === chainId && venueAddresses(v).some((x) => x.toLowerCase() === a)) ?? null;
}

export function venueById(id: string): Venue | null {
  return VENUES.find((v) => v.id === id) ?? null;
}

export function selectedVenue(chainId: number): Venue | null {
  const live = venuesFor(chainId).filter((v) => v.status === "live" || v.status === "mock");
  return live.sort((a, b) => (b.rateBps ?? 0) - (a.rateBps ?? 0))[0] ?? null;
}
