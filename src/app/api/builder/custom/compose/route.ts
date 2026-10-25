import { NextRequest, NextResponse } from "next/server";
import { VENUES_REGISTRY } from "@/lib/builder/venues";
import { validateCustomManifest } from "@/lib/builder/custom";
import { builderChatFromEnv } from "@/lib/builder/compose";
import { clientIpFrom, enforceRateLimit } from "@/lib/rate-limit";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// rate limit removed for development

const SCAFFOLD_PANCAKE_LP = `// Scaffold: PancakeSwap V3 LP rebalance
// Uses position manager 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364 (BSC mainnet)
// and 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd (testnet WBNB).
// Steps: read position -> decrease liquidity -> collect fees -> approve -> mint new position.
// Always set amount0Min/amount1Min to a slippage-protected value, never 0.
// Never use the full balance; leave gas reserve.`;

// Verified on-chain addresses and ABIs. The LLM MUST use only these for the
// venues listed here and must never invent or guess an address. If a venue is
// not in this registry, the LLM must not generate code for it and should return
// {"cannot": "..."} instead.

const SYSTEM = `You design on-chain execution agents for the Agent Souk marketplace on BNB Smart Chain.
The visitor describes an agent. You return a JSON object with two fields: "manifest" and "code".

"manifest" is a custom agent manifest with these fields:
- name: short name (max 40 chars)
- category: one of "rebalancing", "yield", "grid-trading", "health-factor"
- category mapping: arbitrage, cross-DEX price exploitation, and DCA count as "rebalancing"; grid bots and range orders count as "grid-trading"
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
[- format the code with 2-space indentation, one statement per line, readable in an editor]
- imports bsc and bscTestnet from 'viem/chains' (NEVER create custom chain objects, because they lack rpcUrls)
- reads manifest.json from disk with try/catch
- serves GET /health returning { ok: true, agent, wallet } (wallet from AGENT_PRIVATE_KEY or null)
- serves POST /a2a that executes the described on-chain action using AGENT_PRIVATE_KEY from env
- uses bscTestnet (chain 97) when RPC_URL contains "testnet", otherwise bsc (chain 56)
- ALWAYS pass the RPC URL to the transport: viemHttp(rpcUrl) where rpcUrl = process.env.RPC_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545'
- NEVER call viemHttp() without a URL argument
- handles errors and returns JSON-RPC 2.0 responses
- uses slippage protection (never 0 min amounts)
- never uses the full token balance (leave gas reserve)
- uses the correct contract addresses (PancakeSwap V3 position manager: 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364)

Scaffold for PancakeSwap V3 LP rebalance:
${SCAFFOLD_PANCAKE_LP}
${VENUES_REGISTRY}


Reply with one JSON object and nothing else: no prose, no code fence.
If the request needs something impossible (custody of user funds, trading without a venue), return {"cannot": "..."} instead.`;

// read anthropic key from env or .env.local
function getAnthropicKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^ANTHROPIC_API_KEY=(.+)$/);
      if (m) return m[1].trim();
    }
  } catch { /* ignore */ }
  return null;
}

async function anthropicChat(system: string, user: string): Promise<string> {
  const key = getAnthropicKey();
  if (!key) throw new Error("no anthropic key");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`anthropic http ${res.status}: ${raw.slice(0, 200)}`);
  const data = JSON.parse(raw) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("anthropic returned no text");
  return text;
}

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

  // rate limit removed for development

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: prompt },
  ];

  let lastErrors: string[] = [];
  const ROUNDS = 2;

  for (let round = 0; round < ROUNDS; round++) {
    let reply: string;
    // try configured provider first
    try {
      reply = await chat.chat(chat.models[0], messages);
    } catch (e) {
      // fallback to anthropic
      try {
        const userMsg = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
        reply = await anthropicChat(SYSTEM, userMsg);
      } catch (e2) {
        return json({ success: false, error: "the builder's model could not be reached" }, 503);
      }
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