// End-to-end proof of the escrowed hire on chain 97 against production: ask
// for requirements, sign to the funder, settle, read the funder and the
// ledger back, deliver through the marketplace so the relay records the
// verified delivery, show the dispute window refusing an early release,
// then release through the buyer's approve and watch the agent get paid.
//
// Run: node scripts/escrow-e2e-chain97.mjs
// Cost: 2 test sUSD (mintable, worthless) plus a few thousandths of tBNB.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  keccak256,
  toBytes,
} from "viem";
import { bscTestnet } from "viem/chains";

const API = process.env.SOUK_API ?? "https://api.agentsouk.xyz";
const CHAIN_ID = 97;
const RPC = "https://data-seed-prebsc-2-s2.binance.org:8545";
const FUNDER = getAddress("0x43a17747ec36ab53a3a0bf63cec58ba5ff587e34");
const LEDGER = getAddress("0x93cd9d2e5cae8cd6c4ab8b6148f857f7f16d3dab");
const SUSD = getAddress("0x9332b1aa9b3d5826f0b9b9e1659d962d2da13a53");
const TOKEN_ID = "2162";
const AMOUNT_USD = 2;
const SANDBOX_TX_PREFIX = "0x53a66f";
const TASK =
  "Capability check from Agent Souk. Reply with one line naming what you do and the input you need to do it. No funds are attached to this message.";

function parseEnv(path) {
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    env[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = parseEnv(fileURLToPath(new URL("../.env.local", import.meta.url)));
if (!env.RELAY_PRIVATE_KEY || !env.PROD_BUYER_KEY) {
  console.error("RELAY_PRIVATE_KEY or PROD_BUYER_KEY missing from .env.local");
  process.exit(1);
}
const buyer = privateKeyToAccount(env.PROD_BUYER_KEY);
const relay = privateKeyToAccount(env.RELAY_PRIVATE_KEY);

const publicClient = createPublicClient({ chain: bscTestnet, transport: http(RPC, { timeout: 30000 }) });
const relayWallet = createWalletClient({ account: relay, chain: bscTestnet, transport: http(RPC, { timeout: 30000 }) });
const buyerWallet = createWalletClient({ account: buyer, chain: bscTestnet, transport: http(RPC, { timeout: 30000 }) });

const FUNDER_ABI = [
  {
    name: "jobOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "buyer", type: "address" },
          { name: "payTo", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "fundedAt", type: "uint64" },
          { name: "verifiedAt", type: "uint64" },
          { name: "receiptId", type: "bytes32" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "bytes32" }], outputs: [] },
  { name: "release", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "bytes32" }], outputs: [] },
  { name: "NoAccess", type: "error", inputs: [] },
  { name: "NotBuyer", type: "error", inputs: [] },
  { name: "NotFunded", type: "error", inputs: [] },
  { name: "NotPaid", type: "error", inputs: [] },
  { name: "AlreadyClosed", type: "error", inputs: [] },
  { name: "AlreadyVerified", type: "error", inputs: [] },
  { name: "DisputeOpen", type: "error", inputs: [] },
  { name: "BadCall", type: "error", inputs: [] },
];

const LEDGER_ABI = [
  {
    name: "receiptOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "receiptId", type: "bytes32" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "payTo", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "issuedAt", type: "uint64" },
      { name: "usedAt", type: "uint64" },
      { name: "consumer", type: "address" },
    ],
  },
];

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "mint", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [] },
];

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

const results = [];
async function step(name, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true, note: note ?? "" });
    console.log(`  ok   ${name}${note ? `: ${note}` : ""}`);
  } catch (e) {
    results.push({ name, ok: false, note: e.message });
    console.log(`  FAIL ${name}: ${e.message}`);
    throw e;
  }
}

console.log(`api      : ${API}`);
console.log(`buyer    : ${buyer.address}`);
console.log(`relay    : ${relay.address}`);

let agentPayTo = "";
let requirementsBody = null;
let paymentId = "";
let jobId = "";
const value = BigInt(AMOUNT_USD) * 10n ** 18n;

// a resume proves the checks that read chain and marketplace state against a
// job that is already funded, so a broken read never costs a second hire
const RESUME = process.env.E2E_RESUME ?? "";

if (RESUME) {
  paymentId = RESUME;
  jobId = keccak256(toBytes(paymentId));
  agentPayTo = getAddress("0x6d5767Ca6e48B7103F3E660A2ff78148D2Ec6Ab4");
} else {

  await step("requirements name the funder with the agent wallet beside it", async () => {
    const res = await fetch(`${API}/api/x402/requirements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainId: CHAIN_ID, tokenId: TOKEN_ID, amountUsd: AMOUNT_USD, client: buyer.address }),
    });
    const body = await res.json();
    const pr = body?.data?.paymentRequirements;
    if (!res.ok || !pr) throw new Error(`requirements failed (${res.status})`);
    if (getAddress(pr.payTo) !== FUNDER) throw new Error(`payTo ${pr.payTo} is not the funder`);
    if (!pr.extra?.agentPayTo) throw new Error("extra.agentPayTo missing");
    agentPayTo = getAddress(pr.extra.agentPayTo);
    requirementsBody = pr;
    return `payTo ${pr.payTo}, agent ${agentPayTo}`;
  });

  await step("buyer holds the sUSD and the gas", async () => {
    const sUsd = await publicClient.readContract({ address: SUSD, abi: ERC20_ABI, functionName: "balanceOf", args: [buyer.address] });
    if (sUsd < value) {
      const hash = await relayWallet.writeContract({ address: SUSD, abi: ERC20_ABI, functionName: "mint", args: [buyer.address, value - sUsd] });
      await publicClient.waitForTransactionReceipt({ hash });
    }
    let gas = await publicClient.getBalance({ address: buyer.address });
    if (gas < 5n * 10n ** 15n) {
      const hash = await relayWallet.sendTransaction({ to: buyer.address, value: 5n * 10n ** 15n });
      await publicClient.waitForTransactionReceipt({ hash });
      gas = await publicClient.getBalance({ address: buyer.address });
    }
    return `sUSD ${sUsd}, gas ${gas} wei`;
  });

  const block = await publicClient.getBlock({ blockTag: "latest" });
  const nonce = keccak256(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`);
  const message = {
    from: buyer.address,
    to: FUNDER,
    value,
    validAfter: block.timestamp - 60n,
    validBefore: block.timestamp + 300n,
    nonce,
  };
  const signature = await buyer.signTypedData({
    domain: {
      name: requirementsBody.extra.name,
      version: requirementsBody.extra.version,
      chainId: BigInt(CHAIN_ID),
      verifyingContract: getAddress(requirementsBody.asset),
    },
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  });
  paymentId = `esc${nonce.slice(2, 14)}`;
  jobId = keccak256(toBytes(paymentId));

  await step("settle relays fund() to the funder", async () => {
    const resource = { url: `/agents/${CHAIN_ID}/${TOKEN_ID}`, description: "Escrow e2e hire", mimeType: "application/json" };
    const res = await fetch(`${API}/api/x402/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentId,
        paymentPayload: {
          x402Version: 2,
          payload: {
            authorization: {
              from: buyer.address,
              to: FUNDER,
              value: message.value.toString(),
              validAfter: message.validAfter.toString(),
              validBefore: message.validBefore.toString(),
              nonce: message.nonce,
              signature,
            },
            resource,
          },
          resource,
          accepted: requirementsBody,
        },
        paymentRequirements: requirementsBody,
        agent: { chainId: CHAIN_ID, tokenId: TOKEN_ID, name: "Sluicegate", symbol: "sUSD" },
        amountUsd: AMOUNT_USD,
      }),
    });
    const body = await res.json();
    const txHash = body?.txHash ?? "";
    if (!res.ok || !body?.success) throw new Error(`settle failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash) || txHash.toLowerCase().startsWith(SANDBOX_TX_PREFIX)) {
      throw new Error(`settle returned no real tx: ${txHash}`);
    }
    const tx = await publicClient.getTransaction({ hash: txHash });
    if (getAddress(tx.to ?? "0x") !== FUNDER) throw new Error(`tx went to ${tx.to}, not the funder`);
    return `paymentId ${paymentId}, fund tx ${txHash}`;
  });
}

await step("the funder holds the job", async () => {
  const job = await publicClient.readContract({ address: FUNDER, abi: FUNDER_ABI, functionName: "jobOf", args: [jobId] });
  if (job.fundedAt === 0n) throw new Error("fundedAt is zero");
  if (job.status !== 0) throw new Error(`status ${job.status}, expected FUNDED`);
  if (getAddress(job.payTo) !== agentPayTo) throw new Error(`payTo ${job.payTo} is not the agent`);
  if (job.amount !== value) throw new Error(`amount ${job.amount}, expected ${value}`);
  if (getAddress(job.buyer) !== buyer.address) throw new Error(`buyer ${job.buyer} mismatch`);
  return `amount ${job.amount}, held since ${job.fundedAt}`;
});

await step("the ledger records the receipt", async () => {
  const r = await publicClient.readContract({ address: LEDGER, abi: LEDGER_ABI, functionName: "receiptOf", args: [jobId] });
  const [rBuyer, rPayTo, rToken, rAmount, rNonce, issuedAt] = r;
  if (issuedAt === 0n) throw new Error("issuedAt is zero");
  if (getAddress(rBuyer) !== buyer.address) throw new Error(`receipt buyer ${rBuyer} mismatch`);
  if (getAddress(rPayTo) !== agentPayTo) throw new Error(`receipt payTo ${rPayTo} is not the agent`);
  if (rAmount !== value) throw new Error(`receipt amount ${rAmount} mismatch`);
  return `issued at ${issuedAt}`;
});
await step("delivery records the verified delivery on chain", async () => {
  const res = await fetch(`${API}/api/x402/deliver`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paymentId, task: TASK }),
  });
  const body = await res.json();
  if (!res.ok || !body?.success || !body?.data?.ok) {
    throw new Error(`deliver failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  const job = await publicClient.readContract({ address: FUNDER, abi: FUNDER_ABI, functionName: "jobOf", args: [jobId] });
  if (job.verifiedAt === 0n) throw new Error("verifiedAt is still zero after delivery");
  const advance = body.data.jobAdvance ? JSON.stringify(body.data.jobAdvance) : "no job advance in response";
  return `verifiedAt ${job.verifiedAt}; ${advance}`;
});

await step("the dispute window refuses an early release", async () => {
  try {
    await publicClient.simulateContract({
      address: FUNDER,
      abi: FUNDER_ABI,
      functionName: "release",
      account: relay,
      args: [jobId],
    });
  } catch (e) {
    if (/DisputeOpen|dispute/i.test(String(e.message))) return "release reverts with DisputeOpen";
    throw e;
  }
  throw new Error("release succeeded before the window was up");
});

await step("the buyer's approve releases the money to the agent", async () => {
  const before = await publicClient.readContract({ address: SUSD, abi: ERC20_ABI, functionName: "balanceOf", args: [agentPayTo] });
  const hash = await buyerWallet.writeContract({ address: FUNDER, abi: FUNDER_ABI, functionName: "approve", args: [jobId] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`approve reverted: ${hash}`);
  const job = await publicClient.readContract({ address: FUNDER, abi: FUNDER_ABI, functionName: "jobOf", args: [jobId] });
  if (job.status !== 1) throw new Error(`status ${job.status}, expected RELEASED`);
  const after = await publicClient.readContract({ address: SUSD, abi: ERC20_ABI, functionName: "balanceOf", args: [agentPayTo] });
  const paid = after - before;
  if (paid !== value) throw new Error(`agent received ${paid}, expected ${value}`);
  return `agent paid ${paid} in tx ${hash}`;
});

console.log("\nsummary:");
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? "\nescrow loop proven end to end" : `\n${failed} step(s) failed`);
process.exit(failed === 0 ? 0 : 1);
