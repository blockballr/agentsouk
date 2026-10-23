import { NextRequest, NextResponse } from "next/server";
import { validateCustomManifest } from "@/lib/builder/custom";
import { builderChatFromEnv } from "@/lib/builder/compose";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

const LIMIT = { table: "rl_builder_custom_compose", limit: 10, windowMs: 24 * 60 * 60 * 1000 };

const SCAFFOLD_PANCAKE_LP = `// Scaffold: PancakeSwap V3 LP rebalance
// Uses position manager 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364 (BSC mainnet)
// and 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd (testnet WBNB).
// Steps: read position -> decrease liquidity -> collect fees -> approve -> mint new position.
// Always set amount0Min/amount1Min to a slippage-protected value, never 0.
// Never use the full balance; leave gas reserve.`;

const SYSTEM = `You design on-chain execution agents for the Agent Souk marketplace on BNB Smart Chain.
The visitor describes an agent. You return a JSON object with two fields: "manifest" and "code".

"manifest" is a custom agent manifest with these fields:
- name: short name (max 40 chars)
- category: one of "wrapping", "rebalancing", "yield", "grid-trading", "health-factor"
- description: one sentence
- runtime: "node20"
- entrypoint: "server.mjs"
- endpoint: "/a2a"
- wallet: "agent"
- payment: "job" or "x402"
- deliverable: what the hirer receives
- release: what counts as delivery
- actions: array of { name, venue, contracts: string[], functions: string[], maxValueUsd: number }
- env: array of env var names needed (e.g. ["RPC_URL", "AGENT_PRIVATE_KEY"])
- healthcheck: "/health"

"code" is a complete Node.js server.mjs (ESM) that:
- imports http, fs, viem (createPublicClient, createWalletClient, http as viemHttp, parseEther, parseAbi)
- reads manifest.json from disk with try/catch
- serves GET /health returning { ok: true, agent, wallet } (wallet from AGENT_PRIVATE_KEY or null)
- serves POST /a2a that executes the described on-chain action using AGENT_PRIVATE_KEY from env
- uses bscTestnet (chain 97) when RPC_URL contains "testnet", otherwise bsc (chain 56)
- handles errors and returns JSON-RPC 2.0 responses
- uses slippage protection (never 0 min amounts)
- never uses the full token balance (leave gas reserve)
- uses the correct contract addresses (PancakeSwap V3 position manager: 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364)

Scaffold for PancakeSwap V3 LP rebalance:
${SCAFFOLD_PANCAKE_LP}

Reply with one JSON object and nothing else: no prose, no code fence.
If the request needs something impossible (custody of user funds, trading without a venue), return {"cannot": "..."} instead.`;

function checkSyntax(code: string): string | null {
  const tmp = join(tmpdir(), `agent-check-${Date.now()}.mjs`);
  try {
    writeFileSync(tmp, code);
    execSync(`node --check "${tmp}"`, { timeout: 10000, stdio: "pipe" });
    return null;
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer; message?: string };
    return (err.stderr?.toString() ?? err.message ?? "syntax error").slice(0, 500);
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function validateResult(parsed: unknown): string[] {
  const errors: string[] = [];
  if (!parsed || typeof parsed !== "object") { errors.push("reply was not a JSON object"); return errors; }
  const obj = parsed as Record<string, unknown>;
  if ("cannot" in obj) return errors; // handled separately
  if (typeof obj.code !== "string" || !obj.code.trim()) errors.push("code must be a non-empty string");
  const check = validateCustomManifest(obj.manifest);
  if (!check.ok) errors.push(...check.errors.map((e) => `manifest: ${e}`));
  if (typeof obj.code === "string") {
    const syn = checkSyntax(obj.code);
    if (syn) errors.push(`syntax: ${syn}`);
  }
  return errors;
}

// POST /api/builder/custom/compose  { prompt }
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { prompt?: unknown } | null;
  if (typeof body?.prompt !== "string" || body.prompt.trim().length < 10) {
    return json({ success: false, error: "prompt must be at least 10 characters" }, 400);
  }
  const prompt = body.prompt.trim().slice(0, 600);

  const chat = builderChatFromEnv();
  if (!chat) {
    return json({ success: false, error: "the builder's model could not be reached" }, 503);
  }

  try {
    const verdict = await enforceRateLimit(LIMIT, { keys: [`ip:${clientIpFrom(req.headers)}`] });
    if (!verdict.allowed) return json({ success: false, error: "Too many requests today." }, 429);
  } catch {
    return json({ success: false, error: "The builder cannot be reached just now." }, 503);
  }

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: prompt },
  ];

  let lastErrors: string[] = [];
  const ROUNDS = 2;

  for (let round = 0; round < ROUNDS; round++) {
    let reply: string;
    try {
      reply = await chat.chat(chat.models[0], messages);
    } catch (e) {
      return json({ success: false, error: "the builder's model could not be reached" }, 503);
    }

    const start = reply.indexOf("{");
    const end = reply.lastIndexOf("}");
    if (start < 0 || end <= start) {
      lastErrors = ["the reply was not a JSON object"];
      messages.push({ role: "assistant", content: reply.slice(0, 4000) }, { role: "user", content: `That was refused:\n- ${lastErrors.join("\n- ")}\nReturn the corrected JSON object only.` });
      continue;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(reply.slice(start, end + 1)); } catch {
      lastErrors = ["the reply was not valid JSON"];
      messages.push({ role: "assistant", content: reply.slice(0, 4000) }, { role: "user", content: `That was refused:\n- ${lastErrors.join("\n- ")}\nReturn the corrected JSON object only.` });
      continue;
    }

    if (typeof parsed === "object" && parsed !== null && "cannot" in parsed) {
      const msg = (parsed as { cannot?: string }).cannot;
      return json({ success: false, reason: "declined", message: msg ?? "cannot build that" }, 422);
    }

    const errors = validateResult(parsed);
    if (errors.length === 0) {
      const obj = parsed as { manifest: unknown; code: string };
      const check = validateCustomManifest(obj.manifest);
      return json({ success: true, manifest: check.ok ? check.manifest : obj.manifest, code: obj.code }, 200);
    }

    lastErrors = errors;
    messages.push(
      { role: "assistant", content: reply.slice(0, 4000) },
      { role: "user", content: `That was refused:\n- ${errors.slice(0, 12).join("\n- ")}\nFix these issues and return the corrected JSON object only.` },
    );
  }

  return json({ success: false, error: "could not generate valid code: " + lastErrors.join("; ") }, 422);
}