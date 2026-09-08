// PHASE 1 evidence: probe the live BSC USDC for the bytes-variant
// transferWithAuthorization (ERC-1271 capable) vs the vrs variant.
import { createPublicClient, http, encodeFunctionData, decodeErrorResult } from "viem";
import { bsc } from "viem/chains";

const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const client = createPublicClient({ chain: bsc, transport: http("https://bsc-dataseed.binance.org") });

const authArgs = {
  from: "0x000000000000000000000000000000000000dEaD",
  to: "0x000000000000000000000000000000000000dEaD",
  value: 1n,
  validAfter: 0n,      // expired on purpose: expect "FiatTokenV2: authorization is expired"
  validBefore: 1n,     // ^ if the revert is a FiatToken require, the function is live
  nonce: "0x" + "00".repeat(32),
};

const abiBytes = [{
  name: "transferWithAuthorization", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    { name: "signature", type: "bytes" },
  ], outputs: [],
}];

const abiVrs = [{
  name: "transferWithAuthorization", type: "function", stateMutability: "nonpayable",
  inputs: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" },
  ], outputs: [],
}];

const ifaceAbi = [
  { name: "getImplementation", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "version", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "authorizationState", type: "function", stateMutability: "view",
    inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }],
    outputs: [{ type: "bool" }] },
];

async function probe(label, to, abi, fn, args) {
  try {
    const data = encodeFunctionData({ abi, functionName: fn, args });
    await client.call({ to, data });
    console.log(`${label}: no revert (unexpected)`);
  } catch (e) {
    const walk = e;
    let reason = walk.message?.slice(0, 160) ?? String(e);
    if (walk.details) reason = walk.details;
    try { reason = decodeErrorResult({ abi: [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }], data: walk.data }).args[0]; } catch {}
    console.log(`${label}: reverted with => ${reason}`);
  }
}

const impl = "0xba5fe23f8a3a24bed3236f05f2fcf35fd0bf0b5c";

await probe("getImplementation (impl, plain call)", impl, ifaceAbi, "getImplementation", []);
await probe("version (impl, plain call)", impl, ifaceAbi, "version", []);
await probe("authorizationState (proxy)", USDC, ifaceAbi, "authorizationState",
  ["0x000000000000000000000000000000000000dEaD", "0x" + "00".repeat(32)]);
await probe("transferWithAuthorization BYTES variant (proxy, dummy/expired)", USDC, abiBytes,
  "transferWithAuthorization", [...Object.values(authArgs), "0x"]);
await probe("transferWithAuthorization VRS variant (proxy, dummy/expired)", USDC, abiVrs,
  "transferWithAuthorization", [...Object.values(authArgs), 27, "0x" + "00".repeat(32), "0x" + "00".repeat(32)]);
