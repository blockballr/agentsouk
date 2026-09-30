import { NextRequest, NextResponse } from "next/server";
import { settleSandbox, settleProd } from "@/lib/facilitator";
import { resolveFacilitatorMode } from "@/lib/facilitator-mode";
import { SettleRequest } from "@/lib/x402";
import { createHireTask } from "@/lib/tasks";
import { fundJob, persistJob } from "@/lib/jobs";

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

  const agent = body.agent ?? {
    chainId: 56,
    tokenId: "0",
    name: "Unknown agent",
  };

  const budgetUsd = typeof body.amountUsd === "number" && body.amountUsd > 0
    ? body.amountUsd
    : DEFAULT_BUDGET_USD;

  const mode = resolveFacilitatorMode(process.env.FACILITATOR_MODE);

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