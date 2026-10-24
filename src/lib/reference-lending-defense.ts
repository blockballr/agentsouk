// Souk Lending Defender: defends a buyer's lending position on Venus only
// inside a funded HireVault hire, where the contract holds the deposit and
// enforces the floor, drawdown budget and slippage.

import { privateEndpointReason } from "./endpoint";
import { vaultCardSkill } from "./vault-card-skill";

export const LENDING_DEFENDER_NAME = "Souk Lending Defender";
export const LENDING_DEFENDER_VERSION = "1.0.0";
export const LENDING_DEFENDER_CATEGORY = "health-factor";
export const LENDING_DEFENDER_DESCRIPTION =
  "Defends a lending position only inside a funded HireVault hire. Reads a Venus lending position on BNB Chain, computes the health factor, and when it reaches the defend band sells collateral to repay debt through the hire, aiming at the target health factor. Refuses to trade when the position is already liquidatable or the price read is stale. The vault enforces the floor, drawdown budget and slippage on chain. This endpoint sells no per-call work and takes no x402 payment.";

export const LENDING_DEFENDER_PUBLIC_ORIGIN = "https://api.agentsouk.xyz";
export const LENDING_DEFENDER_CARD_PATH = "/api/reference/lending-defender/.well-known/agent-card.json";
export const LENDING_DEFENDER_MESSAGING_PATH = "/api/reference/lending-defender/a2a";

export interface LendingDefenderSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  inputModes: string[];
  outputModes: string[];
}

export function lendingDefenderPickPublicOrigin(candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? "").trim().replace(/\/+$/, "");
    if (trimmed && privateEndpointReason(trimmed) === null) return trimmed;
  }
  return LENDING_DEFENDER_PUBLIC_ORIGIN;
}

export function lendingDefenderAgentCard(origin: string): {
  name: string;
  description: string;
  version: string;
  url: string;
  protocolVersion: string;
  provider: { organization: string; url: string };
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: LendingDefenderSkill[];
  supportedInterfaces: { url: string; transport: string }[];
} {
  const base = origin.replace(/\/+$/, "");
  const messagingUrl = `${base}${LENDING_DEFENDER_MESSAGING_PATH}`;
  return {
    name: LENDING_DEFENDER_NAME,
    description: LENDING_DEFENDER_DESCRIPTION,
    version: LENDING_DEFENDER_VERSION,
    url: messagingUrl,
    protocolVersion: "0.3.0",
    provider: { organization: "Agent Souk", url: base },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [vaultCardSkill("health-factor")],
    supportedInterfaces: [{ url: messagingUrl, transport: "JSONRPC" }],
  };
}
