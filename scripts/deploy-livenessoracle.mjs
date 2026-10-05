// Deploy the LivenessOracle to BSC testnet: the on-chain record of what a probe
// observed about an agent, keyed to its ERC-8004 token id, with reachability and
// capability kept apart.
//
// Run: DEPLOYER_PRIVATE_KEY=0x... node scripts/deploy-livenessoracle.mjs
// Nothing here holds funds; the only cost is the deploy gas.

import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const CHAIN = bscTestnet;
const RPC = process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com";

// the ERC-8004 identity registry on chain 97, the same one the marketplace reads
const REGISTRY = "0x8004a818bfb912233c491871b3d84c89a494bd9e";

const ARTIFACT = new URL("../contracts/out/LivenessOracle.sol/LivenessOracle.json", import.meta.url);

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
  console.error("contracts/out/LivenessOracle.sol/LivenessOracle.json is missing. Run: forge build");
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
console.log(`registry   : ${REGISTRY}`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`gas balance: ${balance} wei`);
if (balance === 0n) {
  console.error("\nThe deployer has no testnet BNB, so the deploy will fail.");
  console.error("Fund it from https://www.bnbchain.org/en/testnetFaucet and retry.");
  process.exit(1);
}

console.log("\ndeploying LivenessOracle...");
const hash = await walletClient.deployContract({
  abi,
  bytecode,
  account,
  chain: CHAIN,
  args: [REGISTRY],
});
console.log(`tx         : ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
if (!receipt.contractAddress) {
  console.error("no contract address in the receipt");
  process.exit(1);
}

const gasUsed = receipt.gasUsed;
const effective = receipt.effectiveGasPrice ?? 0n;
console.log(`deployed   : ${receipt.contractAddress}`);
console.log(`gas used   : ${gasUsed} (${formatUnits(gasUsed * effective, 18)} tBNB)`);

const recorded = await publicClient.readContract({
  address: receipt.contractAddress,
  abi,
  functionName: "registry",
});
console.log(`registry   : ${recorded} (read back from the contract)`);
if (recorded.toLowerCase() !== REGISTRY.toLowerCase()) {
  console.error("registry mismatch after deploy");
  process.exit(1);
}
console.log("\nLivenessOracle is live on chain 97. Nothing holds funds; verdicts are the only state.");
