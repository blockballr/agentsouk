// A deliberately small settlement proof suite for the Set and Earn submission: one settlement per
// quest category, a non-default amount, and a cancelled authorization. Nothing counts toward quest progress; keys come from .env.local and are never printed.

import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  getAddress,
  encodeFunctionData,
  parseUnits,
  decodeEventLog,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const SUSD = getAddress("0x9332b1AA9B3d5826F0b9b9e1659D962d2dA13A53");
const RPC = "https://data-seed-prebsc-1-s1.binance.org:8545";
const OUT = new URL("./settlement-proofs.json", import.meta.url);

const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8").replace(/^\uFEFF/, "");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const s = line.trim();
  if (!s || s.startsWith("#") || !s.includes("=")) continue;
  const i = s.indexOf("=");
  env[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const relay = privateKeyToAccount(env.RELAY_PRIVATE_KEY);
const buyer = privateKeyToAccount(env.PROD_BUYER_KEY);

const client = createPublicClient({ chain: bscTestnet, transport: http(RPC, { timeout: 30_000 }) });
const relayWallet = createWalletClient({ account: relay, chain: bscTestnet, transport: http(RPC, { timeout: 30_000 }) });

const snapshot = JSON.parse(readFileSync(new URL("../data/agents-97.json", import.meta.url), "utf8"));
const agents = snapshot.agents;

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
const MINT_ABI = [
  { name: "mint", type: "function", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
];
const CANCEL_ABI = [
  { name: "cancelAuthorization", type: "function", inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [], stateMutability: "nonpayable" },
];
const BAL_ABI = [
  { name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
];
const STATE_ABI = [
  { name: "authorizationState", type: "function", inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [{ type: "bool" }], stateMutability: "view" },
];

const readBal = (who) =>
  client.readContract({ address: SUSD, abi: BAL_ABI, functionName: "balanceOf", args: [who] });

// the domain is read from the contract, never assumed
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
console.log(`domain from chain: name="${domain[1]}" version="${domain[2]}" chainId=${domain[3]}\n`);

async function ensureBalance(who, needed) {
  const have = await readBal(who);
  if (have >= needed) return;
  const hash = await relayWallet.writeContract({
    address: SUSD,
    abi: MINT_ABI,
    functionName: "mint",
    args: [who, needed - have],
  });
  await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  return hash;
}

function splitSig(sig) {
  const s = sig.slice(2);
  let v = parseInt(s.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { r: `0x${s.slice(0, 64)}`, vs: `0x${s.slice(64, 128)}`, v };
}

// One id per run so re-running does not replay a spent nonce, which would revert with
// EIP3009AlreadyUsed.
const RUN = randomBytes(8).toString("hex");

async function settle({ label, category, tokenId, agentName, payee, amountUsd, payer }) {
  const from = payer ?? buyer.address;
  const value = parseUnits(amountUsd, 18);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300);
  const nonce = `0x${Buffer.from(`${label}:${RUN}`).toString("hex").padEnd(64, "0").slice(0, 64)}`;

  const mintTx = await ensureBalance(from, value);

  const sig = await privateKeyToAccount(
    from === buyer.address ? env.PROD_BUYER_KEY : env.FRESH_WALLET_KEY,
  ).signTypedData({
    domain: { name: domain[1], version: domain[2], chainId: domain[3], verifyingContract: SUSD },
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: { from, to: payee, value, validAfter: 0n, validBefore, nonce },
  });
  const { r, vs, v } = splitSig(sig);

  const hash = await relayWallet.sendTransaction({
    to: SUSD,
    data: encodeFunctionData({
      abi: TWA_ABI,
      functionName: "transferWithAuthorization",
      args: [from, payee, value, 0n, validBefore, nonce, v, r, vs],
    }),
  });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });

  // verify from the receipt's own Transfer log rather than by re-reading the balance, which
  // can hit an RPC that has not caught up
  let moved = false;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SUSD.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({
        abi: [
          {
            name: "Transfer",
            type: "event",
            inputs: [
              { name: "from", type: "address", indexed: true },
              { name: "to", type: "address", indexed: true },
              { name: "value", type: "uint256", indexed: false },
            ],
          },
        ],
        data: log.data,
        topics: log.topics,
      });
      if (
        ev.eventName === "Transfer" &&
        ev.args.to.toLowerCase() === payee.toLowerCase() &&
        ev.args.from.toLowerCase() === from.toLowerCase() &&
        ev.args.value === value
      ) {
        moved = true;
      }
    } catch {
      // a log we cannot decode is not our transfer
    }
  }

  console.log(
    `${label.padEnd(30)} ${category.padEnd(15)} ${amountUsd} sUSD -> ${receipt.status === "success" && moved ? "settled" : "FAILED"}  ${hash}`,
  );

  return {
    label,
    category,
    tokenId,
    agentName,
    payee,
    payer: from,
    amountUsd,
    tx: hash,
    status: receipt.status,
    gasUsed: Number(receipt.gasUsed),
    valueMovedOnChain: moved,
    mintTx: mintTx ?? null,
    explorer: `https://testnet.bscscan.com/tx/${hash}`,
  };
}

const results = [];

// record a failure instead of aborting, so one bad step does not cost us the
// hashes from every other step
async function attempt(label, fn) {
  try {
    const entry = await fn();
    results.push(entry);
    return entry;
  } catch (e) {
    const reason = String(e.message || e).split("\n")[0].slice(0, 160);
    console.log(`${label.padEnd(30)} FAILED: ${reason}`);
    results.push({ label, error: reason });
    return null;
  }
}

// 1 to 4: one settlement per quest category, to four different agent wallets
for (const category of ["yield", "grid-trading", "rebalancing", "health-factor"]) {
  const agent = agents.find((a) => a.category === category && a.agent_wallet);
  if (!agent) {
    console.log(`skip ${category}: no agent with a registry wallet`);
    continue;
  }
  await attempt(`hire-${category}`, () =>
    settle({
      label: `hire-${category}`,
      category,
      tokenId: agent.token_id,
      agentName: agent.name,
      payee: getAddress(agent.agent_wallet),
      amountUsd: "2",
    }),
  );
}

// 5: a non default amount, proving the price is not hardcoded
const anyAgent = agents.find((a) => a.category === "yield" && a.agent_wallet);
await attempt("hire-nondefault-amount", () =>
  settle({
    label: "hire-nondefault-amount",
    category: anyAgent.category,
    tokenId: anyAgent.token_id,
    agentName: anyAgent.name,
    payee: getAddress(anyAgent.agent_wallet),
    amountUsd: "0.75",
  }),
);

// 6: cancel an unused authorization on chain, proving revocation before use
await attempt("cancel-unused-authorization", async () => {
  const nonce = `0x${Buffer.from(`cancel:${RUN}`).toString("hex").padEnd(64, "0").slice(0, 64)}`;
  const hash = await relayWallet.sendTransaction({
    to: SUSD,
    data: encodeFunctionData({
      abi: CANCEL_ABI,
      functionName: "cancelAuthorization",
      args: [buyer.address, nonce],
    }),
  });
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  const state = await client.readContract({
    address: SUSD,
    abi: STATE_ABI,
    functionName: "authorizationState",
    args: [buyer.address, nonce],
  });
  console.log(`cancel unused authorization      revoked on chain   ${state}  ${hash}`);
  return {
    label: "cancel-unused-authorization",
    category: "revocation",
    tx: hash,
    status: receipt.status,
    authorizationState: state,
    explorer: `https://testnet.bscscan.com/tx/${hash}`,
  };
});

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), token: SUSD, domain: { name: domain[1], version: domain[2], chainId: Number(domain[3]) }, results }, null, 2) + "\n", "utf8");

console.log(`\nrelay tBNB left: ${formatEther(await client.getBalance({ address: relay.address }))}`);
console.log(`wrote ${OUT.pathname.split("/").pop()}`);
