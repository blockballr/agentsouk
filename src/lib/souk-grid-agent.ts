// Souk Grid Pilot: the first-party grid trading agent. It plans ladders over a2a
// and as ERC-8183 jobs through the planner's own arithmetic, quotes jobs with a
// wallet-signed price, and trades funded HireVault hires through the strategy
// layer inside the contract's bounds. The endpoint itself holds no key: the
// trading half is the operator's executor, named per hire, bounded on chain.

import { privateEndpointReason } from "./endpoint";
import { gridPlanSkill, type GridAgentCard, type GridAgentSkill } from "./reference-grid";
import { VAULT_BY_CHAIN } from "./vault";

export const SOUK_GRID_AGENT_NAME = "Souk Grid Pilot";
export const SOUK_GRID_AGENT_VERSION = "1.0.0";
export const SOUK_GRID_AGENT_CATEGORY = "grid-trading";
export const SOUK_GRID_AGENT_PROTOCOL_VERSION = "0.3.0";
export const SOUK_GRID_AGENT_DESCRIPTION =
  "Plans a grid trading ladder and trades it. Plans: given a price range, rung count, value per rung and optional fee, returns rung spacing, first and last rung prices, capital committed, and the gross, fee and net capture of one completed round trip, plus the total if price crosses the whole range once and every rung fills. Name a PancakeSwap pair and a width instead of a range and it centres the ladder on that pool's current price, naming the chain, pool and block it read. Trades: a HireVault hire naming this wallet is run by the strategy layer inside the contract's bounds, floor, drawdown budget and slippage checked on chain, never by the agent. Sells the plan as an ERC-8183 job: negotiate returns a wallet-signed quote in the kernel's payment token; a funded job is planned and its deliverable submitted on chain. This endpoint sends no transaction and holds no key.";
export const SOUK_GRID_AGENT_PUBLIC_ORIGIN = "https://api.agentsouk.xyz";
// the house executor, the wallet whose key signs this agent's quotes and runs
// its vault trades. Declared on the card so a hire names the wallet that can
// actually do the work, not the operator that holds the token.
export const SOUK_GRID_AGENT_WALLET = "0xe0b0C4e84efc42e8D91410A14a125a8759c782Fd";
export const SOUK_GRID_AGENT_CARD_PATH = "/api/souk-grid/.well-known/agent-card.json";
export const SOUK_GRID_AGENT_MESSAGING_PATH = "/api/souk-grid/a2a";
export const SOUK_GRID_AGENT_MCP_PATH = "/api/souk-grid/mcp";

// this listing's registry id, per chain, carried in every quote as agent_id so
// a buyer's fund step never sees a stranger's id; filled the moment a chain's
// listing mints, the way the house agent's was
// filled in once the new listing is minted; empty until then
export const SOUK_GRID_AGENT_TOKEN_IDS: Record<number, number> = {};

export function soukGridAgentTokenId(chainId: number): number | null {
  return SOUK_GRID_AGENT_TOKEN_IDS[chainId] ?? null;
}

// The card must never name a private or loopback address, so a configured
// origin is used only when it passes the marketplace's own check; otherwise the
// deployed api origin wins.
export function pickSoukGridOrigin(candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? "").trim().replace(/\/+$/, "");
    if (trimmed && privateEndpointReason(trimmed) === null) return trimmed;
  }
  return SOUK_GRID_AGENT_PUBLIC_ORIGIN;
}

export function soukGridAgentMessagingUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${SOUK_GRID_AGENT_MESSAGING_PATH}`;
}

export function soukGridAgentMcpUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${SOUK_GRID_AGENT_MCP_PATH}`;
}

// The seller-side ERC-8183 steps the kernel's flow needs: the marketplace
// quotes this listing through negotiate and notifies it on fund. The 8183
// naming in the negotiate description is how a job-step skill is told from the
// plan skill that does the work.
const NEGOTIATE_SKILL: GridAgentSkill = {
  id: "negotiate",
  name: "Quote an ERC-8183 job",
  description:
    "ERC-8183 job selling: answers a negotiate step with a wallet-signed quote priced in the kernel's payment token, naming this listing's registered wallet as provider. The job buys this agent's grid work; the trading itself runs only inside a hire's bounded vault, never from this endpoint.",
  tags: ["erc-8183", "job", "negotiate", "quote"],
  examples: [],
  inputModes: ["application/json"],
  outputModes: ["application/json"],
};

const NOTIFY_SKILL: GridAgentSkill = {
  id: "notify_funded",
  name: "Plan the grid for a funded ERC-8183 job",
  description:
    "ERC-8183 job selling: on notify_funded the kernel's own row is read back to confirm this listing is the funded job's provider, the ladder is planned from the job's own description, and the deliverable is submitted on chain for the optimistic dispute window to release.",
  tags: ["erc-8183", "job", "notify-f"],
  examples: [],
  inputModes: ["application/json"],
  outputModes: ["application/json"],
};

export function soukGridAgentCard(origin: string): GridAgentCard {
  const base = origin.replace(/\/+$/, "");
  const messagingUrl = soukGridAgentMessagingUrl(base);
  return {
    name: SOUK_GRID_AGENT_NAME,
    description: SOUK_GRID_AGENT_DESCRIPTION,
    version: SOUK_GRID_AGENT_VERSION,
    url: messagingUrl,
    protocolVersion: SOUK_GRID_AGENT_PROTOCOL_VERSION,
    provider: { organization: "Agent Souk", url: base },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [gridPlanSkill(), NEGOTIATE_SKILL, NOTIFY_SKILL],
    supportedInterfaces: [{ url: messagingUrl, transport: "JSONRPC" }],
    // one entry per surface, each its own URL: the registry is read by clients
    // that never fetch the card itself, and a single endpoint would send both
    // protocols to the same route
    services: [
      { name: "A2A", endpoint: messagingUrl },
      { name: "MCP", endpoint: soukGridAgentMcpUrl(base) },
    ],
    agentWallet: SOUK_GRID_AGENT_WALLET,
    // Agent Souk's HireVault, published so a buyer on any marketplace can open
    // a funded trading mandate with this agent. It is read from the same table
    // the executor sweeps rather than typed here: a hire opened at an address
    // this card invented is a hire no one trades, and the two drifted once.
    vault: Object.entries(VAULT_BY_CHAIN).map(([chainId, address]) => ({
      chainId: Number(chainId),
      address,
    })),
  };
}



