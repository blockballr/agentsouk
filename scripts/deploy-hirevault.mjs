// Deploy the hire vault to BSC testnet: the contract a buyer funds for a trading agent, which
// may only swap WBNB and USDT on PancakeSwap v3 and can never move the deposit out.
// Testnet only until the vault has been audited.
// Build first with: forge build
// Run: DEPLOYER_PRIVATE_KEY=0x... node scripts/deploy-hirevault.mjs

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatUnits, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const CHAIN = bscTestnet;
const RPC = process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com";
const ARTIFACT = new URL("../contracts/out/HireVault.sol/HireVault.json", import.meta.url);

// PancakeSwap v3 on chain 97, and the two tokens its pools trade
const ROUTER = "0x1b81D678ffb9C0263b24A97847620C99d213eB14";
const FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd";

// the most one deposit may hold. The testnet pools are thin, so these are small on purpose
const CAP_WBNB = parseUnits(process.env.HIRE_VAULT_CAP_WBNB ?? "1", 18);
const CAP_USDT = parseUnits(process.env.HIRE_VAULT_CAP_USDT ?? "20", 18);

// the share of a deposit the hire may never fall below, in basis points. Half, so a
// bad agent's bleed stops at 50 percent rather than zero.
const RETAINED_BPS = Number(process.env.HIRE_VAULT_RETAINED_BPS ?? "5000");

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
  artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
} catch {
  console.error("contracts/out/HireVault.sol/HireVault.json is missing. Run: forge build");
  process.exit(1);
}
const abi = artifact.abi;
const bytecode = artifact.bytecode.object;

const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });

console.log(`chain      : ${CHAIN.id} (${CHAIN.name})`);
console.log(`rpc        : ${RPC}`);
console.log(`deployer   : ${account.address}`);
console.log(`caps       : ${formatUnits(CAP_WBNB, 18)} WBNB, ${formatUnits(CAP_USDT, 18)} USDT per deposit`);
console.log(`drawdown   : a hire may never fall below ${RETAINED_BPS / 100}% of its deposit at open price`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`gas balance: ${balance} wei`);
if (balance === 0n) {
  console.error("\nThe deployer has no testnet BNB, so the deploy will fail.");
  console.error("Fund it from https://www.bnbchain.org/en/testnetFaucet and retry.");
  process.exit(1);
}

console.log("\ndeploying HireVault...");
const hash = await walletClient.deployContract({
  abi,
  bytecode,
  account,
  chain: CHAIN,
  args: [ROUTER, FACTORY, WBNB, USDT, CAP_WBNB, CAP_USDT, RETAINED_BPS],
});
console.log(`tx         : ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
if (!receipt.contractAddress) {
  console.error("no contract address in the receipt");
  process.exit(1);
}
const address = receipt.contractAddress;
console.log(`address    : ${address}`);
console.log(`gas used   : ${receipt.gasUsed}`);
console.log(`block      : ${receipt.blockNumber}`);

// read the settings back off the chain rather than trusting the constructor
const [router, factory, tokenA, tokenB, capA, capB] = await Promise.all(
  ["router", "factory", "tokenA", "tokenB", "capA", "capB"].map((functionName) => publicClient.readContract({ address, abi, functionName })),
);
console.log("\non chain:");
console.log(`  router  : ${router}`);
console.log(`  factory : ${factory}`);
console.log(`  tokenA  : ${tokenA} (WBNB), cap ${formatUnits(capA, 18)}`);
console.log(`  tokenB  : ${tokenB} (USDT), cap ${formatUnits(capB, 18)}`);

console.log("\nwire this into the deployment env (Vercel):");
console.log(`  HIRE_VAULT_ADDRESS=${address}`);
console.log(`\nexplorer: https://testnet.bscscan.com/address/${address}`);
