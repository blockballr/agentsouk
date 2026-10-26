// files a vault build adds to an export. kept apart from the normal runtime so a
// job or direct seller never gets a vault card, a vault runner or an SDK copy.

import fs from "node:fs";

export interface VaultFile {
  path: string;
  content: string;
}

export function vaultCardSkill(category: string) {
  return {
    id: "vault-execution",
    name: "Trade a funded vault hire",
    description: `Runs this agent's ${category} strategy inside a HireVault hire. The buyer funds the hire, the deposit stays in the contract, the agent acts only inside the floor, drawdown and slippage bounds set at open, and the buyer withdraws whatever is left.`,
    tags: [category, "vault", "execution", "hire"],
    examples: ["Run this agent inside a funded HireVault hire"],
    inputModes: ["text/plain", "application/json"],
    outputModes: ["text/plain", "application/json"],
  };
}

// the card and A2A endpoint only. the trading loop is vault.mjs, so the endpoint
// never implies a per-call answer and never advertises x402.
export function vaultServerSource(category: string, origin: string): string {
  return `// standalone card and A2A endpoint for a vault agent.
import http from "node:http";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const file = fs.existsSync(new URL("./blueprint.json", import.meta.url)) ? "./blueprint.json" : "./manifest.json";
const meta = JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
const ORIGIN = (process.env.PUBLIC_ORIGIN || "${origin}").replace(/\\/+$/, "");

function wallet() {
  try {
    return privateKeyToAccount(process.env.AGENT_PRIVATE_KEY).address;
  } catch {
    return undefined;
  }
}

function card() {
  return {
    name: meta.name,
    description: meta.description,
    version: "1.0.0",
    url: ORIGIN + "/a2a",
    protocolVersion: "0.3.0",
    provider: { organization: "Built on Agent Souk", url: ORIGIN },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [{
      id: "vault-execution",
      name: "Trade a funded vault hire",
      description: "Runs this agent's ${category} strategy inside a HireVault hire. The buyer funds the hire, the deposit stays in the contract, the agent acts only inside the floor, drawdown and slippage bounds set at open, and the buyer withdraws whatever is left.",
      tags: ["${category}", "vault", "execution", "hire"],
      examples: ["Run this agent inside a funded HireVault hire"],
      inputModes: ["text/plain", "application/json"],
      outputModes: ["text/plain", "application/json"]
    }],
    supportedInterfaces: [{ url: ORIGIN + "/a2a", transport: "JSONRPC" }],
    agentWallet: wallet(),
    x402Support: false
  };
}

const VAULT_ONLY = meta.name + " acts only through a funded HireVault hire on BNB Chain. The buyer opens the hire, names this agent's wallet and the venue, and the contract holds the deposit inside the floor, drawdown and slippage bounds set at open. This endpoint sells no per-call work and takes no x402 payment.";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && (url.pathname === "/.well-known/agent-card.json" || url.pathname === "/agent-card.json")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(card()));
    return;
  }
  if (req.method === "GET" && url.pathname === "/health") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, agent: meta.name, wallet: wallet() ?? null, mode: "vault" }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/a2a") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
      return;
    }
    const id = parsed?.id ?? null;
    const taskId = randomUUID();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      jsonrpc: "2.0", id,
      result: { task: { id: taskId, contextId: taskId, kind: "task", status: { state: "completed", timestamp: new Date().toISOString(), message: { role: "agent", kind: "message", messageId: randomUUID(), parts: [{ kind: "text", text: VAULT_ONLY }] } }, artifacts: [{ parts: [{ kind: "data", data: { capability: "${category}", status: "ok", hire: "vault", readOnly: true } }] }] } },
    }));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log("vault agent listening on :" + port));
`;
}

// one pass over the open hires that name the agent's wallet. dry run unless
// VAULT_EXECUTE=1, so a fresh export never sends a trade by accident.
export function vaultRunnerSource(chainId: number): string {
  return `import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { runVaultAgent } from "@agentsouk/vault-sdk";
import { strategy } from "./strategy.mjs";

const chainId = Number(process.env.CHAIN_ID || "${chainId}");
const chain = chainId === 97 ? bscTestnet : bsc;
const key = process.env.AGENT_PRIVATE_KEY;
if (!key) {
  console.error("AGENT_PRIVATE_KEY is required");
  process.exit(1);
}
const account = privateKeyToAccount(key);
const transport = http(process.env.RPC_URL || undefined, { timeout: 30_000 });
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });

const reports = await runVaultAgent({
  client,
  wallet,
  chainId,
  vault: process.env.VAULT_ADDRESS || undefined,
  strategy,
  dryRun: process.env.VAULT_EXECUTE !== "1",
});

console.log(JSON.stringify({ agent: account.address, dryRun: process.env.VAULT_EXECUTE !== "1", reports }, null, 2));
`;
}

// the strategy is the builder's edge. this default restores a 50/50 weight when
// drift leaves the band, sized from the contract's own valuation, with minOut set
// so a trade that would breach the floor reverts instead of succeeding.
export function vaultStrategySource(): string {
  return `// the edge lives here. this default rebalances to equal weight when drift
// leaves REBALANCE_BAND_BPS (default 500, or 5%) of the hire's value.
import { toValue0, fromValue0, minOutToKeepFloor } from "@agentsouk/vault-sdk";

const BPS = 10_000n;

export function strategy({ config, hire, value, floor }) {
  if (value <= floor) return { action: "skip", reason: "at the floor" };

  const valueA = toValue0(hire.balanceA, config.tokenA, config, hire.refPriceX96);
  const valueB = toValue0(hire.balanceB, config.tokenB, config, hire.refPriceX96);
  const total = valueA + valueB;
  if (total === 0n) return { action: "skip", reason: "nothing liquid" };

  const bandBps = BigInt(process.env.REBALANCE_BAND_BPS || "500");
  const target = total / 2n;
  const drift = valueA > target ? valueA - target : target - valueA;
  if (drift * BPS < total * bandBps) return { action: "skip", reason: "inside the band" };

  if (valueA > target) {
    const amountIn = fromValue0(valueA - target, config.tokenA, config, hire.refPriceX96);
    if (amountIn <= 0n) return { action: "skip", reason: "trim rounds to zero" };
    return {
      action: "trade",
      tokenIn: config.tokenA,
      amountIn,
      minOut: minOutToKeepFloor(hire, config, config.tokenA, amountIn),
      note: "trim the heavier side back to equal weight",
    };
  }

  const amountIn = fromValue0(target - valueA, config.tokenB, config, hire.refPriceX96);
  if (amountIn <= 0n) return { action: "skip", reason: "add rounds to zero" };
  return {
    action: "trade",
    tokenIn: config.tokenB,
    amountIn,
    minOut: minOutToKeepFloor(hire, config, config.tokenB, amountIn),
    note: "add to the lighter side back to equal weight",
  };
}
`;
}

export function vaultPackageJson(slug: string): string {
  return JSON.stringify(
    {
      name: slug,
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        build: "echo no build step",
        start: "node server.mjs",
        run: "node vault.mjs",
        "run:dry": "VAULT_EXECUTE=0 node vault.mjs",
        dev: "node --watch server.mjs",
      },
      dependencies: { viem: "^2.55.16", "@agentsouk/vault-sdk": "^0.1.0" },
      engines: { node: ">=20" },
    },
    null,
    2,
  ) + "\n";
}

export function vaultReadme(name: string): string {
  return `# ${name}

Exported from Agent Souk as a vault agent.

This agent sells no per-call answer. A buyer opens a HireVault hire naming this agent's wallet, the deposit stays in the contract, and the agent trades inside the bounds set at open.

## Run the card

\`\`\`sh
npm install
AGENT_PRIVATE_KEY=0x... PUBLIC_ORIGIN=https://your-host npm start
\`\`\`

The card is served at \`/.well-known/agent-card.json\` and A2A at \`/a2a\`. The card carries one skill, \`vault-execution\`, and \`x402Support: false\`.

## Run the strategy

\`\`\`sh
AGENT_PRIVATE_KEY=0x... npm run run:dry
\`\`\`

\`vault.mjs\` reads every open hire that names this wallet, asks \`strategy.mjs\` once per hire, simulates the trade against the contract, and only then sends it. It is a dry run unless \`VAULT_EXECUTE=1\`. One trade per hire per pass; call it from cron or a block watcher.

\`strategy.mjs\` is the edge. The default restores equal weight when drift leaves \`REBALANCE_BAND_BPS\` (default 500). Replace it with your own decision, and size with \`minOutToKeepFloor\` so a trade that would breach the floor reverts on chain.

The agent depends on the published \`@agentsouk/vault-sdk\` package, installed from npm.
`;
}

export function vaultEnvExample(): string {
  return "PORT=3000\nPUBLIC_ORIGIN=\nRPC_URL=\nAGENT_PRIVATE_KEY=\nVAULT_ADDRESS=\nVAULT_EXECUTE=0\nREBALANCE_BAND_BPS=500\n";
}
