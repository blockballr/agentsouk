import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "./errors";

export type Rail = "direct" | "jobs" | "vault" | "x402" | "all";

export interface CliConfig {
  apiUrl: string;
  rpcUrl: string;
  chainId: number;
  defaultWallet: string | null;
  defaultRail: Rail;
}

export const DEFAULT_CONFIG: CliConfig = {
  apiUrl: "https://api.agentsouk.xyz",
  rpcUrl: "https://bsc-dataseed.bnbchain.org",
  chainId: 56,
  defaultWallet: null,
  defaultRail: "direct",
};

export function configPath(home: string = homedir()): string {
  return join(home, ".agentsouk", "config.json");
}

// a config that other local users can read is a config that leaks who you are,
// so the file has to be owner only before it is trusted
export function assertOwnerOnly(path: string): void {
  if (process.platform === "win32") return;
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new CliError(`${path} must not be group or world readable (chmod 600 ${path})`, "config_permissions");
  }
}

export function readConfigFile(path: string): Partial<CliConfig> {
  if (!existsSync(path)) return {};
  assertOwnerOnly(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CliError(`${path} is not valid JSON`, "config_invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError(`${path} must hold a JSON object`, "config_invalid");
  }
  return parsed as Partial<CliConfig>;
}

export interface ConfigInputs {
  flags: Partial<CliConfig>;
  env?: NodeJS.ProcessEnv;
  file?: Partial<CliConfig>;
}

function pick<T>(values: (T | undefined | null)[]): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

// precedence is flag, environment, file, built-in default, in that order
export function resolveConfig(inputs: ConfigInputs): CliConfig {
  const env = inputs.env ?? {};
  const file = inputs.file ?? {};
  const flags = inputs.flags;
  const apiUrl =
    pick([
      flags.apiUrl,
      env.AGENTSOUK_API_URL,
      file.apiUrl,
      DEFAULT_CONFIG.apiUrl,
    ]) ?? DEFAULT_CONFIG.apiUrl;
  if (!/^https?:\/\//.test(apiUrl)) {
    throw new CliError(`api url must start with http or https: ${apiUrl}`, "config_invalid");
  }
  const chainId = Number(
    pick([flags.chainId, env.AGENTSOUK_CHAIN_ID, file.chainId, DEFAULT_CONFIG.chainId]),
  );
  if (!Number.isSafeInteger(chainId) || chainId < 1) {
    throw new CliError(`chain id must be a positive integer`, "config_invalid");
  }
  const rail = pick([flags.defaultRail, file.defaultRail, DEFAULT_CONFIG.defaultRail]) as Rail;
  if (!["direct", "jobs", "vault", "x402", "all"].includes(rail)) {
    throw new CliError(`unknown rail: ${rail}`, "config_invalid");
  }
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    rpcUrl: pick([flags.rpcUrl, env.AGENTSOUK_RPC_URL, file.rpcUrl, DEFAULT_CONFIG.rpcUrl]) ?? DEFAULT_CONFIG.rpcUrl,
    chainId,
    defaultWallet: pick([flags.defaultWallet, env.AGENTSOUK_WALLET, file.defaultWallet, null]) ?? null,
    defaultRail: rail,
  };
}
