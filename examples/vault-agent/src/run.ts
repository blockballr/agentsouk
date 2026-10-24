import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { runVaultAgent, vaultAddressFor } from "@agentsouk/vault-sdk";
import { targetWeight } from "./strategy.js";

const chainId = Number(process.env.CHAIN_ID ?? 56);
const chain = chainId === 97 ? bscTestnet : bsc;
const rpcUrl = process.env.RPC_URL || chain.rpcUrls.default.http[0];

const key = process.env.AGENT_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  throw new Error("set AGENT_PRIVATE_KEY to the agent wallet's key");
}

const dryRun = process.env.DRY_RUN !== "0";
const account = privateKeyToAccount(key as `0x${string}`);
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
const vault = vaultAddressFor(chainId, process.env.VAULT_ADDRESS);

console.log(
  JSON.stringify({
    agent: account.address,
    chainId,
    vault,
    mode: dryRun ? "dry" : "execute",
  }),
);

// one pass over the open hires. scheduling is the host's job: a cron, a block
// watcher, or a loop of your own. a pass never sends two trades for one hire.
const reports = await runVaultAgent({
  client,
  wallet,
  chainId,
  vault,
  strategy: targetWeight,
  dryRun,
  onReport: (report) => console.log(JSON.stringify(report)),
});

const traded = reports.filter((r) => r.status === "traded").length;
const refused = reports.filter((r) => r.status === "refused").length;
console.log(JSON.stringify({ hires: reports.length, traded, refused }));

// a refusal is a decision the contract would not accept, or a simulation that
// reverted. exit non-zero so a scheduler surfaces it instead of burying it
if (refused > 0) process.exitCode = 1;
