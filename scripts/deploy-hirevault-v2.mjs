// Deploy the hire vault to a chain of your choosing, mainnet or testnet.
//
// The testnet-only script this replaces hardcoded bscTestnet and the chain-97
// token addresses, which would have pointed a mainnet vault at contracts that
// do not exist there. Every per-chain value is named below, and the tokens are
// the only thing that differs: the v3 router and factory are the same address
// on both chains, verified by reading bytecode at each.
//
// build first with: forge build
// run: DEPLOYER_PRIVATE_KEY=0x... node scripts/deploy-hirevault-v2.mjs 56
// pass --dry-run to print the plan and spend nothing.

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatUnits, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";

const DRY = process.argv.includes("--dry-run");
const chainArg = process.argv.find((a) => /^\d+$/.test(a)) ?? "56";
const CHAINS = {
  56: {
    chain: bsc,
    rpc: process.env.BSC_MAINNET_RPC ?? "https://bsc-dataseed.bnbchain.org",
    router: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
    factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
    wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    usdt: "0x55d398326f99059fF775485246999027B3197955",
  },
  97: {
    chain: bscTestnet,
    rpc: process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com",
    router: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
    factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
    wbnb: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
    usdt: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
  },
};

const target = CHAINS[Number(chainArg)];
if (!target) {
  console.error(`unsupported chain ${chainArg}; use 56 or 97`);
  process.exit(1);
}

// caps are per deposit. the testnet values were sized for thin pools, so a
// mainnet run names its own and never silently inherits the small ones.
const capWbnb = parseUnits(process.env.HIRE_VAULT_CAP_WBNB ?? (Number(chainArg) === 56 ? "50" : "1"), 18);
const capUsdt = parseUnits(process.env.HIRE_VAULT_CAP_USDT ?? (Number(chainArg) === 56 ? "100000" : "20"), 18);
const retainedBps = Number(process.env.HIRE_VAULT_RETAINED_BPS ?? "5000");

const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!privateKey) {
  console.error("DEPLOYER_PRIVATE_KEY is not set. Nothing to do.");
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("DEPLOYER_PRIVATE_KEY must be a 32 byte hex string.");
  process.exit(1);
}

let artifact;
try {
  artifact = JSON.parse(readFileSync(new URL("../contracts/out/HireVault.sol/HireVault.json", import.meta.url), "utf8"));
} catch {
  console.error("contracts/out/HireVault.sol/HireVault.json is missing. Run: forge build");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain: target.chain, transport: http(target.rpc) });
const walletClient = createWalletClient({ account, chain: target.chain, transport: http(target.rpc) });

console.log(`chain        : ${target.chain.id} (${target.chain.name})`);
console.log(`rpc          : ${target.rpc}`);
console.log(`deployer     : ${account.address}`);
console.log(`router       : ${target.router}`);
console.log(`factory      : ${target.factory}`);
console.log(`wbnb         : ${target.wbnb}`);
console.log(`usdt         : ${target.usdt}`);
console.log(`caps         : ${formatUnits(capWbnb, 18)} WBNB, ${formatUnits(capUsdt, 18)} USDT per deposit`);
console.log(`drawdown     : a hire may never fall below ${retainedBps / 100}% of its deposit at open price`);
console.log("");

const codeAt = async (addr) => {
  const c = await publicClient.getCode({ address: addr });
  return typeof c === "string" && c.length > 2;
};
for (const [name, addr] of [["router", target.router], ["factory", target.factory], ["wbnb", target.wbnb], ["usdt", target.usdt]]) {
  if (!(await codeAt(addr))) {
    console.error(`the ${name} at ${addr} has no code on chain ${target.chain.id}, so the vault could not trade`);
    process.exit(1);
  }
}
console.log("all four constructor targets carry code on this chain");

const balance = await publicClient.getBalance({ address: account.address });
console.log(`gas balance  : ${formatUnits(balance, 18)} BNB`);
if (balance === 0n) {
  console.error("the deployer holds nothing on this chain, so the deploy would fail");
  process.exit(1);
}
if (DRY) {
  console.log("\ndry run: the plan is sound and nothing was sent");
  process.exit(0);
}

const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [target.router, target.factory, target.wbnb, target.usdt, capWbnb, capUsdt, retainedBps],
});

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`\ndeploy tx    : ${hash}`);
console.log(`vault address: ${receipt.contractAddress}`);
console.log(`block        : ${receipt.blockNumber}`);
