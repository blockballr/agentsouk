import type { CliConfig } from "../core/config";
import { apiRequest, query } from "../core/http";

export interface VaultInfoRow {
  chainId?: number;
  address?: string;
  minDepositInToken0?: string | null;
  maxOpenPerBuyer?: number | null;
}

export interface VaultInfo {
  success?: boolean;
  vaults?: VaultInfoRow[];
  error?: string;
  [key: string]: unknown;
}

export function vaultFor(vaults: VaultInfoRow[] | undefined, chainId: number): VaultInfoRow | null {
  return (vaults ?? []).find((vault) => Number(vault.chainId) === chainId) ?? null;
}

export interface VaultAgent {
  tokenId?: string;
  name?: string;
  wallet?: string;
  category?: string;
  policy?: string;
  vaultOnly?: boolean;
  firstParty?: boolean;
}

export interface VaultPosition {
  id?: string | number;
  agent?: string;
  open?: boolean;
  fee?: number;
  deposit?: string;
  value?: string;
  pnl?: string;
  realized?: string;
  pnlKind?: string;
  expiry?: number;
}

export interface PositionsPage {
  success?: boolean;
  chainId?: number;
  buyer?: string;
  positions?: VaultPosition[];
  error?: string;
}

export interface PnlAgent {
  wallet?: string;
  label?: string;
  decisions?: number;
  traded?: number;
  skipped?: number;
  refused?: number;
  policies?: string[];
  realized?: string;
}

export interface PnlPage {
  success?: boolean;
  chainId?: number;
  agents?: PnlAgent[];
  error?: string;
}

export async function vaultInfo(config: CliConfig): Promise<VaultInfo> {
  return apiRequest<VaultInfo>(config.apiUrl, `/api/vault${query({ chain: config.chainId })}`, { timeoutMs: 60_000 });
}

export async function vaultAgents(config: CliConfig): Promise<{ agents?: VaultAgent[] }> {
  return apiRequest<{ agents?: VaultAgent[] }>(config.apiUrl, `/api/vault/agents${query({ chain: config.chainId })}`, {
    timeoutMs: 60_000,
  });
}

export async function vaultPositions(config: CliConfig, buyer: string): Promise<PositionsPage> {
  return apiRequest<PositionsPage>(
    config.apiUrl,
    `/api/vault/positions${query({ chainId: config.chainId, buyer })}`,
    { timeoutMs: 60_000 },
  );
}

export async function vaultPnl(config: CliConfig, buyer: string): Promise<PnlPage> {
  return apiRequest<PnlPage>(config.apiUrl, `/api/vault/pnl${query({ chainId: config.chainId, buyer })}`, {
    timeoutMs: 60_000,
  });
}

export async function vaultReceipts(config: CliConfig, hireId: string): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(
    config.apiUrl,
    `/api/vault/receipts${query({ chainId: config.chainId, hireId })}`,
    { timeoutMs: 60_000 },
  );
}
