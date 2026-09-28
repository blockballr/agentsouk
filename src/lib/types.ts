export const BSC_CHAIN_ID = 56;
export const BSC_TESTNET_CHAIN_ID = 97;

export function targetChainId(): number {
  const raw = Number.parseInt(process.env.TARGET_CHAIN ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : BSC_CHAIN_ID;
}

export function snapshotFileFor(chainId: number): string {
  return chainId === BSC_CHAIN_ID ? "agents.json" : `agents-${chainId}.json`;
}

export function scoutDirFor(chainId: number): string {
  return chainId === BSC_CHAIN_ID ? "scout" : `scout-${chainId}`;
}

// Explorer for a chain, so a link we hand out points at the network the
// transaction is on rather than always at mainnet.
export function explorerBaseFor(chainId: number): string {
  return chainId === BSC_TESTNET_CHAIN_ID ? "https://testnet.bscscan.com" : "https://bscscan.com";
}

export const BSC_REGISTRY_ADDRESS =
  "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";

// BSC mainnet token contracts
// $U (United Stables) implements EIP-3009 (transferWithAuthorization) for gasless x402 payments
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

// The asset x402 settles in, per chain; both implement the nine-argument
// transferWithAuthorization variant, selector 0xe3ee160e. chain 56 settles in $U, chain 97 in sUSD.
export interface SettlementAsset {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  eip712Name: string;
  eip712Version: string;
}

const SETTLEMENT_ASSETS: Record<number, SettlementAsset> = {
  [BSC_CHAIN_ID]: {
    symbol: "U",
    address: "0xcE24439F2D9C6a2289F741120FE202248B666666",
    decimals: 18,
    eip712Name: "United Stables",
    eip712Version: "1",
  },
  [BSC_TESTNET_CHAIN_ID]: {
    symbol: "sUSD",
    address: "0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53",
    decimals: 18,
    eip712Name: "Agent Souk Test USD",
    eip712Version: "1",
  },
};

export function settlementAsset(chainId: number = targetChainId()): SettlementAsset {
  const asset = SETTLEMENT_ASSETS[chainId];
  if (!asset) {
    throw new Error(
      `No settlement asset is configured for chain ${chainId}. Add one to SETTLEMENT_ASSETS before serving hires on it.`,
    );
  }
  return asset;
}

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

// What an agent declares about how it is called: the skills on its A2A card, or
// its MCP tools. Captured at admission so any listing, third-party ones the
// sweep picks up included, can show what the agent expects without a per-view
// fetch.
export interface AgentCardSkill {
  id?: string;
  name?: string;
  description?: string;
  examples?: string[];
  inputModes?: string[];
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
    examples?: Record<string, unknown>[];
  };
  outputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
  };
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
  a2a_endpoint?: string | null;
  mcp_server?: string | null;
  // a web service the owner declared; it is browser-invoked, so the marketplace cannot call it
  web_endpoint?: string | null;
  is_active: boolean;
  created_at: string;
  // enriched client-side
  category?: CategoryKey | "general";
  categoryScores?: Partial<Record<CategoryKey, number>>;
  verification?: Verification;
  pcs?: boolean;
  skills?: AgentCardSkill[];
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
  // a web service the owner declared; browser-invoked, never called by the marketplace
  web_endpoint?: string | null;
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
  skills?: AgentCardSkill[];
}
