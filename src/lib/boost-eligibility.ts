// boost eligibility mirrors the public list-your-agent checklist
// only agents that pass every hard gate may buy a boost

import type { AgentDetail, Verification } from "./types";

export interface BoostCheck {
  key: "endpoint" | "x402" | "delivered" | "deliverable" | "active";
  label: string;
  ok: boolean;
  detail?: string;
}

export interface BoostEligibility {
  eligible: boolean;
  checks: BoostCheck[];
  missing: string[];
}

export function evaluateBoostEligibility(input: {
  detail: AgentDetail | null | undefined;
  verification?: Verification | null;
}): BoostEligibility {
  const d = input.detail;
  const v = input.verification ?? null;
  const checks: BoostCheck[] = [];

  checks.push({
    key: "active",
    label: "Active registration",
    ok: Boolean(d?.is_active !== false),
    detail: d ? undefined : "agent not found",
  });

  const endpoint = Boolean(d?.mcp_server || d?.a2a_endpoint);
  checks.push({
    key: "endpoint",
    label: "Reachable endpoint (MCP or A2A)",
    ok: endpoint,
    detail: endpoint ? undefined : "no MCP server or A2A endpoint registered",
  });

  checks.push({
    key: "x402",
    label: "Accepts x402",
    ok: Boolean(d?.x402_supported),
    detail: d?.x402_supported ? undefined : "x402Support is not set on the registration",
  });

  const delivered = v?.status === "delivered";
  checks.push({
    key: "delivered",
    label: "Verifier status delivered",
    ok: delivered,
    detail: delivered
      ? undefined
      : v
        ? `verifier last reported ${v.status}`
        : "not shopper-verified yet (nightly verifier or manual probe)",
  });

  const qualityOk = !v?.quality || v.quality.grade !== "poor";
  checks.push({
    key: "deliverable",
    label: "Deliverable not graded poor",
    ok: delivered && qualityOk,
    detail: qualityOk
      ? delivered
        ? undefined
        : "needs a successful delivery first"
      : `AI review graded poor: ${v?.quality?.reason ?? ""}`.trim(),
  });

  const missing = checks.filter((c) => !c.ok).map((c) => c.label);
  return { eligible: missing.length === 0, checks, missing };
}
