// The live smoke test for HireVault on chain 97, against the real deployed vault:
// mint testnet USDT, approve the vault exactly the deposit, open a hire naming an
// agent, the agent trades the deposit inside the stored floor, the buyer withdraws
// everything. Every step prints its tx and the state it left behind.
//
// Run: node scripts/smoke-hirevault.mjs
// Keys come from .env.local: RELAY_PRIVATE_KEY is the buyer, PROD_BUYER_KEY is the agent.

import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, formatEther } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const CHAIN = bscTestnet;
const RPC = process.env.BSC_TESTNET_RPC ?? "https://data-seed-prebsc-2-s2.binance.org:8545";

const VAULT = "0xc742e51f3fe3875a3335700a7d692f40dc8e60b8";
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd"; // TestUSD, the vault's tokenB
const DEPOSIT = parseUnits("0.10", 18);
const FEE = 500;
const SLIPPAGE = 1000; // the buyer's widest allowance, so the smoke cannot fail on slippage

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

const erc20Abi = [
  { name: "mint", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];
const vaultAbi = [
  { name: "open", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "agent", type: "address" }, { name: "token", type: "address" }, { name: "amount", type: "uint256" },
    { name: "expiry", type: "uint64" }, { name: "maxSlippageBps", type: "uint16" }, { name: "fee", type: "uint24" }], outputs: [{ type: "uint256" }] },
  { name: "trade", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "id", type: "uint256" }, { name: "tokenIn", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { name: "hireCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "hire", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
    { name: "buyer", type: "address" }, { name: "agent", type: "address" }, { name: "expiry", type: "uint64" },
    { name: "maxSlippageBps", type: "uint16" }, { name: "open", type: "bool" }, { name: "balanceA", type: "uint256" },
    { name: "balanceB", type: "uint256" }, { name: "refPriceX96", type: "uint160" }, { name: "fee", type: "uint24" }, { name: "depositInToken0", type: "uint256" }] },
];

async function send(wallet, label, tx) {
  const hash = await wallet.writeContract(tx);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  const gas = formatUnits(receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n), 18);
  console.log(`  ${label}: ${hash}`);
  console.log(`    status ${receipt.status}, gas ${receipt.gasUsed} (${Number(gas).toFixed(5)} tBNB)`);
  if (receipt.status !== "success") throw new Error(`${label} reverted on chain`);
  return receipt;
}

function showHire(id) {
  return publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "hire", args: [id] }).then((h) => {
    console.log(`    hire ${id}: open=${h.open} balanceA=${formatUnits(h.balanceA, 18)} WBNB, balanceB=${formatUnits(h.balanceB, 18)} USDT`);
    return h;
  });
}

console.log(`buyer : ${buyer.address}`);
console.log(`agent : ${agent.address}`);
console.log(`vault : ${VAULT}`);
console.log(`fund  : swap 0.02 tBNB into testnet USDT on the vault's own pool, spend 0.10 in the hire`);

// the vault's tokenB is Binance's testnet USDT (0x3376...), which nobody mints:
// it is bought. Wrap tBNB, approve the router, swap WBNB to USDT on the fee-500 pool.
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const ROUTER = "0x1b81D678ffb9C0263b24A97847620C99d213eB14";
const wbnbAbi = [
  { name: "deposit", type: "function", stateMutability: "payable", inputs: [], outputs: [] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];
const routerAbi = [
  { name: "exactInputSingle", type: "function", stateMutability: "payable", inputs: [{
    name: "params", type: "tuple", components: [
      { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" },
      { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" }, { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" }] }], outputs: [{ type: "uint256" }] },
];

const wrapHash = await buyerWallet.writeContract({
  address: WBNB, abi: wbnbAbi, functionName: "deposit", value: parseUnits("0.02", 18),
});
const wrapReceipt = await publicClient.waitForTransactionReceipt({ hash: wrapHash, confirmations: 1 });
console.log(`  wrap: ${wrapHash} (status ${wrapReceipt.status})`);

await send(buyerWallet, "approve the router for the funding swap", {
  address: WBNB, abi: wbnbAbi, functionName: "approve", args: [ROUTER, parseUnits("0.02", 18)],
});
await send(buyerWallet, "swap WBNB to USDT on the fee-500 pool", {
  address: ROUTER, abi: routerAbi, functionName: "exactInputSingle", args: [{
    tokenIn: WBNB, tokenOut: USDT, fee: 500, recipient: buyer.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300), amountIn: parseUnits("0.02", 18),
    amountOutMinimum: parseUnits("0.15", 18), sqrtPriceLimitX96: 0n }],
});

const usdtBefore = await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
console.log(`  buyer USDT before: ${formatUnits(usdtBefore, 18)}`);

await send(buyerWallet, "approve the vault exactly the deposit", {
  address: USDT, abi: erc20Abi, functionName: "approve", args: [VAULT, DEPOSIT],
});

const id = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "hireCount" });
await send(buyerWallet, "open the hire, agent named, expiry 2 hours", {
  address: VAULT, abi: vaultAbi, functionName: "open",
  args: [agent.address, USDT, DEPOSIT, BigInt(Math.floor(Date.now() / 1000) + 7200), SLIPPAGE, FEE],
});
const hireId = id + 1n;
await showHire(hireId);

const allowanceAfterOpen = await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [VAULT] });
console.log(`  vault USDT held: ${formatUnits(allowanceAfterOpen, 18)}`);

const out = await publicClient.simulateContract({
  address: VAULT, abi: vaultAbi, functionName: "trade", args: [hireId, USDT, DEPOSIT, 0n],
  account: agent.address,
});
console.log(`  trade simulates: ${formatUnits(out.result, 18)} WBNB out`);
await send(agentWallet, "the named agent trades the deposit inside the floor", {
  address: VAULT, abi: vaultAbi, functionName: "trade", args: [hireId, USDT, DEPOSIT, 0n],
});
await showHire(hireId);

const vaultUsdt = await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [VAULT] });
const vaultWbnbBefore = await publicClient.readContract({ address: VAULT, abi: erc20Abi, functionName: "balanceOf", args: [VAULT] });
console.log(`  vault holds ${formatUnits(vaultWbnbBefore, 18)} WBNB, ${formatUnits(vaultUsdt, 18)} USDT`);

const buyerWbnbBefore = await publicClient.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
await send(buyerWallet, "the buyer revokes: withdraw everything", {
  address: VAULT, abi: vaultAbi, functionName: "withdraw", args: [hireId],
});
await showHire(hireId);

const wbnb = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const buyerWbnb = await publicClient.readContract({ address: wbnb, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
console.log(`  buyer WBNB after: ${formatUnits(buyerWbnb, 18)}`);
console.log("\nsmoke complete: open, trade inside the stored floor, and the revoke all landed on chain.");
