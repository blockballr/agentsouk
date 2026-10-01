import { NextRequest, NextResponse } from "next/server";
import { settleSandbox, settleProd } from "@/lib/facilitator";
import { resolveFacilitatorMode } from "@/lib/facilitator-mode";
import { SettleRequest } from "@/lib/x402";
import { createHireTask } from "@/lib/tasks";
import { fundJob, persistJob } from "@/lib/jobs";
import { fetchAgentDetail } from "@/lib/scanner";
import { loadDelisted } from "@/lib/delist-store";
import { isAgentOwner, normalizeAddr } from "@/lib/boost-auth";
import { isTeamWallet, isVerifierPayment } from "@/lib/team-wallets";
import { targetChainId } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT_BUDGET_USD = 2;

async function afterSettlement(
  result: {
    success: boolean;
    paymentId?: string;
    error?: string;
    details?: { client?: string; payTo?: string };
  },
  agent: { chainId: number; tokenId: string; name: string },
  body: SettleRequest,
  budgetUsd: number,
) {
  if (!result.success || !result.paymentId) return result;
  const client = result.details?.client ?? body.paymentPayload?.payload?.authorization?.from ?? "";
  const provider = result.details?.payTo ?? body.paymentRequirements?.payTo ?? "";
  const task = createHireTask({
    paymentId: result.paymentId,
    chainId: agent.chainId,
    tokenId: agent.tokenId,
    agentName: agent.name,
  });
  // The fund leg is the point of this request, so its durable write is awaited
  // like submit and complete: a floating write lets a later deliver on another
  // instance miss the job it was just told exists.
  const job = await persistJob(
    fundJob({
      paymentId: result.paymentId,
      client,
      provider,
      description: `Hire ${agent.name}`,
      chainId: agent.chainId,
      tokenId: agent.tokenId,
      agentName: agent.name,
      budgetUsd,
    }),
  );
  return { ...result, taskId: task.id, jobId: job.id, jobStatus: job.status };
}

interface Refusal {
  error: string;
  ownAgent?: true;
  offMarket?: true;
}

// how long the settlement waits for the registry before giving the buyer an answer
const REGISTRY_READ_MS = 6000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// a real settlement is bound to the agent it names. The label and the payee both come from the
// caller, so without this any transfer could be recorded as a hire of someone else's agent, and
// the refusals at the terms step could be skipped by never asking for terms.
// A check is the marketplace's own probe, never counted as a hire, so it may reach an agent
// that is off the market or run by its owner
async function hireRefusal(
  agent: { chainId: number; tokenId: string; name: string },
  payer: string,
  payee: string,
  isCheck: boolean,
): Promise<Refusal | null> {
  const detail = await fetchAgentDetail(agent.chainId, agent.tokenId, REGISTRY_READ_MS).catch(() => null);
  // our own probe is not held up by a slow registry: an agent must not be recorded as failing
  // its check because the registry was late
  if (!detail) return isCheck ? null : { error: "This agent could not be read from the registry, so no payment was taken. Please try again." };
  // the receipt carries the registry's name for the agent, not whatever the caller called it
  agent.name = detail.name;
  const wallet = detail.agent_wallet ?? detail.owner_address;
  if (!wallet || normalizeAddr(wallet) !== normalizeAddr(payee)) {
    return { error: `This payment does not go to ${detail.name}, so it is not a hire of it.` };
  }
  if (isCheck) return null;
  if (isAgentOwner(payer, detail)) {
    return { ownAgent: true, error: `${detail.name} is your own agent, so this wallet cannot hire it. Use Re-check now on your profile to test it.` };
  }
  if (agent.chainId === targetChainId()) {
    const offMarket = await loadDelisted().catch(() => new Set<string>());
    if (offMarket.has(String(detail.token_id))) {
      return { offMarket: true, error: `${detail.name} is off the market, so it is not taking new hires.` };
    }
  }
  return null;
}

// FACILITATOR_MODE=prod relays the buyer's EIP-3009 authorization on-chain from a relay
// wallet (RELAY_PRIVATE_KEY, capped at 5 of the settlement asset). b402 routes through the live Binance x402 API (B402_CLIENT_ID + B402_ACCESS_TOKEN); sandbox verifies the signature and records a local receipt.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | (SettleRequest & {
        agent?: { chainId: number; tokenId: string; name: string; symbol?: string };
        amountUsd?: number;
      })
    | null;

  if (!body?.paymentPayload || !body?.paymentRequirements) {
    return NextResponse.json(
      { success: false, error: "paymentPayload and paymentRequirements required" },
      { status: 400 },
    );
  }

  // the label is the caller's, so its parts are made the types the checks below compare
  const label = typeof body.agent === "object" && body.agent !== null ? body.agent : null;
  const rawTokenId: unknown = label?.tokenId;
  const agent = label
    ? {
        ...label,
        chainId: Number(label.chainId),
        tokenId: typeof rawTokenId === "string" || typeof rawTokenId === "number" ? String(rawTokenId) : "",
        name: typeof label.name === "string" ? label.name : "",
      }
    : { chainId: 56, tokenId: "0", name: "Unknown agent" };
  // a token id is a number in the registry. Anything else could steer the registry read to a
  // different agent than the one the label names
  if (!Number.isSafeInteger(agent.chainId) || agent.chainId < 1 || !/^\d{1,78}$/.test(agent.tokenId)) {
    return NextResponse.json({ success: false, error: "agent must name a chain id and a token id" }, { status: 400 });
  }

  // the terms step refuses an owner's hire of their own agent, but only for a caller that
  // named itself; here the payer is the signature's own, so a payment back to it stops
  const from = body.paymentPayload.payload?.authorization?.from;
  const payer = typeof from === "string" ? from : "";
  const payee = typeof body.paymentRequirements.payTo === "string" ? body.paymentRequirements.payTo : "";
  // a probe is the marketplace's own: its id alone is the caller's to choose, so it also has
  // to be paid from one of our wallets
  const isCheck = isVerifierPayment(body.paymentId) && isTeamWallet(payer);
  if (!isCheck && payer && payee && payer.toLowerCase() === payee.toLowerCase()) {
    return NextResponse.json(
      { success: false, refused: true, ownAgent: true, error: "This payment would go back to the wallet that signed it, so it is not a hire." },
      { status: 409 },
    );
  }

  const budgetUsd = typeof body.amountUsd === "number" && body.amountUsd > 0
    ? body.amountUsd
    : DEFAULT_BUDGET_USD;

  const mode = resolveFacilitatorMode(process.env.FACILITATOR_MODE);

  // sandbox moves no funds and counts for nothing, so only a real settlement is held to this.
  // It has to say which agent it hires and name both wallets as plain addresses: the checks
  // above and below read those, and anything looser could be read differently by the relay
  if (mode !== "sandbox") {
    if (!label) {
      return NextResponse.json({ success: false, error: "agent required: the chain id and token id being hired" }, { status: 400 });
    }
    if (!ADDRESS.test(payer) || !ADDRESS.test(payee)) {
      return NextResponse.json({ success: false, error: "the payer and the payee must be addresses" }, { status: 400 });
    }
    const refusal = await hireRefusal(agent, payer, payee, isCheck);
    // refused marks the sentence as ours, so the site shows it as it is
    if (refusal) return NextResponse.json({ success: false, refused: true, ...refusal }, { status: 409 });
  }

  switch (mode) {
    case "prod": {
      const result = await settleProd(body, {
        agent: { chainId: agent.chainId, tokenId: agent.tokenId, name: agent.name },
      });
      const wrapped = await afterSettlement(result, agent, body, budgetUsd);
      return NextResponse.json(wrapped, { status: wrapped.success ? 200 : 402 });
    }

    case "b402": {
      const result = await settleB402(body, agent);
      const wrapped = await afterSettlement(result, agent, body, budgetUsd);
      return NextResponse.json(wrapped, { status: wrapped.success ? 200 : 402 });
    }

    case "sandbox": {
      const result = await settleSandbox(body, {
        agent: { chainId: agent.chainId, tokenId: agent.tokenId, name: agent.name },
      });
      const wrapped = await afterSettlement(result, agent, body, budgetUsd);
      return NextResponse.json(wrapped, { status: wrapped.success ? 200 : 402 });
    }
  }
}

async function settleB402(
  body: SettleRequest,
  agent: { chainId: number; tokenId: string; name: string; symbol?: string },
) {
  const clientId = process.env.B402_CLIENT_ID;
  const accessToken = process.env.B402_ACCESS_TOKEN;
  if (!clientId || !accessToken) {
    return {
      success: false,
      paymentId: "",
      error: "b402 mode requires B402_CLIENT_ID and B402_ACCESS_TOKEN env vars",
    };
  }

  try {
    const verify = await fetch("https://papi.binance.com/papi/v2/b402/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-B402-CLIENT-ID": clientId,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        paymentPayload: body.paymentPayload,
        paymentRequirements: body.paymentRequirements,
      }),
    });
    const verifyBody = await verify.json().catch(() => ({}));
    if (!verify.ok || !verifyBody?.data?.valid) {
      return {
        success: false,
        paymentId: "",
        error: `B402 verify failed (${verify.status})`,
      };
    }

    const settle = await fetch("https://papi.binance.com/papi/v2/b402/settle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-B402-CLIENT-ID": clientId,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        paymentPayload: body.paymentPayload,
        paymentRequirements: body.paymentRequirements,
      }),
    });
    const settleBody = await settle.json().catch(() => ({}));
    if (!settle.ok) {
      return { success: false, paymentId: "", error: `B402 settle failed (${settle.status})` };
    }

    return {
      success: true,
      paymentId: body.paymentId ?? "",
      txHash: settleBody?.data?.txHash,
      details: {
        agentId: agent.tokenId,
        agentName: agent.name,
        client: body.paymentPayload.payload.authorization.from,
        payTo: body.paymentRequirements.payTo,
        amount: body.paymentRequirements.amount,
        // b402 records no receipt, so this only echoes the caller's own label back
        symbol: agent.symbol ?? "",
        verified: true,
        mode: "b402",
      },
    };
  } catch (e) {
    return { success: false, paymentId: "", error: (e as Error).message };
  }
}