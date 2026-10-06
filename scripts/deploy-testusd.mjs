// Deploy the testnet settlement token (sUSD) to BSC testnet and print the EIP-712 domain clients sign against.
// Worthless by design, never for a chain where tokens carry value. Run: DEPLOYER_PRIVATE_KEY=0x... node scripts/deploy-testusd.mjs

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, decodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const CHAIN = bscTestnet;
const RPC = process.env.BSC_TESTNET_RPC ?? "https://data-seed-prebsc-2-s2.binance.org:8545";
const ARTIFACT = new URL("../contracts/out/TestUSD.sol/TestUSD.json", import.meta.url);

// 1,000,000 tUSD with 18 decimals. Only a test balance for the deployer; anyone
// can mint more, which is the point on testnet.
const INITIAL_SUPPLY = 1_000_000n * 10n ** 18n;

const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!privateKey) {
  console.error("DEPLOYER_PRIVATE_KEY is not set. Nothing to do.");
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("DEPLOYER_PRIVATE_KEY must be a 32 byte hex string.");
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
const abi = artifact.abi;
const bytecode = artifact.bytecode.object;

const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });

console.log(`chain      : ${CHAIN.id} (${CHAIN.name})`);
console.log(`rpc        : ${RPC}`);
console.log(`deployer   : ${account.address}`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`gas balance: ${balance} wei`);
if (balance === 0n) {
  console.error("\nThe deployer has no testnet BNB, so the deploy will fail.");
  console.error("Fund it from https://www.bnbchain.org/en/testnetFaucet and retry.");
  process.exit(1);
}

console.log("\ndeploying TestUSD...");
const hash = await walletClient.deployContract({
  abi,
  bytecode,
  account,
  chain: CHAIN,
  args: [INITIAL_SUPPLY],
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

// read the domain back off the chain rather than trusting the constructor
const [name, symbol, version, decimals, supply] = await Promise.all([
  publicClient.readContract({ address, abi, functionName: "name" }),
  publicClient.readContract({ address, abi, functionName: "symbol" }),
  publicClient.readContract({ address, abi, functionName: "version" }),
  publicClient.readContract({ address, abi, functionName: "decimals" }),
  publicClient.readContract({ address, abi, functionName: "totalSupply" }),
]);

console.log("\non chain:");
console.log(`  name         : ${name}`);
console.log(`  symbol       : ${symbol}`);
console.log(`  version      : ${version}`);
console.log(`  decimals     : ${decimals}`);
console.log(`  totalSupply  : ${supply}`);

const domain = await publicClient.readContract({ address, abi, functionName: "eip712Domain" });
console.log(`  eip712Domain : name=${domain[1]} version=${domain[2]} chainId=${domain[3]} contract=${domain[4]}`);

console.log("\nwire these into the deployment env (Vercel):");
console.log(`  FACILITATOR_MODE=prod`);
console.log(`  chain 97 asset address = ${address}`);
console.log(`  EIP-712 name = ${name}, version = ${version}, decimals = ${decimals}`);
console.log(`\nexplorer: https://testnet.bscscan.com/address/${address}`);
