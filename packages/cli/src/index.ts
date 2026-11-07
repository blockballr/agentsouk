#!/usr/bin/env node
import { Command } from "commander";
import { configPath, readConfigFile, resolveConfig, type CliConfig } from "./core/config";
import { report } from "./core/errors";
import { pickFormat, renderJson, renderTable, type Format } from "./core/output";
import { runDoctor } from "./core/doctor";
import { parseAgentRef, railsOf, searchAgents, showAgent, verifyAgent } from "./marketplace/agents";

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
