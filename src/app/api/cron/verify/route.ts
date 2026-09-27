import { NextRequest, NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { randomBytes } from "node:crypto";
import { targetChainId } from "@/lib/types";
import { unreachableEndpointVerdict } from "@/lib/verifications";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The chain this deployment settles on, so the candidate filter below matches this chain's agents.
const CHAIN_ID = targetChainId();
const AMOUNT_USD = 2;
const VERIFY_LIMIT = Math.max(1, Math.min(50, Number(process.env.VERIFY_LIMIT ?? 10) || 10));
const A2A_TASK = "report your status in one sentence";
const GATED_RE = /gates direct calls behind its own x402/i;
const BUDGET_MS = 4 * 60 * 1000;

// The verifier signs its own EIP-3009 authorizations, so it needs a funded buyer key.
const ANVIL_TEST_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001";
const RELAY_KEY = process.env.RELAY_PRIVATE_KEY as `0x${string}` | undefined;

const wallet = privateKeyToAccount(RELAY_KEY ?? ANVIL_TEST_KEY);

function baseUrl(): string {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.BASE_URL ?? "http://localhost:3000";
}

const startedAt = Date.now();
const outOfTime = () => Date.now() - startedAt > BUDGET_MS;

const JSON_HEADERS = { "Content-Type": "application/json" };

async function fetchJson(url: string, opts: RequestInit = {}, timeoutMs = 30000): Promise<{
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

async function settleHire(cand: { chainId: number; tokenId: string; name: string }) {
  const reqRes = await fetchJson(`${baseUrl()}/api/x402/requirements`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      chainId: cand.chainId,
      tokenId: cand.tokenId,
      amountUsd: AMOUNT_USD,
      client: wallet.address,
    }),
  });
  const pr = reqRes.body?.data?.paymentRequirements as {
    asset: string;
    payTo: string;
    amount: string;
    extra: { name: string; version: string };
    [k: string]: unknown;
  } | undefined;
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
      agent: { chainId: cand.chainId, tokenId: cand.tokenId, name: cand.name, symbol: "USDC" },
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

async function classify(cand: { chainId: number; tokenId: string; name: string; category: string }) {
  const detailRes = await fetchJson(`${baseUrl()}/api/agents/${cand.chainId}/${cand.tokenId}`, {}, 45000);
  if (detailRes.status !== 200 || !detailRes.body?.data) {
    return { status: "unreachable" as const, detail: "registry detail unavailable" };
  }
  const detail = detailRes.body.data as {
    mcp_server?: string | null;
    a2a_endpoint?: string | null;
  };
  if (!detail.mcp_server && !detail.a2a_endpoint) {
    return { status: "unreachable" as const, detail: "no callable endpoint registered" };
  }

  const hire = await settleHire(cand);
  if (!hire.ok || !hire.paymentId) return { status: "dead" as const, detail: hire.detail };

  const cap = await deliverJson(hire.paymentId);
  if (cap.status === 402 || cap.body?.success === false) {
    const err = cap.body?.error ?? `HTTP ${cap.status}`;
    const unreachable = unreachableEndpointVerdict(err);
    if (unreachable) return unreachable;
    if (GATED_RE.test(String(err))) return { status: "gated" as const, detail: String(err) };
    return { status: "dead" as const, detail: `deliver failed: ${err}` };
  }
  const d = cap.body?.data;
  if (!d?.ok) return { status: "dead" as const, detail: "capabilities not ok" };

  if (d.protocol === "mcp") {
    const tools = d.tools ?? [];
    if (!tools.length) return { status: "dead" as const, detail: "no tools" };
    return { status: "delivered" as const, detail: `${tools.length} tools`, deliverable: JSON.stringify(tools) };
  }

  const send = await deliverJson(hire.paymentId, { task: A2A_TASK });
  if (send.status === 402 || send.body?.success === false) {
    const err = send.body?.error ?? `HTTP ${send.status}`;
    const unreachable = unreachableEndpointVerdict(err);
    if (unreachable) return unreachable;
    if (GATED_RE.test(String(err))) return { status: "gated" as const, detail: String(err) };
    return { status: "dead" as const, detail: `message/send failed: ${err}` };
  }
  const sd = send.body?.data;
  if (sd?.ok && sd.text) {
    return { status: "delivered" as const, detail: sd.text.slice(0, 300), deliverable: sd.text };
  }
  return { status: "dead" as const, detail: "a2a send not ok" };
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  // fails closed: an unset secret must refuse, because this route spends real money on every candidate
  if (!cronSecret) {
    return NextResponse.json({ error: "verification is not configured" }, { status: 503 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // refuse rather than fall back: an unfunded or public test key produces verdicts that only look real
  if (!RELAY_KEY) {
    return NextResponse.json(
      { success: false, error: "verifier requires RELAY_PRIVATE_KEY: it signs the authorization, so the buyer must be funded" },
      { status: 500 },
    );
  }

  try {
    const snapshotRes = await fetchJson(`${baseUrl()}/api/agents?limit=200`, {}, 45000);
    const agents = (snapshotRes.body?.items ?? []) as { token_id: number; name: string; category?: string; chain_id?: number }[];
    const candidates = agents
      .filter((a) => (a.chain_id ?? CHAIN_ID) === CHAIN_ID)
      .sort((a, b) => (b as any).average_score ?? 0 - ((a as any).average_score ?? 0))
      .slice(0, VERIFY_LIMIT)
      .map((a) => ({
        chainId: CHAIN_ID,
        tokenId: String(a.token_id),
        name: a.name,
        category: a.category ?? "general",
      }));

    const { upsertVerification } = await import("@/lib/verifications-store");
    const results: { tokenId: string; name: string; status: string; responseMs: number; detail?: string }[] = [];

    for (const cand of candidates) {
      if (outOfTime()) break;
      const t0 = Date.now();
      try {
        const verdict = await classify(cand);
        const ms = Date.now() - t0;
        await upsertVerification(cand.tokenId, cand.name, cand.category, verdict.status, ms, undefined, verdict.detail);
        results.push({ tokenId: cand.tokenId, name: cand.name, status: verdict.status, responseMs: ms, detail: verdict.detail });
      } catch (e) {
        const ms = Date.now() - t0;
        const detail = `sweep error: ${(e as Error).message}`;
        await upsertVerification(cand.tokenId, cand.name, cand.category, "dead", ms, undefined, detail);
        results.push({ tokenId: cand.tokenId, name: cand.name, status: "dead", responseMs: ms, detail });
      }
    }

    const tally = { delivered: 0, gated: 0, dead: 0, unreachable: 0 };
    for (const r of results) tally[r.status as keyof typeof tally] += 1;

    return NextResponse.json({
      success: true,
      verified: results.length,
      budget: `${Math.round((Date.now() - startedAt) / 1000)}s`,
      tally,
      results,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
