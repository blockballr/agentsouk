export const BSC_CHAIN_ID = 56;

export const BSC_REGISTRY_ADDRESS =
  "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";

// BSC mainnet token contracts
// $U (United Stables) implements EIP-3009 (transferWithAuthorization), which
// x402 uses for gasless stablecoin payments. Verified on-chain 2026-09-08:
// vrs selector 0xe3ee160e present, DOMAIN_SEPARATOR matches
// ("United Stables", "1", chainId 56), decimals 18
export const BSC_TOKENS = {
  U: {
    symbol: "U",
    address: "0xcE24439F2D9C6a2289F741120FE202248B666666",
    decimals: 18,
  },
  USDT: {
    symbol: "USDT",
    address: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
  },
} as const;

export type CategoryKey =
  | "rebalancing"
  | "grid-trading"
  | "yield"
  | "health-factor";

export interface CategoryDef {
  key: CategoryKey;
  label: string;
  short: string;
  description: string;
  blurb: string;
}

// the four hackathon categories, surfaced equally deep
export const CATEGORIES: CategoryDef[] = [
  {
    key: "rebalancing",
    label: "Rebalancing",
    short: "LP Ranges",
    description: "Manages LP ranges, resets positions automatically",
    blurb: "Keeps liquidity in range and auto-resets positions before they go stale.",
  },
  {
    key: "grid-trading",
    label: "Grid Trading",
    short: "Grids",
    description: "Places and manages automated grid orders",
    blurb: "Runs automated buy-low/sell-high grids within set price ranges.",
  },
  {
    key: "yield",
    label: "Yield Optimisation",
    short: "Yield",
    description: "Routes liquidity to the highest available APR",
    blurb: "Routes capital to wherever it earns the most, across venues.",
  },
  {
    key: "health-factor",
    label: "Health Factor Monitoring",
    short: "Health",
    description: "Protects lending positions from liquidation",
    blurb: "Watches borrowing positions and acts before liquidation hits.",
  },
];

export const CATEGORY_KEYS: CategoryKey[] = CATEGORIES.map((c) => c.key);

export type VerificationStatus = "delivered" | "gated" | "dead" | "unreachable";

export interface VerificationQuality {
  grade: "good" | "partial" | "poor";
  reason: string;
  model: string;
}

export interface Verification {
  status: VerificationStatus;
  responseMs: number;
  checkedAt: string;
  quality?: VerificationQuality;
  concurrency?: "parallel-ok" | "single-ok" | "untested";
}

export interface AgentSummary {
  agent_id: string;
  token_id: string;
  chain_id: number;
  contract_address: string;
  owner_address: string;
  name: string;
  description: string | null;
  image_url: string | null;
  is_verified: boolean;
  star_count: number;
  x402_supported: boolean;
  total_score: number;
  average_score: number;
  total_feedbacks: number;
  health_score: number | null;
  supported_trust_models: string[];
  is_active: boolean;
  created_at: string;
  // enriched client-side
  category?: CategoryKey | "general";
  categoryScores?: Partial<Record<CategoryKey, number>>;
  verification?: Verification;
  pcs?: boolean;
}

export interface AgentDetail {
  id: string;
  agent_id: string;
  token_id: string;
  chain_id: number;
  contract_address: string;
  owner_address: string;
  creator_address: string;
  name: string;
  description: string | null;
  agent_wallet: string | null;
  x402_supported: boolean;
  image_url: string | null;
  is_verified: boolean;
  is_active: boolean;
  supported_trust_models: string[];
  services: unknown | null;
  a2a_endpoint: string | null;
  mcp_server: string | null;
  agent_url: string | null;
  total_feedbacks: number;
  total_validations: number;
  successful_validations: number;
  average_score: number;
  total_score: number;
  health_score: number | null;
  health_status: string | null;
  quality_score: number;
  popularity_score: number;
  activity_score: number;
  wallet_score: number;
  freshness_score: number;
  metadata_completeness_score: number;
  created_block_number: number | null;
  created_tx_hash: string | null;
  is_endpoint_verified: boolean;
  endpoint_verified_domain: string | null;
  raw_metadata: {
    onchain: { key: string; value: string; decoded: unknown }[] | null;
    offchain_uri: string | null;
    offchain_content: Record<string, unknown> | null;
  } | null;
  created_at: string;
  updated_at: string;
  verification?: Verification;
  pcs?: boolean;
}
