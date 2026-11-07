#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";

// src/core/config.ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// src/core/errors.ts
var EXIT = {
  ok: 0,
  failure: 1,
  usage: 2
};
var CliError = class extends Error {
  code;
  exit;
  constructor(message, code = "error", exit = EXIT.failure) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exit = exit;
  }
};
var ApiError = class extends CliError {
  status;
  constructor(status, message) {
    super(message, `http_${status}`, status === 400 ? EXIT.usage : EXIT.failure);
    this.name = "ApiError";
    this.status = status;
  }
};
function report(error, asJson) {
  const cli = error instanceof CliError ? error : new CliError(error instanceof Error ? error.message : String(error));
  if (asJson) {
    process.stderr.write(`${JSON.stringify({ error: { code: cli.code, message: cli.message } })}
`);
  } else {
    process.stderr.write(`error: ${cli.message}
`);
  }
  return cli.exit;
}

// src/core/config.ts
var DEFAULT_CONFIG = {
  apiUrl: "https://api.agentsouk.xyz",
  rpcUrl: "https://bsc-dataseed.bnbchain.org",
  chainId: 56,
  defaultWallet: null,
  defaultRail: "direct"
};
function configPath(home = homedir()) {
  return join(home, ".agentsouk", "config.json");
}
function assertOwnerOnly(path) {
  if (process.platform === "win32") return;
  const mode = statSync(path).mode & 511;
  if ((mode & 63) !== 0) {
    throw new CliError(`${path} must not be group or world readable (chmod 600 ${path})`, "config_permissions");
  }
}
function readConfigFile(path) {
  if (!existsSync(path)) return {};
  assertOwnerOnly(path);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new CliError(`${path} is not valid JSON`, "config_invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError(`${path} must hold a JSON object`, "config_invalid");
  }
  return parsed;
}
function pick(values) {
  for (const value of values) {
    if (value !== void 0 && value !== null && value !== "") return value;
  }
  return void 0;
}
function resolveConfig(inputs) {
  const env = inputs.env ?? {};
  const file = inputs.file ?? {};
  const flags = inputs.flags;
  const apiUrl = pick([
    flags.apiUrl,
    env.AGENTSOUK_API_URL,
    file.apiUrl,
    DEFAULT_CONFIG.apiUrl
  ]) ?? DEFAULT_CONFIG.apiUrl;
  if (!/^https?:\/\//.test(apiUrl)) {
    throw new CliError(`api url must start with http or https: ${apiUrl}`, "config_invalid");
  }
  const chainId = Number(
    pick([flags.chainId, env.AGENTSOUK_CHAIN_ID, file.chainId, DEFAULT_CONFIG.chainId])
  );
  if (!Number.isSafeInteger(chainId) || chainId < 1) {
    throw new CliError(`chain id must be a positive integer`, "config_invalid");
  }
  const rail = pick([flags.defaultRail, file.defaultRail, DEFAULT_CONFIG.defaultRail]);
  if (!["direct", "jobs", "vault", "x402", "all"].includes(rail)) {
    throw new CliError(`unknown rail: ${rail}`, "config_invalid");
  }
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    rpcUrl: pick([flags.rpcUrl, env.AGENTSOUK_RPC_URL, file.rpcUrl, DEFAULT_CONFIG.rpcUrl]) ?? DEFAULT_CONFIG.rpcUrl,
    chainId,
    defaultWallet: pick([flags.defaultWallet, env.AGENTSOUK_WALLET, file.defaultWallet, null]) ?? null,
    defaultRail: rail
  };
}

// src/core/output.ts
function pickFormat(choice) {
  if (choice.output === "json" || choice.output === "table" || choice.output === "quiet") {
    return choice.output;
  }
  if (choice.json) return "json";
  if (choice.quiet) return "quiet";
  return choice.tty === false ? "json" : "table";
}
function cell(value) {
  if (value === null || value === void 0) return "-";
  if (Array.isArray(value)) return value.length > 0 ? value.join(",") : "-";
  return String(value);
}
function renderTable(rows, columns) {
  const widths = columns.map((column) => {
    const widest = rows.reduce(
      (max, row) => Math.max(max, cell(row[column.key]).length),
      column.label.length
    );
    return Math.min(column.width ?? 40, widest);
  });
  const line = (values) => values.map((value, index) => value.slice(0, widths[index]).padEnd(widths[index])).join("  ").trimEnd();
  const head = line(columns.map((column) => column.label.toUpperCase()));
  const body = rows.map((row) => line(columns.map((column) => cell(row[column.key]))));
  return [head, ...body].join("\n");
}
function renderJson(data, meta) {
  return JSON.stringify(meta ? { data, meta } : { data }, null, 2);
}

// src/core/http.ts
async function apiRequest(base, path, options = {}) {
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2e4);
  let response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json",
        ...options.body === void 0 ? {} : { "content-type": "application/json" }
      },
      body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
      signal: controller.signal
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError(`cannot reach ${base}: ${reason}`, "network");
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const record = body ?? {};
    const message = typeof record.error === "string" ? record.error : typeof record.message === "string" ? record.message : typeof body === "string" && body.length > 0 ? body.slice(0, 200) : response.statusText || `http ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return body;
}
function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === void 0 || value === "" || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// src/core/doctor.ts
async function runDoctor(apiUrl, chainId) {
  const rows = [];
  const started = Date.now();
  try {
    const chain = await apiRequest(apiUrl, "/api/chain", { timeoutMs: 8e3 });
    const served = Number(chain?.chainId ?? 0);
    rows.push({
      check: "api",
      ok: true,
      detail: `chain ${served}`,
      ms: Date.now() - started
    });
    rows.push({
      check: "chain",
      ok: served === chainId,
      detail: served === chainId ? `matches ${chainId}` : `api serves ${served}, config says ${chainId}`,
      ms: Date.now() - started
    });
  } catch (error) {
    rows.push({ check: "api", ok: false, detail: error.message, ms: Date.now() - started });
  }
  const statusStarted = Date.now();
  try {
    const status = await apiRequest(apiUrl, "/api/status", {
      timeoutMs: 8e3
    });
    const store = status?.data?.store ?? "unknown";
    rows.push({
      check: "status",
      ok: true,
      detail: `store ${store}`,
      ms: Date.now() - statusStarted
    });
  } catch (error) {
    rows.push({ check: "status", ok: false, detail: error.message, ms: Date.now() - statusStarted });
  }
  return rows;
}

// src/marketplace/agents.ts
function skillIds(agent) {
  return (agent.skills ?? []).map((skill) => String(skill?.id ?? skill?.name ?? "").trim().toLowerCase()).filter(Boolean);
}
function railsOf(agent) {
  const ids = skillIds(agent);
  const vault = ids.some((id) => /^vault[-_]execution$/.test(id));
  const jobs = ids.includes("negotiate") && ids.includes("notify_funded");
  const callable = Boolean(agent.a2a_endpoint || agent.mcp_server || agent.web_endpoint);
  const direct = callable && !vault && !jobs;
  const rails = [];
  if (jobs) rails.push("jobs");
  if (vault) rails.push("vault");
  if (direct) rails.push("direct");
  if (agent.x402_supported) rails.push("x402");
  return rails.length > 0 ? rails.join(",") : "none";
}
async function searchAgents(config2, options) {
  const path = `/api/agents${query({
    q: options.query,
    type: options.rail,
    category: options.category && options.category !== "all" ? options.category : void 0,
    metric: options.sort,
    limit: options.limit,
    page: options.page,
    chainId: options.chainId
  })}`;
  return apiRequest(config2.apiUrl, path);
}
async function showAgent(config2, chainId, tokenId) {
  const body = await apiRequest(config2.apiUrl, `/api/agents/${chainId}/${tokenId}`);
  const agent = body.data ?? body;
  if (!agent || typeof agent !== "object" || !("token_id" in agent || "name" in agent)) {
    throw new CliError(`no agent at ${chainId}/${tokenId}`, "not_found");
  }
  return agent;
}
async function verifyAgent(config2, chainId, tokenId) {
  return apiRequest(config2.apiUrl, `/api/agents/${chainId}/${tokenId}/verify`, {
    method: "POST",
    body: {},
    timeoutMs: 6e4
  });
}
function parseAgentRef(ref, defaultChain) {
  const match = /^(?:(\d+)[/:])?(\d+)$/.exec(ref.trim());
  if (!match) {
    throw new CliError(`agent must look like <chain>/<id> or <id>, got "${ref}"`, "usage", 2);
  }
  const chainId = match[1] ? Number(match[1]) : defaultChain;
  return { chainId, tokenId: match[2] };
}

// src/index.ts
var VERSION = "0.1.0";
var program = new Command();
program.name("agentsouk").description("Agent Souk from the terminal: search, inspect, verify and, later, call and hire agents.").version(VERSION, "-v, --version").option("--api <url>", "marketplace API base").option("--chain <id>", "chain id").option("--json", "print the JSON envelope").option("--quiet", "print identifiers only").option("--output <format>", "table, json or quiet").option("--no-color", "disable colour").showHelpAfterError();
function config() {
  const global = program.opts();
  return resolveConfig({
    flags: {
      apiUrl: global.api,
      chainId: global.chain === void 0 ? void 0 : Number(global.chain)
    },
    file: readConfigFile(configPath())
  });
}
function format() {
  const global = program.opts();
  return pickFormat({
    json: Boolean(global.json),
    quiet: Boolean(global.quiet),
    output: global.output,
    tty: process.stdout.isTTY
  });
}
function guard(work) {
  return async (...args) => {
    try {
      await work(...args);
    } catch (error) {
      process.exitCode = report(error, format() === "json");
    }
  };
}
program.command("search [query]").description("list agents on the shelf").option("--rail <rail>", "direct, jobs, vault, x402 or all").option("--category <key>", "rebalancing, grid-trading, yield or health-factor").option("--sort <metric>", "score, newest, feedback or health").option("--limit <n>", "page size, up to 60").option("--page <n>", "page number").action(
  guard(async (text, options) => {
    const cfg = config();
    const page = await searchAgents(cfg, {
      query: text,
      rail: options.rail ?? cfg.defaultRail,
      category: options.category,
      sort: options.sort,
      limit: Number(options.limit) || 20,
      page: Number(options.page) || 1,
      chainId: cfg.chainId
    });
    const items = page.items ?? [];
    const mode = format();
    if (mode === "json") {
      process.stdout.write(`${renderJson(page, { chainId: cfg.chainId, total: page.total ?? items.length })}
`);
      return;
    }
    if (mode === "quiet") {
      for (const agent of items) process.stdout.write(`${agent.chain_id ?? cfg.chainId}/${agent.token_id}
`);
      return;
    }
    process.stdout.write(
      `${renderTable(
        items.map((agent) => ({
          chain: agent.chain_id ?? cfg.chainId,
          id: agent.token_id,
          name: agent.name,
          category: agent.category ?? "-",
          rail: railsOf(agent),
          verify: agent.verification?.status ?? "unchecked",
          score: agent.total_score ?? "-"
        })),
        [
          { key: "chain", label: "chain" },
          { key: "id", label: "id" },
          { key: "name", label: "name", width: 28 },
          { key: "category", label: "category" },
          { key: "rail", label: "rail" },
          { key: "verify", label: "verify" },
          { key: "score", label: "score" }
        ]
      )}
`
    );
  })
);
program.command("show <agent>").description("one listing, in full").action(
  guard(async (ref) => {
    const cfg = config();
    const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
    const agent = await showAgent(cfg, chainId, tokenId);
    if (format() === "json") {
      process.stdout.write(`${renderJson(agent, { chainId, tokenId })}
`);
      return;
    }
    const rows = [
      { field: "name", value: agent.name },
      { field: "chain", value: chainId },
      { field: "id", value: tokenId },
      { field: "owner", value: agent.owner_address },
      { field: "wallet", value: agent.agent_wallet },
      { field: "category", value: agent.category },
      { field: "rail", value: railsOf(agent) },
      { field: "verification", value: agent.verification?.status ?? "unchecked" },
      { field: "score", value: agent.total_score },
      { field: "a2a", value: agent.a2a_endpoint },
      { field: "mcp", value: agent.mcp_server },
      { field: "web", value: agent.web_endpoint },
      { field: "vault min", value: agent.vaultMinDepositUsd ?? "-" }
    ];
    process.stdout.write(
      `${renderTable(rows, [
        { key: "field", label: "field" },
        { key: "value", label: "value", width: 90 }
      ])}
`
    );
  })
);
program.command("verify <agent>").description("run the marketplace probe for one listing").action(
  guard(async (ref) => {
    const cfg = config();
    const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
    const result = await verifyAgent(cfg, chainId, tokenId);
    if (format() === "json") {
      process.stdout.write(`${renderJson(result, { chainId, tokenId })}
`);
      return;
    }
    const status = result.verification?.status ?? (result.success ? "ok" : "failed");
    const ms = result.verification?.responseMs;
    const detail = result.verification?.detail ?? result.error ?? "";
    process.stdout.write(`${status}${ms === void 0 ? "" : ` ${ms}ms`}${detail ? ` ${detail}` : ""}
`);
  })
);
program.command("doctor").description("check the API and the chain the config names").action(
  guard(async () => {
    const cfg = config();
    const rows = await runDoctor(cfg.apiUrl, cfg.chainId);
    if (format() === "json") {
      process.stdout.write(`${renderJson(rows, { api: cfg.apiUrl, chainId: cfg.chainId })}
`);
      return;
    }
    process.stdout.write(
      `${renderTable(rows, [
        { key: "check", label: "check" },
        { key: "ok", label: "ok" },
        { key: "detail", label: "detail", width: 80 },
        { key: "ms", label: "ms" }
      ])}
`
    );
    if (rows.some((row) => !row.ok)) process.exitCode = 1;
  })
);
program.command("config").description("print the resolved config").action(
  guard(async () => {
    const cfg = config();
    process.stdout.write(`${renderJson(cfg)}
`);
  })
);
await program.parseAsync(process.argv);
