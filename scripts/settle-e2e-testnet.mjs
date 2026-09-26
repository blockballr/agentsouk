// End to end settlement proof against the deployed sUSD on BSC testnet.
//
// This is the check that decides whether the hire button is real: a buyer signs
// an EIP-3009 authorization, the relay broadcasts it, and value actually moves
// on chain with a real transaction hash. It reproduces the exact nine argument
// v, r, s encoding that src/lib/facilitator.ts uses, not the standard form.
//
// Keys are read from .env.local in memory and never printed.
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatEther,
  getAddress,
  encodeFunctionData,
  parseSignature,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const SUSD = getAddress("0x9332b1aa9b3d5826f0b9b9e1659d962d2da13a53");
// the payee a real hire uses: the agent's own wallet from the registry
const AGENT_WALLET = getAddress("0xCC2abE29F43EAb530a6b5D93E3C41bc0E7622b47");

const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8").replace(/^\uFEFF/, "");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const s = line.trim();
  if (!s || s.startsWith("#") || !s.includes("=")) continue;
  const i = s.indexOf("=");
  env[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const relayKey = env.RELAY_PRIVATE_KEY;
const buyerKey = env.PROD_BUYER_KEY;
if (!relayKey || !buyerKey) {
  console.error("RELAY_PRIVATE_KEY or PROD_BUYER_KEY missing from .env.local");
  process.exit(1);
}

const relay = privateKeyToAccount(relayKey);
const buyer = privateKeyToAccount(buyerKey);

const client = createPublicClient({
  chain: bscTestnet,
  transport: http("https://data-seed-prebsc-1-s1.binance.org:8545", { timeout: 30_000 }),
});
const relayWallet = createWalletClient({ account: relay, chain: bscTestnet, transport: http("https://data-seed-prebsc-1-s1.binance.org:8545", { timeout: 30_000 }) });

// the shape facilitator.ts broadcasts
const TWA_ABI = [
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
];

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

const value = parseUnits("2", 18);
const validAfter = 0n;
const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300);
const nonce = `0x${"7a".repeat(32)}`;

console.log("token        : sUSD", SUSD);
console.log("buyer        :", buyer.address);
console.log("relay        :", relay.address);
console.log("payee        :", AGENT_WALLET, "(the agent's own wallet)");
console.log("value        : 2 sUSD");
console.log();

// the buyer needs a balance; minting is public on this test token
const mintBefore = await client.readContract({
  address: SUSD,
  abi: [
    { name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  ],
  functionName: "balanceOf",
  args: [buyer.address],
});
if (mintBefore < value) {
  const need = value - mintBefore;
  const mintHash = await relayWallet.writeContract({
    address: SUSD,
    abi: [{ name: "mint", type: "function", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [], stateMutability: "nonpayable" }],
    functionName: "mint",
    args: [buyer.address, need],
  });
  await client.waitForTransactionReceipt({ hash: mintHash, confirmations: 1 });
  console.log(`minted ${formatEther(need)} sUSD to the buyer so it can pay`);
}

// the domain is read back off the deployed contract, never assumed
const domain = await client.readContract({
  address: SUSD,
  abi: [
    {
      name: "eip712Domain",
      type: "function",
      inputs: [],
      outputs: [
        { name: "fields", type: "bytes1" },
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
        { name: "salt", type: "bytes32" },
        { name: "extensions", type: "uint256[]" },
      ],
      stateMutability: "view",
    },
  ],
  functionName: "eip712Domain",
});
console.log(`domain read off chain: name="${domain[1]}" version="${domain[2]}" chainId=${domain[3]}`);

const raw2 = await buyer.signTypedData({
  domain: { name: domain[1], version: domain[2], chainId: domain[3], verifyingContract: SUSD },
  types: TYPES,
  primaryType: "TransferWithAuthorization",
  message: { from: buyer.address, to: AGENT_WALLET, value, validAfter, validBefore, nonce },
});

// replicate facilitator.ts splitSig exactly
const s = raw2.slice(2);
const r = `0x${s.slice(0, 64)}`;
const vs = `0x${s.slice(64, 128)}`;
let vNum = parseInt(s.slice(128, 130), 16);
if (vNum < 27) vNum += 27;
const check = parseSignature(raw2);
console.log(`signature    : v=${vNum} (viem reports yParity ${check.yParity}, consistent: ${check.yParity === vNum - 27})`);
console.log();

const readBal = (who) =>
  client.readContract({
    address: SUSD,
    abi: [{ name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
    functionName: "balanceOf",
    args: [who],
  });

const [buyerBefore, payeeBefore] = await Promise.all([readBal(buyer.address), readBal(AGENT_WALLET)]);
console.log(`before: buyer ${formatEther(buyerBefore)}  payee ${formatEther(payeeBefore)}`);

const data = encodeFunctionData({
  abi: TWA_ABI,
  functionName: "transferWithAuthorization",
  args: [buyer.address, AGENT_WALLET, value, validAfter, validBefore, nonce, vNum, r, vs],
});
console.log(`calldata selector: ${data.slice(0, 10)}`);

const hash = await relayWallet.sendTransaction({ to: SUSD, data });
console.log(`\nrelay broadcast : ${hash}`);

const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
const [buyerAfter, payeeAfter, state] = await Promise.all([
  readBal(buyer.address),
  readBal(AGENT_WALLET),
  client.readContract({
    address: SUSD,
    abi: [{ name: "authorizationState", type: "function", inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" }],
    functionName: "authorizationState",
    args: [buyer.address, nonce],
  }),
]);

console.log(`status         : ${receipt.status}`);
console.log(`gas used       : ${receipt.gasUsed}`);
console.log(`block          : ${receipt.blockNumber}`);
console.log(`after : buyer ${formatEther(buyerAfter)}  payee ${formatEther(payeeAfter)}`);
console.log(`nonce spent    : ${state}`);

const moved = payeeAfter - payeeBefore === value && buyerBefore - buyerAfter === value;
console.log(`\nVALUE MOVED ON CHAIN: ${moved ? "YES" : "NO"}`);
console.log(`explorer       : https://testnet.bscscan.com/tx/${hash}`);
console.log(`relay tBNB left: ${formatEther(await client.getBalance({ address: relay.address }))}`);
