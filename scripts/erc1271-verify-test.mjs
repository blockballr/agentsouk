// ERC-1271 verify-branch test for src/lib/erc1271.ts against a mocked JSON-RPC
// endpoint (mocked contract responses, since no real smart wallet is available
// in this environment). Run: node scripts/erc1271-verify-test.mjs
//
// What this CAN test: verdict policy (magic value, wrong value, revert, EOA,
// RPC failure), ERC-6492 unwrapping, and the exact calldata sent on-chain.
// What it CANNOT test without a real smart wallet: Coinbase Smart Wallet
// semantics (WebAuthn wrapper, ("Coinbase Smart Wallet","1") domain),
// undeployed-account ERC-6492 deployless validation, and end-to-end
// settlement (the deployed token itself has no ERC-1271-consuming path —
// see .superpowers/smart-wallet-audit.md). The facilitator glue
// (SMART_WALLET_VERIFY gating, settleProd fail-closed gate) imports
// "server-only" and is covered by review, not by this script.
import { createServer } from "node:http";
import { encodeAbiParameters, hashTypedData, getAddress } from "viem";
import {
  verifySmartWalletSignature,
  isErc6492Signature,
  unwrapErc6492Signature,
} from "../src/lib/erc1271.ts";
import { EIP3009_TYPES, eip3009Domain } from "../src/lib/x402.ts";

const MAGIC = "0x1626ba7e";
const CONTRACT_WALLET = getAddress(`0x${"a".repeat(39)}1`);
const EOA_ADDR = getAddress(`0x${"b".repeat(39)}2`);
const REVERT_ADDR = getAddress(`0x${"c".repeat(39)}3`);
const VALID_HASH = hashTypedData({
  domain: eip3009Domain({
    scheme: "exact",
    network: "eip155:56",
    amount: "1",
    asset: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    payTo: EOA_ADDR,
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" },
  }),
  types: EIP3009_TYPES,
  primaryType: "TransferWithAuthorization",
  message: {
    from: CONTRACT_WALLET,
    to: EOA_ADDR,
    value: 1n,
    validAfter: 0n,
    validBefore: 9999999999n,
    nonce: `0x${"11".repeat(32)}`,
  },
});
const INVALID_HASH = `0x${"22".repeat(32)}`;

let lastUnderlyingSig = null;

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body);
    const batch = Array.isArray(parsed);
    const requests = batch ? parsed : [parsed];
    const responses = requests.map((rpc) => {
      const reply = (payload) => ({ jsonrpc: "2.0", id: rpc.id, ...payload });
      if (rpc.method === "eth_getCode") {
        const addr = (rpc.params[0].address ?? rpc.params[0]).toLowerCase();
        const code =
          addr === CONTRACT_WALLET.toLowerCase() || addr === REVERT_ADDR.toLowerCase()
            ? "0x6080604052"
            : "0x";
        return reply({ result: code });
      }
      if (rpc.method === "eth_call") {
                const to = (rpc.params[0].to ?? "").toLowerCase();
        if (to === REVERT_ADDR.toLowerCase()) {
          return reply({ error: { code: -32000, message: "execution reverted" } });
        }
        // decode isValidSignature(bytes32,bytes): selector | hash | 0x40 | len | bytes
        const data = (rpc.params[0].data ?? "0x").slice(2);
        if (data.length < 200) return reply({ result: "0x" });
        const hash = `0x${data.slice(8, 72)}`;
        const len = Number(BigInt(`0x${data.slice(136, 200)}`));
        lastUnderlyingSig = `0x${data.slice(200, 200 + len * 2)}`;
        const result =
          hash.toLowerCase() === VALID_HASH.toLowerCase()
            ? `0x${MAGIC.slice(2)}${"0".repeat(56)}`
            : `0x${"0".repeat(64)}`;
        return reply({ result });
      }
      return reply({ error: { code: -32601, message: "method not found" } });
    });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(batch ? responses : responses[0]));
  });
});

function wrapErc6492(signature, contractAddr, initCodeHex) {
  // ERC-6492 wire format: abi.encode(contract, initCode, signature) || magic
  return (
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }, { type: "bytes" }],
      [contractAddr, `0x${initCodeHex.replace(/^0x/, "")}`, signature],
    ) + "6492649264926492649264926492649264926492649264926492649264926492"
  );
}

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}`);
  if (!cond) failures++;
}

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const rpcUrl = `http://127.0.0.1:${server.address().port}`;

// unit: ERC-6492 detection + unwrapping
check(
  "isErc6492Signature detects wrapper",
  isErc6492Signature(wrapErc6492("0xdeadbeef", CONTRACT_WALLET, "0x1234")) &&
    !isErc6492Signature("0xdeadbeef"),
);
check(
  "unwrapErc6492Signature round trip",
  unwrapErc6492Signature(wrapErc6492("0xdeadbeef", CONTRACT_WALLET, "0x1234")) === "0xdeadbeef" &&
    unwrapErc6492Signature(wrapErc6492(`0x${"ab".repeat(65)}`, CONTRACT_WALLET, "0x")) ===
      `0x${"ab".repeat(65)}`,
);
check(
  "unwrapErc6492Signature fails closed on truncated wrapper",
  unwrapErc6492Signature(wrapErc6492("0x", CONTRACT_WALLET, "0x")) === "0x",
);

// verdict policy
let v = await verifySmartWalletSignature({
  from: CONTRACT_WALLET,
  signature: wrapErc6492("0xdeadbeef", CONTRACT_WALLET, "0x1234"),
  hash: VALID_HASH,
  rpcUrl,
});
check("6492-wrapped signature verifies and unwraps to the underlying bytes", v.valid === true);
check("mock received the unwrapped signature, not the wrapper", lastUnderlyingSig === "0xdeadbeef");

v = await verifySmartWalletSignature({
  from: CONTRACT_WALLET,
  signature: "0xabcdef",
  hash: VALID_HASH,
  rpcUrl,
});
check("plain 1271 signature verifies on magic value", v.valid === true);

v = await verifySmartWalletSignature({
  from: CONTRACT_WALLET,
  signature: "0xabcdef",
  hash: INVALID_HASH,
  rpcUrl,
});
check(
  "wrong magic value rejects (fail closed)",
  v.valid === false && v.isContract === true,
);

v = await verifySmartWalletSignature({
  from: REVERT_ADDR,
  signature: "0xabcdef",
  hash: VALID_HASH,
  rpcUrl,
});
check("reverting isValidSignature rejects (fail closed)", v.valid === false);

v = await verifySmartWalletSignature({
  from: EOA_ADDR,
  signature: "0xabcdef",
  hash: VALID_HASH,
  rpcUrl,
});
check(
  "EOA signer rejects as not-a-contract",
  v.valid === false && v.isContract === false,
);

v = await verifySmartWalletSignature({
  from: CONTRACT_WALLET,
  signature: "0xabcdef",
  hash: VALID_HASH,
  rpcUrl: "http://127.0.0.1:9",
});
check("RPC failure rejects (fail closed)", v.valid === false);

server.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
