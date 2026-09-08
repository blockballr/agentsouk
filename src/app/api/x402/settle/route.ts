import { NextRequest, NextResponse } from "next/server";
import { settleSandbox, settleProd } from "@/lib/facilitator";
import { SettleRequest } from "@/lib/x402";

export const dynamic = "force-dynamic";

// FACILITATOR_MODE=prod relays the buyer's EIP-3009 authorization on-chain
// from a relay wallet and requires RELAY_PRIVATE_KEY (capped at 5 USDC)
// FACILITATOR_MODE=b402 routes through the live Binance x402 API and requires
// B402_CLIENT_ID + B402_ACCESS_TOKEN
// sandbox mode verifies the EIP-3009 signature and records a local receipt, so
// the journey runs fully with no external credentials
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | (SettleRequest & {
        agent?: { chainId: number; tokenId: string; name: string; symbol: string };
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
    symbol: "USDC",
  };

  const mode = process.env.FACILITATOR_MODE ?? "sandbox";

  if (mode === "prod") {
    const result = await settleProd(body, {
      agent: {
        chainId: agent.chainId,
        tokenId: agent.tokenId,
        name: agent.name,
        symbol: agent.symbol ?? "USDC",
      },
    });
    return NextResponse.json(result, { status: result.success ? 200 : 402 });
  }

  if (mode === "b402") {
    const result = await settleB402(body, agent);
    return NextResponse.json(result, { status: result.success ? 200 : 402 });
  }

  const result = await settleSandbox(body, {
    agent: {
      chainId: agent.chainId,
      tokenId: agent.tokenId,
      name: agent.name,
      symbol: agent.symbol ?? "USDC",
    },
  });

  return NextResponse.json(
    result.success ? result : { ...result },
    { status: result.success ? 200 : 402 },
  );
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
        symbol: agent.symbol ?? "USDC",
        verified: true,
        mode: "b402",
      },
    };
  } catch (e) {
    return { success: false, paymentId: "", error: (e as Error).message };
  }
}