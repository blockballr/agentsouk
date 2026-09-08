// End-to-end test of the x402 hire flow against a running server.
// Generates a real EIP-3009 signature with a throwaway wallet and settles it.
//
// Usage (server must be running on :3000):
//   node scripts/settle-test.mjs
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";

const BASE = "http://localhost:3000";
const tokenId = "45381";

const wallet = privateKeyToAccount(
  "0x0000000000000000000000000000000000000000000000000000000000000001",
);

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
    paymentId: `pay_${nonce.slice(2, 20)}`,
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
    agent: { chainId: 56, tokenId, name: "Aave powered by HeyAnon", symbol: "U" },
  };

  // 3. Settle through the facilitator.
  const settleRes = await fetch(`${BASE}/api/x402/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settlePayload),
  });
  const settleBody = await settleRes.json();
  console.log("settle status:", settleRes.status);
  console.log("settle body:", JSON.stringify(settleBody, null, 2));

  if (settleRes.ok && settleBody.success) {
    // 4. Confirm the receipt is retrievable.
    const rec = await fetch(`${BASE}/api/receipts/${settleBody.paymentId}`);
    console.log("receipt lookup status:", rec.status);
    const recBody = await rec.json();
    console.log("receipt:", JSON.stringify(recBody, null, 2));
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