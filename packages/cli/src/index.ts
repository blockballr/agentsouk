#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { configPath, readConfigFile, resolveConfig, type CliConfig } from "./core/config";
import { report } from "./core/errors";
import { pickFormat, renderJson, renderTable, type Format } from "./core/output";
import { runDoctor } from "./core/doctor";
import { parseAgentRef, railsOf, searchAgents, showAgent, verifyAgent } from "./marketplace/agents";
import { callAgent } from "./marketplace/call";
import { listJobs, quoteJob, showJob } from "./marketplace/jobs";
import { checkListing, confirmListing, prepareListing, type ListingDraft } from "./marketplace/listing";

const VERSION = "0.1.0";

const program = new Command();
program
  .name("agentsouk")
  .description("Agent Souk from the terminal: search, inspect, verify and, later, call and hire agents.")
  .version(VERSION, "-v, --version")
  .option("--api <url>", "marketplace API base")
  .option("--chain <id>", "chain id")
  .option("--json", "print the JSON envelope")
  .option("--quiet", "print identifiers only")
  .option("--output <format>", "table, json or quiet")
  .option("--no-color", "disable colour")
  .showHelpAfterError();

function config(): CliConfig {
  const global = program.opts();
  return resolveConfig({
    flags: {
      apiUrl: global.api,
      chainId: global.chain === undefined ? undefined : Number(global.chain),
    },
    file: readConfigFile(configPath()),
  });
}

function format(): Format {
  const global = program.opts();
  return pickFormat({
    json: Boolean(global.json),
    quiet: Boolean(global.quiet),
    output: global.output,
    tty: process.stdout.isTTY,
  });
}

function guard<A extends unknown[]>(work: (...args: A) => Promise<void>) {
  return async (...args: A): Promise<void> => {
    try {
      await work(...args);
    } catch (error) {
      process.exitCode = report(error, format() === "json");
    }
  };
}

program
  .command("search [query]")
  .description("list agents on the shelf")
  .option("--rail <rail>", "direct, jobs, vault, x402 or all")
  .option("--category <key>", "rebalancing, grid-trading, yield or health-factor")
  .option("--sort <metric>", "score, newest, feedback or health")
  .option("--limit <n>", "page size, up to 60")
  .option("--page <n>", "page number")
  .action(
    guard(async (text: string | undefined, options: { rail?: string; category?: string; sort?: string; limit?: string; page?: string }) => {
      const cfg = config();
      const page = await searchAgents(cfg, {
        query: text,
        rail: options.rail ?? cfg.defaultRail,
        category: options.category,
        sort: options.sort,
        limit: Number(options.limit) || 20,
        page: Number(options.page) || 1,
        chainId: cfg.chainId,
      });
      const items = page.items ?? [];
      const mode = format();
      if (mode === "json") {
        process.stdout.write(`${renderJson(page, { chainId: cfg.chainId, total: page.total ?? items.length })}\n`);
        return;
      }
      if (mode === "quiet") {
        for (const agent of items) process.stdout.write(`${agent.chain_id ?? cfg.chainId}/${agent.token_id}\n`);
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
            score: agent.total_score ?? "-",
          })),
          [
            { key: "chain", label: "chain" },
            { key: "id", label: "id" },
            { key: "name", label: "name", width: 28 },
            { key: "category", label: "category" },
            { key: "rail", label: "rail" },
            { key: "verify", label: "verify" },
            { key: "score", label: "score" },
          ],
        )}\n`,
      );
    }),
  );

program
  .command("show <agent>")
  .description("one listing, in full")
  .action(
    guard(async (ref: string) => {
      const cfg = config();
      const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
      const agent = await showAgent(cfg, chainId, tokenId);
      if (format() === "json") {
        process.stdout.write(`${renderJson(agent, { chainId, tokenId })}\n`);
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
        { field: "vault min", value: agent.vaultMinDepositUsd ?? "-" },
      ];
      process.stdout.write(
        `${renderTable(rows, [
          { key: "field", label: "field" },
          { key: "value", label: "value", width: 90 },
        ])}\n`,
      );
    }),
  );

program
  .command("verify <agent>")
  .description("run the marketplace probe for one listing")
  .action(
    guard(async (ref: string) => {
      const cfg = config();
      const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
      const result = await verifyAgent(cfg, chainId, tokenId);
      if (format() === "json") {
        process.stdout.write(`${renderJson(result, { chainId, tokenId })}\n`);
        return;
      }
      const status = result.verification?.status ?? (result.success ? "ok" : "failed");
      const ms = result.verification?.responseMs;
      const detail = result.verification?.detail ?? result.error ?? "";
      process.stdout.write(`${status}${ms === undefined ? "" : ` ${ms}ms`}${detail ? ` ${detail}` : ""}\n`);
    }),
  );


program
  .command("call <agent>")
  .description("call an agent's A2A endpoint with one task")
  .requiredOption("--task <text>", "the task text")
  .option("--timeout <seconds>", "call timeout in seconds", "30")
  .action(
    guard(async (ref: string, options: { task: string; timeout?: string }) => {
      const cfg = config();
      const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
      const result = await callAgent(cfg, chainId, tokenId, options.task, {
        timeoutMs: (Number(options.timeout) || 30) * 1000,
      });
      if (format() === "json") {
        process.stdout.write(
          `${renderJson(
            {
              agent: result.agent.name,
              tokenId,
              endpoint: result.endpoint,
              latencyMs: result.latencyMs,
              text: result.text,
              result: result.result,
            },
            { chainId, tokenId },
          )}\n`,
        );
        return;
      }
      process.stdout.write(`${result.text}\n`);
      if (format() === "table") {
        process.stderr.write(`${result.agent.name ?? tokenId} · ${result.latencyMs}ms · ${result.endpoint}\n`);
      }
    }),
  );

program
  .command("quote <agent>")
  .description("quote an ERC-8183 job, read-only")
  .requiredOption("--task <text>", "the task text")
  .option("--client <wallet>", "the buyer wallet")
  .action(
    guard(async (ref: string, options: { task: string; client?: string }) => {
      const cfg = config();
      const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
      const result = await quoteJob(cfg, chainId, tokenId, options.task, options.client);
      if (format() === "json") {
        process.stdout.write(`${renderJson(result, { chainId, tokenId })}\n`);
        return;
      }
      const quote = result.quote ?? {};
      const fee = quote.envelope?.fee_usd;
      const capital = quote.envelope?.capital_usd;
      process.stdout.write(
        `${renderTable(
          [
            { field: "agent", value: result.agent?.name ?? tokenId },
            { field: "price", value: fee !== undefined ? `${fee} U` : quote.price },
            { field: "currency", value: quote.currency },
            { field: "provider", value: quote.providerAddress },
            { field: "capital", value: capital ?? "-" },
            { field: "valid until", value: quote.validUntil ? new Date(quote.validUntil * 1000).toISOString() : "-" },
            { field: "commerce", value: result.stack?.commerce },
            { field: "router", value: result.stack?.router },
          ],
          [
            { key: "field", label: "field" },
            { key: "value", label: "value", width: 80 },
          ],
        )}\n`,
      );
    }),
  );

program
  .command("jobs")
  .description("recent ERC-8183 jobs")
  .option("--limit <n>", "how many to read", "20")
  .option("--wallet <addr>", "only jobs whose client is this wallet")
  .option("--payee <addr>", "only jobs whose payee is this wallet")
  .action(
    guard(async (options: { limit?: string; wallet?: string; payee?: string }) => {
      const cfg = config();
      const page = await listJobs(cfg, Number(options.limit) || 20);
      let jobs = page.jobs ?? [];
      if (options.wallet) {
        const wanted = options.wallet.toLowerCase();
        jobs = jobs.filter((job) => String(job.client ?? "").toLowerCase() === wanted);
      }
      if (options.payee) {
        const wanted = options.payee.toLowerCase();
        jobs = jobs.filter((job) => String(job.provider ?? "").toLowerCase() === wanted);
      }
      if (format() === "json") {
        process.stdout.write(`${renderJson(jobs, { chainId: cfg.chainId, count: jobs.length })}\n`);
        return;
      }
      process.stdout.write(
        `${renderTable(
          jobs.map((job) => ({
            id: job.id ?? job.paymentId,
            chain: job.chainId,
            token: job.tokenId,
            agent: job.agentName,
            status: job.status,
            budget: job.budgetUsd ?? "-",
            created: job.createdAt,
          })),
          [
            { key: "id", label: "id", width: 26 },
            { key: "chain", label: "chain" },
            { key: "token", label: "token" },
            { key: "agent", label: "agent", width: 26 },
            { key: "status", label: "status" },
            { key: "budget", label: "budget" },
            { key: "created", label: "created" },
          ],
        )}\n`,
      );
    }),
  );

program
  .command("job <id>")
  .description("one job, in full")
  .action(
    guard(async (id: string) => {
      const cfg = config();
      const job = await showJob(cfg, id);
      if (format() === "json") {
        process.stdout.write(`${renderJson(job, { chainId: cfg.chainId })}\n`);
        return;
      }
      process.stdout.write(
        `${renderTable(
          [
            { field: "id", value: job.id ?? job.paymentId },
            { field: "chain", value: job.chainId },
            { field: "token", value: job.tokenId },
            { field: "agent", value: job.agentName },
            { field: "status", value: job.status },
            { field: "client", value: job.client },
            { field: "provider", value: job.provider },
            { field: "budget", value: job.budgetUsd ?? "-" },
            { field: "created", value: job.createdAt },
            { field: "description", value: job.description },
          ],
          [
            { key: "field", label: "field" },
            { key: "value", label: "value", width: 96 },
          ],
        )}\n`,
      );
    }),
  );

const listing = program.command("list").description("seller listing flow");

listing
  .command("check <endpoint>")
  .description("fetch the card the marketplace would read")
  .action(
    guard(async (endpoint: string) => {
      const result = await checkListing(endpoint);
      if (format() === "json") {
        process.stdout.write(`${renderJson(result)}\n`);
      } else {
        process.stdout.write(`${result.ok ? "ok" : "refused"}  ${result.detail}\n`);
      }
      if (!result.ok) process.exitCode = 1;
    }),
  );

listing
  .command("prepare")
  .description("validate a draft and mint a registration claim")
  .requiredOption("--draft <file>", "the draft JSON")
  .option("--owner <wallet>", "the listing owner")
  .option("--mode <mode>", "call, job or both", "call")
  .action(
    guard(async (options: { draft: string; owner?: string; mode?: string }) => {
      const cfg = config();
      const draft = JSON.parse(readFileSync(options.draft, "utf8")) as ListingDraft;
      const result = await prepareListing(cfg, draft, { owner: options.owner, mode: options.mode });
      if (format() === "json") {
        process.stdout.write(`${renderJson(result)}\n`);
        return;
      }
      const rows = [
        { field: "claim", value: result.claimId },
        { field: "document", value: result.agentUri },
        { field: "chain", value: result.chainId },
        { field: "registry", value: result.registryAddress },
        { field: "calldata", value: result.registerCalldata },
        { field: "persistence", value: result.persistence },
      ];
      process.stdout.write(
        `${renderTable(rows, [
          { key: "field", label: "field" },
          { key: "value", label: "value", width: 120 },
        ])}\n`,
      );
    }),
  );

listing
  .command("confirm")
  .description("confirm the mined registration and admit the listing")
  .requiredOption("--claim-id <id>")
  .requiredOption("--agent-id <id>")
  .requiredOption("--tx <hash>")
  .action(
    guard(async (options: { claimId: string; agentId: string; tx: string }) => {
      const cfg = config();
      const result = await confirmListing(cfg, options.claimId, options.agentId, options.tx);
      if (format() === "json") {
        process.stdout.write(`${renderJson(result)}\n`);
        return;
      }
      process.stdout.write(
        `${result.success === false ? "refused" : "admitted"}  ${result.listingUrl ?? result.agentId ?? ""}  ${result.error ?? ""}\n`,
      );
    }),
  );

program
  .command("doctor")
  .description("check the API and the chain the config names")
  .action(
    guard(async () => {
      const cfg = config();
      const rows = await runDoctor(cfg.apiUrl, cfg.chainId);
      if (format() === "json") {
        process.stdout.write(`${renderJson(rows, { api: cfg.apiUrl, chainId: cfg.chainId })}\n`);
        return;
      }
      process.stdout.write(
        `${renderTable(rows, [
          { key: "check", label: "check" },
          { key: "ok", label: "ok" },
          { key: "detail", label: "detail", width: 80 },
          { key: "ms", label: "ms" },
        ])}\n`,
      );
      if (rows.some((row) => !row.ok)) process.exitCode = 1;
    }),
  );

program
  .command("config")
  .description("print the resolved config")
  .action(
    guard(async () => {
      const cfg = config();
      process.stdout.write(`${renderJson(cfg)}\n`);
    }),
  );

await program.parseAsync(process.argv);
