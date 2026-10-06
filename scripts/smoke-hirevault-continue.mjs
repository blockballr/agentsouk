// Continuation of the smoke: trade hire #1 as the named agent, then the buyer withdraws.
// The hire was opened by smoke-hirevault.mjs and holds the full deposit in USDT.

import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const CHAIN = bscTestnet;
const RPC = process.env.BSC_TESTNET_RPC ?? "https://data-seed-prebsc-2-s2.binance.org:8545";
const VAULT = "0xc742e51f3fe3875a3335700a7d692f40dc8e60b8";
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd";
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const HIRE = 1n;

function loadKey(name) {
  const m = readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(0x[0-9a-fA-F]{64})\\s*$`, "m"));
  if (!m) throw new Error(`${name} missing from .env.local`);
  return privateKeyToAccount(m[1].trim());
}
const buyer = loadKey("RELAY_PRIVATE_KEY");
const agent = loadKey("PROD_BUYER_KEY");

const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const buyerWallet = createWalletClient({ account: buyer, chain: CHAIN, transport: http(RPC) });
const agentWallet = createWalletClient({ account: agent, chain: CHAIN, transport: http(RPC) });

const vaultAbi = [
  { name: "trade", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "id", type: "uint256" }, { name: "tokenIn", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { name: "hire", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
    { type: "address" }, { type: "address" }, { type: "uint64" }, { type: "uint16" }, { type: "bool" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint160" }, { type: "uint24" }, { type: "uint256" }] },
];
const erc20Abi = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];

async function send(wallet, label, tx) {
  const hash = await wallet.writeContract(tx);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  console.log(`  ${label}: ${hash}`);
  console.log(`    status ${receipt.status}, gas ${receipt.gasUsed} (${Number(formatUnits(receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n), 18)).toFixed(5)} tBNB)`);
  if (receipt.status !== "success") throw new Error(`${label} reverted on chain`);
}

function showHire(h) {
  // positional: 0 buyer, 1 agent, 4 open, 5 balanceA (WBNB), 6 balanceB (USDT)
  console.log(`    hire ${HIRE}: open=${h[4]}, balanceA=${formatUnits(h[5], 18)} WBNB, balanceB=${formatUnits(h[6], 18)} USDT`);
}

let h = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "hire", args: [HIRE] });
console.log(`before: open=${h[4]}, balanceA=${formatUnits(h[5], 18)} WBNB, balanceB=${formatUnits(h[6], 18)} USDT`);

await send(agentWallet, "the named agent trades the full deposit inside the stored floor", {
  address: VAULT, abi: vaultAbi, functionName: "trade", args: [HIRE, USDT, h[6], 0n],
});
h = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "hire", args: [HIRE] });
showHire(h);

await send(buyerWallet, "the buyer revokes: withdraw everything", {
  address: VAULT, abi: vaultAbi, functionName: "withdraw", args: [HIRE],
});
h = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "hire", args: [HIRE] });
showHire(h);

const bW = await publicClient.readContract({ address: WBNB, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
const bU = await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
console.log(`buyer holds ${formatUnits(bW, 18)} WBNB and ${formatUnits(bU, 18)} USDT after the revoke`);
console.log("\nsmoke complete: open, execute inside the stored floor, revoke, all on the live vault.");
