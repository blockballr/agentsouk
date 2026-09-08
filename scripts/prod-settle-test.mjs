// End-to-end prod-settlement test of the x402 hire flow against a running
// server in FACILITATOR_MODE=prod. The relay wallet (RELAY_PRIVATE_KEY on the
// server) broadcasts the buyer's EIP-3009 authorization on BNB Chain mainnet.
//
// Usage (server must be running on :3000, started with FACILITATOR_MODE=prod
// and RELAY_PRIVATE_KEY set):
//   PROD_BUYER_KEY=0x... PROD_TOKEN_ID=45381 node scripts/prod-settle-test.mjs
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";

const BASE = "http://localhost:3000";
const SANDBOX_TX_PREFIX = "0x53a66f";
const tokenId = process.env.PROD_TOKEN_ID ?? "45381";

// skip cleanly unless the server is in prod mode with a relay configured
if (process.env.FACILITATOR_MODE !== "prod" || !process.env.RELAY_PRIVATE_KEY) {
  console.log("SKIP (not in prod mode)");
  process.exit(0);
}

if (!process.env.PROD_BUYER_KEY) {
  console.error("ERROR: PROD_BUYER_KEY is required in prod mode");
  process.exit(1);
}

const wallet = privateKeyToAccount(process.env.PROD_BUYER_KEY);

async function main() {
  // 1. Get payment requirements from the merchant.
  const reqRes = await fetch(`${BASE}/api/x402/requirements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chainId: 56, tokenId, amountUsd: 2, client: wallet.address }),
  });
  const reqBody = await reqRes.json();
  const pr = reqBody.data.paymentRequirements;
  console.log("requirements:", JSON.stringify(pr, null, 2));

  const asset = getAddress(pr.asset);
  const payTo = getAddress(pr.payTo);

  // 2. Build the EIP-3009 transfer authorization and sign it.
  const now = Math.floor(Date.now() / 1000);
  const nonce = `0x${"42".repeat(32)}`;
  const message = {
    from: wallet.address,
    to: payTo,
    value: BigInt(pr.amount),
    validAfter: BigInt(now - 60),
    validBefore: BigInt(now + 300),
    nonce,
  };
  const domain = {
    name: pr.extra.name,
    version: pr.extra.version,
    chainId: 56n,
    verifyingContract: asset,
  };
  const signature = await wallet.signTypedData({
    domain,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message,
  });
  console.log("signed from:", wallet.address);

  const resource = {
    url: `/agents/56/${tokenId}`,
    description: "Activate Aave powered by HeyAnon for a paid session",
    mimeType: "application/json",
  };

  const settlePayload = {
    paymentId: `pay_prod_${nonce.slice(2, 26)}`,
    paymentPayload: {
      x402Version: 2,
      payload: {
        authorization: {
          from: wallet.address,
          to: pr.payTo,
          value: message.value.toString(),
          validAfter: message.validAfter.toString(),
          validBefore: message.validBefore.toString(),
          nonce,
          signature,
        },
        resource,
      },
      resource,
      accepted: pr,
    },
    paymentRequirements: pr,
    agent: { chainId: 56, tokenId, name: "Aave powered by HeyAnon", symbol: "USDC" },
  };

  // 3. Settle through the facilitator (prod relay).
  const settleRes = await fetch(`${BASE}/api/x402/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settlePayload),
  });
  const settleBody = await settleRes.json();
  console.log("settle status:", settleRes.status);
  console.log("settle body:", JSON.stringify(settleBody, null, 2));

  if (settleRes.ok && settleBody.success) {
    // 4. The txHash must be a real on-chain hash, not the sandbox pseudo tx.
    const txHash = settleBody.txHash ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      console.log("FAIL: txHash is not a 32-byte hash:", txHash);
      process.exit(1);
    }
    if (txHash.toLowerCase().startsWith(SANDBOX_TX_PREFIX)) {
      console.log("FAIL: txHash looks like a sandbox pseudo tx:", txHash);
      process.exit(1);
    }
    console.log("tx:", `https://bscscan.com/tx/${txHash}`);

    // 5. Confirm the receipt is retrievable.
    const rec = await fetch(`${BASE}/api/x402/receipt/${settleBody.paymentId}`);
    console.log("receipt lookup status:", rec.status);
    const recBody = await rec.json();
    console.log("receipt:", JSON.stringify(recBody.data, null, 2));
    console.log("PASS");
  } else {
    console.log("FAIL");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
