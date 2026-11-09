// The CLI signs an EIP-3009 authorization and the settle route verifies it, so
// the domain, the types and the body have to match the server's copies exactly.
import { describe, expect, it } from "vitest";
import { verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EIP3009_TYPES, eip3009Domain, type PaymentRequirements } from "../src/lib/x402";
import {
  TRANSFER_TYPES,
  settleBody,
  settleErrorText,
  signTransfer,
  signableOption,
  x402ChainId,
  x402Domain,
  type RequirementsData,
} from "../packages/cli/src/marketplace/x402";

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:56",
  amount: "20000000000000000",
  asset: "0xcE24439F2D9C6a2289F741120FE202248B666666",
  payTo: "0xd7052516ae58188271c4c85FA4cD69a18C6e7F8b",
  maxTimeoutSeconds: 300,
  extra: {
    name: "United Stables",
    version: "1",
    assetTransferMethod: "eip3009",
    agentPayTo: "0x84FEDaBd1B83443Ad86796C15619494878B64180",
  },
};

const data: RequirementsData = {
  paymentRequirements: requirements,
  preview: {
    paymentId: "req_0x1111111111111111",
    options: [
      {
        index: 1,
        status: "READY_TO_SIGN",
        reasons: [],
        tokenSymbol: "U",
        amount: "0.02",
        amountUsd: 0.02,
        payTo: requirements.payTo,
        needApproveFirst: false,
        originalAccept: requirements,
      },
    ],
    resource: { url: "/agents/56/404603", description: "A paid call", mimeType: "application/json" },
  },
  agent: { chainId: 56, tokenId: "404603", name: "Souk Health Guard", image: null, symbol: "U" },
};

const account = privateKeyToAccount(`0x${"22".repeat(32)}`);

describe("the CLI and the server sign the same authorization", () => {
  it("holds the same typed-data types", () => {
    expect(TRANSFER_TYPES).toEqual(EIP3009_TYPES);
  });

  it("reads the chain and builds the same domain", () => {
    expect(x402ChainId(requirements)).toBe(56);
    expect(x402Domain(requirements)).toEqual(eip3009Domain(requirements));
  });

  it("produces a signature the server's copy verifies", async () => {
    const now = 1_800_000_000n;
    const { authorization, signature } = await signTransfer(account, requirements, now);
    expect(authorization.from).toBe(account.address);
    expect(authorization.to).toBe(requirements.payTo);
    expect(authorization.value).toBe(requirements.amount);
    expect(BigInt(authorization.validAfter)).toBe(now - 60n);
    expect(BigInt(authorization.validBefore)).toBe(now + BigInt(requirements.maxTimeoutSeconds));

    const ok = await verifyTypedData({
      address: account.address,
      domain: eip3009Domain(requirements),
      types: EIP3009_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from as `0x${string}`,
        to: authorization.to as `0x${string}`,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce as `0x${string}`,
      },
      signature,
    });
    expect(ok).toBe(true);
  });
});

describe("the settle body", () => {
  it("carries the signed authorization, the resource and the accepted terms", async () => {
    const { authorization, signature } = await signTransfer(account, requirements, 1_800_000_000n);
    const body = settleBody(data, authorization, signature);
    expect(body.paymentId).toBe("req_0x1111111111111111");
    expect(body.paymentPayload.x402Version).toBe(2);
    expect(body.paymentPayload.payload.authorization.signature).toBe(signature);
    expect(body.paymentPayload.payload.authorization.from).toBe(account.address);
    expect(body.paymentPayload.payload.resource).toEqual(data.preview.resource);
    expect(body.paymentPayload.accepted).toBe(requirements);
    expect(body.paymentRequirements).toBe(requirements);
    expect(body.agent).toEqual({ chainId: 56, tokenId: "404603", name: "Souk Health Guard", symbol: "U" });
  });
});

describe("choosing a payment option", () => {
  it("takes the first signable option", () => {
    expect(signableOption(data)).toBe(data.preview.options[0]);
  });

  it("says why when nothing can be signed", () => {
    const blocked: RequirementsData = {
      ...data,
      preview: {
        ...data.preview,
        options: [
          {
            ...data.preview.options[0],
            status: "ACTION_REQUIRED",
            reasons: ["the agent is off the market"],
          },
        ],
      },
    };
    expect(() => signableOption(blocked)).toThrow(/off the market/);
  });

  it("refuses a hire above the cap", () => {
    expect(() => signableOption(data, 0.01)).toThrow(/above the 0.01 cap/);
    expect(signableOption(data, 0.02)).toBe(data.preview.options[0]);
  });
});

describe("a settle refusal in plain English", () => {
  it("names a relay with no gas and says nothing was charged", () => {
    const raw = "The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.";
    expect(settleErrorText(raw)).toMatch(/out of BNB for gas/);
    expect(settleErrorText(raw)).toMatch(/nothing was charged/);
  });

  it("names an expired or reused authorization", () => {
    expect(settleErrorText("Authorization expired")).toMatch(/expired before it settled/);
    expect(settleErrorText("this nonce was already been used")).toMatch(/already used/);
  });

  it("keeps a short marketplace sentence", () => {
    const sentence = "This agent is off the market, so it is not taking new hires.";
    expect(settleErrorText(sentence)).toBe(sentence);
  });

  it("hides raw viem text behind a generic line", () => {
    expect(settleErrorText("Details: 0xdeadbeef viem version 2.1").length).toBeGreaterThan(0);
    expect(settleErrorText("")).toMatch(/did not settle/);
  });
});
