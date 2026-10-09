// Deploy the EIP3009Funder to BSC testnet: the escrow that holds a settled
// hire until a buyer OK or a verified delivery past the dispute window.
//
// Run: DEPLOYER_PRIVATE_KEY=0x... RELAY_PRIVATE_KEY=0x... node scripts/deploy-eip3009funder.mjs
// Nothing here holds funds; the only cost is the deploy gas.
//
// Both constructor arguments are immutable: the relay that alone may fund,
// verify, refund, approve and release, and the dispute window every release
// waits out. DISPUTE_WINDOW_SECONDS overrides the default, decide it before
// running, because no later transaction can change it.
//
// After the deploy the relay pays the gas for every fund(), so that wallet
// needs testnet BNB too, or the first escrowed hire will fail to settle.

import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { bscTestnet, bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

// the mainnet flip decides the chain and the settle token on one env: when
// TARGET_CHAIN is 56 the deploy lands on BSC mainnet and the relay's settle
// currency is the mainnet $U, read from escrow funder's own deploy env
const TARGET = Number(process.env.TARGET_CHAIN ?? "97");
const CHAIN = TARGET === 56 ? bsc : bscTestnet;
const RPC = TARGET === 56 ? "https://bsc-dataseed.bnbchain.org" : (process.env.BSC_TESTNET_RPC ?? "https://data-seed-prebsc-2-s2.binance.org:8545");

// one hour on testnet so the whole fund, verify, release lifecycle can be
// exercised the same day; the mainnet funder is a fresh deploy with its own
// window, so nothing decided here carries over
const DISPUTE_WINDOW_SECONDS = Number(process.env.DISPUTE_WINDOW_SECONDS ?? 3600);

const ARTIFACT = new URL("../contracts/out/EIP3009Funder.sol/EIP3009Funder.json", import.meta.url);

const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!privateKey) {
  console.error("DEPLOYER_PRIVATE_KEY is not set. Nothing to do.");
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error("DEPLOYER_PRIVATE_KEY must be a 32 byte hex string.");
  process.exit(1);
}

const relayKey = process.env.RELAY_PRIVATE_KEY;
if (!relayKey) {
  console.error("RELAY_PRIVATE_KEY is not set; the relay address is derived from it.");
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(relayKey)) {
  console.error("RELAY_PRIVATE_KEY must be a 32 byte hex string.");
  process.exit(1);
}

if (!Number.isInteger(DISPUTE_WINDOW_SECONDS) || DISPUTE_WINDOW_SECONDS <= 0) {
  console.error("DISPUTE_WINDOW_SECONDS must be a positive whole number of seconds.");
  process.exit(1);
}

let artifact;
try {
  artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
} catch {
  console.error("contracts/out/EIP3009Funder.sol/EIP3009Funder.json is missing. Run: forge build");
  process.exit(1);
}
const abi = artifact.abi;
const bytecode = artifact.bytecode.object;

const account = privateKeyToAccount(privateKey);
const relay = privateKeyToAccount(relayKey).address;
const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });

console.log(`chain         : ${CHAIN.id} (${CHAIN.name})`);
console.log(`rpc           : ${RPC}`);
console.log(`deployer      : ${account.address}`);
console.log(`relay         : ${relay} (read from RELAY_PRIVATE_KEY)`);
console.log(`dispute window: ${DISPUTE_WINDOW_SECONDS} seconds (immutable)`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`gas balance   : ${balance} wei`);
if (balance === 0n) {
  console.error("\nThe deployer has no testnet BNB, so the deploy will fail.");
  console.error("Fund it from https://www.bnbchain.org/en/testnetFaucet and retry.");
  process.exit(1);
}

console.log("\ndeploying EIP3009Funder...");
const hash = await walletClient.deployContract({
  abi,
  bytecode,
  account,
  chain: CHAIN,
  args: [relay, BigInt(DISPUTE_WINDOW_SECONDS)],
});
console.log(`tx            : ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
if (!receipt.contractAddress) {
  console.error("no contract address in the receipt");
  process.exit(1);
}

const gasUsed = receipt.gasUsed;
const effective = receipt.effectiveGasPrice ?? 0n;
console.log(`deployed      : ${receipt.contractAddress}`);
console.log(`gas used      : ${gasUsed} (${formatUnits(gasUsed * effective, 18)} tBNB)`);

const recorded = await publicClient.readContract({
  address: receipt.contractAddress,
  abi,
  functionName: "relay",
});
console.log(`relay         : ${recorded} (read back from the contract)`);
if (recorded.toLowerCase() !== relay.toLowerCase()) {
  console.error("relay mismatch after deploy");
  process.exit(1);
}

const window = await publicClient.readContract({
  address: receipt.contractAddress,
  abi,
  functionName: "disputeWindow",
});
console.log(`dispute window: ${window} seconds (read back from the contract)`);
if (window !== BigInt(DISPUTE_WINDOW_SECONDS)) {
  console.error("dispute window mismatch after deploy");
  process.exit(1);
}

console.log("\nThe funder is live on chain 97. To switch the escrow on, set:");
console.log(`  ESCROW_FUNDER_ADDRESS=${receipt.contractAddress}`);
console.log("\nERC-1271 smart-wallet signatures cannot go through this funder: it holds");
console.log("the EIP-3009 authorization the token verifies, which is EOAs only.");
