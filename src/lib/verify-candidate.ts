import "server-only";

import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { randomBytes } from "node:crypto";
import { unreachableEndpointVerdict } from "@/lib/verifications";
import { upsertVerification } from "@/lib/verifications-store";
import { GATED_RE } from "@/lib/delivery";
import { requestsWalletSecret } from "@/lib/quest-eligibility";

export interface VerifyCandidate {
  chainId: number;
  tokenId: string;
  name: string;
  category: string;
}

// The scheduled sweep names the same shape SweepCandidate; one type, two names.
export type SweepCandidate = VerifyCandidate;

export interface VerifyVerdict {
  status: "delivered" | "gated" | "dead" | "unreachable";
  detail: string;
  deliverable?: string;
}

const AMOUNT_USD = 2;
const A2A_TASK = "report your status in one sentence";
const JSON_HEADERS = { "Content-Type": "application/json" };

// The verifier signs its own EIP-3009 authorizations, so it needs a funded buyer key.
const ANVIL_TEST_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
const RELAY_KEY = process.env.RELAY_PRIVATE_KEY as `0x${string}` | undefined;

const wallet = privateKeyToAccount(RELAY_KEY ?? ANVIL_TEST_KEY);

export function baseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.BASE_URL ?? "http://localhost:3000";
}

export async function fetchJson(url: string, opts: RequestInit = {}, timeoutMs = 30000): Promise<{
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    const raw = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      body = { _nonJson: raw.slice(0, 200) };
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function settleHire(cand: { chainId: number; tokenId: string; name: string }): Promise<{ ok: true; paymentId: string } | { ok: false; detail: string; gated?: true }> {
  const reqRes = await fetchJson(`${baseUrl()}/api/x402/requirements`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      chainId: cand.chainId,
      tokenId: cand.tokenId,
      amountUsd: AMOUNT_USD,
      client: wallet.address,
      // a check may run on an agent that is off the market; a buyer's hire may not
      purpose: "check",
    }),
  });
  const pr = reqRes.body?.data?.paymentRequirements as {
    asset: string;
    payTo: string;
    amount: string;
    extra: { name: string; version: string };
    [k: string]: unknown;
  } | undefined;
  // a job seller is refused a direct hire before anything is paid; it is alive, so gated
  if (reqRes.status === 409 && reqRes.body?.sellsByJob) {
    return {
      ok: false,
      gated: true,
      detail:
        "This agent gates direct calls behind its own ERC-8183 job: its card offers negotiate and notify_funded, so no direct paid hire was made.",
    };
  }
  if (reqRes.status !== 200 || !pr) {
    return { ok: false, detail: `requirements failed (${reqRes.status})` };
  }

  const asset = getAddress(pr.asset);
  const payTo = getAddress(pr.payTo);
  const now = Math.floor(Date.now() / 1000);
  const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
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
    chainId: BigInt(cand.chainId),
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

  const resource = {
    url: `/agents/${cand.chainId}/${cand.tokenId}`,
    description: `Hire ${cand.name} for a paid session`,
    mimeType: "application/json",
  };

  const settleRes = await fetchJson(`${baseUrl()}/api/x402/settle`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      paymentId: `verify_${nonce.slice(2, 14)}`,
      paymentPayload: {
        x402Version: 2,
        payload: {
          authorization: { from: wallet.address, to: pr.payTo, value: message.value.toString(), validAfter: message.validAfter.toString(), validBefore: message.validBefore.toString(), nonce, signature },
          resource,
        },
        resource,
        accepted: pr,
      },
      paymentRequirements: pr,
      agent: { chainId: cand.chainId, tokenId: cand.tokenId, name: cand.name },
    }),
  });
  if (!(settleRes.status === 200 && settleRes.body?.success)) {
    return { ok: false, detail: `settle failed (${settleRes.status})` };
  }
  return { ok: true, paymentId: settleRes.body.paymentId as string };
}

async function deliverJson(paymentId: string, extra: Record<string, unknown> = {}) {
  return fetchJson(`${baseUrl()}/api/x402/deliver`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ paymentId, ...extra }),
  }, 60000);
}

export const SECRET_REQUEST_NOTE = "asked for a wallet secret instead of answering";

// a reply is a delivery unless it asks the buyer for a private key or seed phrase
// a prompt answer of that kind is still no result, and must never read as a working agent
// a reply that only promises never to ask for one is left alone, since this verdict can delist
export function gradeA2aReply(text: string): VerifyVerdict {
  if (requestsWalletSecret(text)) return { status: "dead", detail: `${SECRET_REQUEST_NOTE}: ${text.slice(0, 240)}` };
  return { status: "delivered", detail: text.slice(0, 300), deliverable: text };
}

// One paid probe: settle a hire as the relay buyer, run the agent, grade what
// comes back. Every verdict costs one hire plus gas, so callers must bound who
// they probe rather than sweeping freely.
export async function verifyCandidate(cand: VerifyCandidate): Promise<VerifyVerdict> {
  const detailRes = await fetchJson(`${baseUrl()}/api/agents/${cand.chainId}/${cand.tokenId}`, {}, 45000);
  if (detailRes.status !== 200 || !detailRes.body?.data) {
    return { status: "unreachable", detail: "registry detail unavailable" };
  }
  const detail = detailRes.body.data as {
    mcp_server?: string | null;
    a2a_endpoint?: string | null;
  };
  if (!detail.mcp_server && !detail.a2a_endpoint) {
    return { status: "unreachable", detail: "no callable endpoint registered" };
  }

  const hire = await settleHire(cand);
  if (!hire.ok) return { status: hire.gated ? "gated" : "dead", detail: hire.detail };

  const cap = await deliverJson(hire.paymentId);
  if (cap.status === 402 || cap.body?.success === false) {
    const err = cap.body?.error ?? `HTTP ${cap.status}`;
    const unreachable = unreachableEndpointVerdict(err);
    if (unreachable) return unreachable;
    if (GATED_RE.test(String(err))) return { status: "gated", detail: String(err) };
    return { status: "dead", detail: `deliver failed: ${err}` };
  }
  const d = cap.body?.data;
  if (!d?.ok) return { status: "dead", detail: "capabilities not ok" };

  if (d.protocol === "mcp") {
    const tools = d.tools ?? [];
    if (!tools.length) return { status: "dead", detail: "no tools" };
    return { status: "delivered", detail: `${tools.length} tools`, deliverable: JSON.stringify(tools) };
  }

  const send = await deliverJson(hire.paymentId, { task: A2A_TASK });
  if (send.status === 402 || send.body?.success === false) {
    const err = send.body?.error ?? `HTTP ${send.status}`;
    const unreachable = unreachableEndpointVerdict(err);
    if (unreachable) return unreachable;
    if (GATED_RE.test(String(err))) return { status: "gated", detail: String(err) };
    return { status: "dead", detail: `message/send failed: ${err}` };
  }
  const sd = send.body?.data;
  if (sd?.ok && sd.text) return gradeA2aReply(sd.text);
  return { status: "dead", detail: "a2a send not ok" };
}

// Probe one token and persist the verdict, for callers that sweep a single
// listing rather than the scheduled batch. Returns whether the row landed.
export async function verifyAndRecord(cand: VerifyCandidate): Promise<VerifyVerdict & { persisted: boolean }> {
  const started = Date.now();
  const verdict = await verifyCandidate(cand);
  const persisted = await upsertVerification(
    cand.tokenId,
    cand.name,
    cand.category,
    verdict.status,
    Date.now() - started,
    undefined,
    verdict.detail,
  );
  return { ...verdict, persisted };
}
