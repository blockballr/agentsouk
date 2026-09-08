"use client";

import { useEffect, useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import {
  EIP3009_TYPES,
  PaymentPayload,
  PaymentRequirements,
  PreviewResult,
  SettleResult,
  eip3009Domain,
  randomNonce,
} from "@/lib/x402";
import { shortAddress, formatUnits } from "@/lib/format";
import { AgentAvatar } from "./agent-avatar";

export interface HireAgent {
  chainId: number;
  tokenId: string;
  name: string;
  image: string | null;
  payTo?: string;
}

interface RequirementsResponse {
  success: boolean;
  data?: {
    paymentRequirements: PaymentRequirements;
    preview: PreviewResult;
    agent: { symbol: string };
  };
  error?: string;
}

type Step =
  | "loading"
  | "ready"
  | "signing"
  | "settling"
  | "receipt"
  | "error";

export function HireFlow({
  agent,
  onClose,
}: {
  agent: HireAgent;
  onClose: () => void;
}) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const [step, setStep] = useState<Step>("loading");
  const [requirements, setRequirements] = useState<PaymentRequirements | null>(null);
  const [symbol, setSymbol] = useState("U");
  const [receipt, setReceipt] = useState<SettleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amountUsd =
    requirements && requirements.amount
      ? formatUnits(BigInt(requirements.amount), 18)
      : "—";

  useEffect(() => {
    if (!agent) return;
    fetchRequirements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.chainId, agent.tokenId]);

  async function fetchRequirements() {
    setStep("loading");
    setError(null);
    try {
      const res = await fetch("/api/x402/requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: agent.chainId,
          tokenId: agent.tokenId,
          client: address,
        }),
      });
      const body = (await res.json()) as RequirementsResponse;
      if (!body.success || !body.data) {
        throw new Error(body.error ?? "Could not price this agent");
      }
      setRequirements(body.data.paymentRequirements);
      setSymbol(body.data.agent.symbol);
      setStep("ready");
    } catch (e) {
      setError((e as Error).message);
      setStep("error");
    }
  }

  async function pay() {
    if (!requirements || !address) return;
    setStep("signing");
    setError(null);
    try {
      const now = BigInt(Math.floor(Date.now() / 1000));
      const validBefore = now + 300n;
      const value = BigInt(requirements.amount);
      const nonce = randomNonce();

      const signature = await signTypedDataAsync({
        domain: eip3009Domain(requirements),
        types: EIP3009_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: address,
          to: requirements.payTo as `0x${string}`,
          value,
          validAfter: now,
          validBefore,
          nonce,
        },
      });

      const resource = {
        url: `/agents/${agent.chainId}/${agent.tokenId}`,
        description: `Activate ${agent.name} for a paid session`,
        mimeType: "application/json",
      };

      const payload: PaymentPayload = {
        x402Version: 2,
        payload: {
          authorization: {
            from: address,
            to: requirements.payTo,
            value: value.toString(),
            validAfter: now.toString(),
            validBefore: validBefore.toString(),
            nonce,
            signature,
          },
          resource,
        },
        resource,
        accepted: requirements,
      };

      setStep("settling");
      const res = await fetch("/api/x402/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId: `pay_${nonce.slice(2, 20)}`,
          paymentPayload: payload,
          paymentRequirements: requirements,
          agent: {
            chainId: agent.chainId,
            tokenId: agent.tokenId,
            name: agent.name,
            symbol,
          },
        }),
      });
      const result = (await res.json()) as SettleResult;
      if (!result.success) {
        throw new Error(result.error ?? "Settlement failed");
      }
      setReceipt(result);
      setStep("receipt");
    } catch (e) {
      const msg = (e as Error).message;
      setError(/user rejected|denied|reject/i.test(msg) ? "Signature rejected." : msg);
      setStep("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-50">Hire agent</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <AgentAvatar name={agent.name} image={agent.image} size={40} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-zinc-100">{agent.name}</div>
            <div className="text-xs text-zinc-500">
              {agent.payTo ? `Receives at ${shortAddress(agent.payTo)}` : "Receiving wallet on-chain"}
            </div>
          </div>
        </div>

        {step === "loading" && (
          <div className="mt-6 flex flex-col items-center gap-3 py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
            <p className="text-sm text-zinc-500">Reading payment requirements…</p>
          </div>
        )}

        {step === "ready" && (
          <>
            <div className="mt-5 space-y-2 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-sm">
              <Row label="Price" value={`${amountUsd} ${symbol}`} />
              <Row label="Network" value="BNB Smart Chain" />
              <Row label="Method" value="x402 · EIP-3009" />
              <Row label="Settlement" value="Sandbox facilitator" hint="Verify → settle" />
              <Row label="Session" value="24h · $10 spend cap" />
            </div>
            {!isConnected ? (
              <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-xs text-amber-200">
                Connect a wallet (top right) to sign the payment authorization.
              </p>
            ) : null}
            <button
              onClick={pay}
              disabled={!isConnected}
              className="mt-5 w-full rounded-xl bg-amber-400 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isConnected
                ? `Sign & pay ${amountUsd} ${symbol}`
                : "Connect wallet to continue"}
            </button>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-zinc-600">
              You sign a gasless transfer authorization for the agent&apos;s
              receiving wallet. No token custody, no approvals, funds move directly on-chain.
            </p>
          </>
        )}

        {step === "signing" && (
          <div className="mt-6 flex flex-col items-center gap-3 py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
            <p className="text-sm text-zinc-400">Approve the payment in your wallet…</p>
          </div>
        )}

        {step === "settling" && (
          <div className="mt-6 flex flex-col items-center gap-3 py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
            <p className="text-sm text-zinc-400">Verifying signature and settling…</p>
          </div>
        )}

        {step === "receipt" && receipt?.details && (
          <div className="mt-5">
            <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/15">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="m5 13 4 4L19 7" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="text-sm font-semibold text-emerald-300">Agent activated</div>
              <div className="text-xs text-emerald-200/70">
                {receipt.details.agentName} is now working for you.
              </div>
            </div>
            <div className="mt-4 space-y-2 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-sm">
              <Row label="Paid" value={`${formatUnits(BigInt(receipt.details.amount), 18)} ${receipt.details.symbol}`} />
              <Row label="To" value={shortAddress(receipt.details.payTo)} />
              <Row label="Mode" value={receipt.details.mode.toUpperCase()} />
              <Row label="Tx" value={shortAddress(receipt.txHash, 10)} mono />
            </div>
            <button
              onClick={onClose}
              className="mt-5 w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 text-sm font-medium text-zinc-200 transition hover:border-white/20"
            >
              Done
            </button>
          </div>
        )}

        {step === "error" && (
          <div className="mt-5">
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-4 text-sm text-rose-300">
              {error}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={fetchRequirements}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-zinc-300 transition hover:border-white/20"
              >
                Try again
              </button>
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-zinc-500 transition hover:border-white/20"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-right text-xs font-medium text-zinc-200 ${mono ? "font-mono" : ""}`}>
        {value}
        {hint ? <span className="ml-1 text-zinc-600">· {hint}</span> : null}
      </span>
    </div>
  );
}