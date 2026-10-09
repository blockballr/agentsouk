// Deploy the ReceiptLedger to BSC testnet: the single-use record of a settled
// hire, keyed to its receipt id and issued only by the settlement relay.
//
// Run: DEPLOYER_PRIVATE_KEY=0x... RELAY_PRIVATE_KEY=0x... node scripts/deploy-receiptledger.mjs
// Nothing here holds funds; the only cost is the deploy gas.
//
// The issuer is the relay wallet, so the same key that broadcasts settlements
// is the only key that can publish them. It is read from RELAY_PRIVATE_KEY
// rather than typed, so the contract cannot be deployed bound to the wrong key.

import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { bscTestnet, bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const TARGET = Number(process.env.TARGET_CHAIN ?? "97");
const CHAIN = TARGET === 56 ? bsc : bscTestnet;
const RPC = TARGET === 56 ? "https://bsc-dataseed.bnbchain.org" : (process.env.BSC_TESTNET_RPC ?? "https://data-seed-prebsc-2-s2.binance.org:8545");

const ARTIFACT = new URL("../contracts/out/ReceiptLedger.sol/ReceiptLedger.json", import.meta.url);

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
  console.error("RELAY_PRIVATE_KEY is not set; the issuer address is derived from it.");
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(relayKey)) {
  console.error("RELAY_PRIVATE_KEY must be a 32 byte hex string.");
  process.exit(1);
}

let artifact;
try {
  artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
} catch {
  console.error("contracts/out/ReceiptLedger.sol/ReceiptLedger.json is missing. Run: forge build");
  process.exit(1);
}
const abi = artifact.abi;
const bytecode = artifact.bytecode.object;

const account = privateKeyToAccount(privateKey);
const issuer = privateKeyToAccount(relayKey).address;
const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });

console.log(`chain      : ${CHAIN.id} (${CHAIN.name})`);
console.log(`rpc        : ${RPC}`);
console.log(`deployer   : ${account.address}`);
console.log(`issuer     : ${issuer} (relay, read from RELAY_PRIVATE_KEY)`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`gas balance: ${balance} wei`);
if (balance === 0n) {
  console.error("\nThe deployer has no testnet BNB, so the deploy will fail.");
  console.error("Fund it from https://www.bnbchain.org/en/testnetFaucet and retry.");
  process.exit(1);
}

console.log("\ndeploying ReceiptLedger...");
const hash = await walletClient.deployContract({
  abi,
  bytecode,
  account,
  chain: CHAIN,
  args: [issuer],
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
  functionName: "issuer",
});
console.log(`issuer     : ${recorded} (read back from the contract)`);
if (recorded.toLowerCase() !== issuer.toLowerCase()) {
  console.error("issuer mismatch after deploy");
  process.exit(1);
}

console.log("\nThe ledger is live on chain 97. To switch the marketplace on, set:");
console.log(`  RECEIPT_LEDGER_ADDRESS=${receipt.contractAddress}`);
console.log("\nThe relay needs testnet BNB as well: every issue() it sends pays gas.");
