#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { configPath, readConfigFile, resolveConfig, type CliConfig } from "./core/config";
import { report } from "./core/errors";
import { pickFormat, renderJson, renderTable, type Format } from "./core/output";
import { runDoctor } from "./core/doctor";
import { ownedAgentState, parseAgentRef, railsOf, searchAgents, showAgent, verifyAgent } from "./marketplace/agents";
import { callAgent } from "./marketplace/call";
import { callMcpTool, listMcpTools, parseMcpArgs } from "./marketplace/mcp";
import { paidCall, preparePayment } from "./marketplace/x402";
import { listJobs, notifyJob, quoteJob, showJob } from "./marketplace/jobs";
import { actOnJob, type JobActionName } from "./marketplace/job-actions";
import { fundHire, hireCalls, planHire } from "./marketplace/hire";
import { isTxHash, verifyPayment, verifyTransaction } from "./marketplace/receipt";
import { checkListing, confirmListing, prepareListing, type ListingDraft } from "./marketplace/listing";
import { previewRegister, sendRegister } from "./marketplace/register";
import { loadSigner } from "./core/wallet";
import { rateAgent } from "./marketplace/ratings";
import { controlListing } from "./marketplace/control";
import { editListing, prepareEdit } from "./marketplace/listing-edit";
import { vaultAgents, vaultFor, vaultInfo, vaultPnl, vaultPositions, vaultReceipts } from "./marketplace/vault";
import { CliError } from "./core/errors";

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
  .description("call an agent's A2A endpoint or MCP tool, or hire it over x402")
  .option("--task <text>", "the task text to deliver")
  .option("--mcp", "call the agent's MCP server directly, without paying")
  .option("--list-tools", "list the MCP tools and exit")
  .option("--tool <name>", "the MCP tool to call")
  .option("--args <json>", "JSON arguments for the MCP tool", "{}")
  .option("--pay", "hire the agent over x402, then deliver the result")
  .option("--max-usd <n>", "refuse a hire above this amount")
  .option("--client <wallet>", "the buyer wallet, for a preview without a key")
  .option("--key-file <path>", "the buyer key, for a paid call")
  .option("--yes", "confirm the payment")
  .option("--timeout <seconds>", "call timeout in seconds", "30")
  .action(
    guard(
      async (
        ref: string,
        options: {
          task?: string;
          mcp?: boolean;
          listTools?: boolean;
          tool?: string;
          args?: string;
          pay?: boolean;
          maxUsd?: string;
          client?: string;
          keyFile?: string;
          yes?: boolean;
          timeout?: string;
        },
      ) => {
        const cfg = config();
        const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
        const timeoutMs = (Number(options.timeout) || 30) * 1000;

        if (options.pay) {
          if (options.mcp || options.listTools) {
            throw new CliError("--pay delivers through the marketplace; drop --mcp and --list-tools", "usage", 2);
          }
          if (!options.task && !options.tool) {
            throw new CliError("--pay needs --task or --tool to say what to deliver", "usage", 2);
          }
          const signer = options.keyFile || process.env.AGENTSOUK_KEY ? loadSigner({ keyFile: options.keyFile }) : null;
          const client = options.client ?? signer?.address ?? "";
          if (!client) throw new CliError("pass --client to preview, or --key-file to sign", "usage", 2);
          if (signer && options.client && options.client.toLowerCase() !== signer.address.toLowerCase()) {
            throw new CliError(`--client ${options.client} is not the key's address ${signer.address}`, "usage", 2);
          }
          const prepared = await preparePayment(
            cfg,
            chainId,
            tokenId,
            client,
            options.maxUsd === undefined ? undefined : Number(options.maxUsd),
          );
          const { data, option } = prepared;
          const work = options.tool
            ? { tool: options.tool, args: parseMcpArgs(options.args) }
            : { task: options.task };

          if (!options.yes) {
            if (format() === "json") {
              process.stdout.write(
                `${renderJson(
                  {
                    agent: data.agent.name,
                    tokenId,
                    paymentId: data.preview.paymentId,
                    amount: option.amount,
                    amountUsd: option.amountUsd,
                    symbol: option.tokenSymbol,
                    payTo: option.payTo,
                    agentPayTo: data.paymentRequirements.extra.agentPayTo ?? null,
                    resource: data.preview.resource,
                  },
                  { chainId, tokenId },
                )}\n`,
              );
              return;
            }
            process.stdout.write(
              `${renderTable(
                [
                  { field: "agent", value: data.agent.name },
                  { field: "amount", value: `${option.amountUsd} ${option.tokenSymbol}` },
                  { field: "pay to", value: option.payTo },
                  { field: "agent wallet", value: data.paymentRequirements.extra.agentPayTo ?? "-" },
                  { field: "method", value: data.paymentRequirements.extra.assetTransferMethod ?? "-" },
                  { field: "resource", value: data.preview.resource.url },
                  { field: "payment", value: data.preview.paymentId },
                ],
                [
                  { key: "field", label: "field" },
                  { key: "value", label: "value", width: 100 },
                ],
              )}\n\npass --yes to sign and pay\n`,
            );
            return;
          }

          if (!signer) {
            throw new CliError("pass --key-file or set AGENTSOUK_KEY to sign the payment", "key_missing", 2);
          }
          const result = await paidCall(cfg, signer, prepared, work);
          if (format() === "json") {
            process.stdout.write(
              `${renderJson(
                {
                  agent: result.data.agent.name,
                  tokenId,
                  paymentId: result.settle.paymentId,
                  txHash: result.settle.txHash ?? null,
                  mode: result.settle.details?.mode ?? result.receipt?.mode ?? null,
                  amount: result.option.amountUsd,
                  symbol: result.option.tokenSymbol,
                  receipt: result.receipt,
                  delivery: result.delivery ?? null,
                  deliveryError: result.deliveryError ?? null,
                },
                { chainId, tokenId, paymentId: result.settle.paymentId },
              )}\n`,
            );
            return;
          }
          if (result.delivery?.text) process.stdout.write(`${result.delivery.text}\n`);
          if (result.deliveryError) {
            process.stderr.write(`paid, but delivery failed: ${result.deliveryError}\n`);
            process.exitCode = 1;
          }
          if (format() === "table") {
            process.stderr.write(
              `${result.data.agent.name} · paid ${result.option.amountUsd} ${result.option.tokenSymbol} · ${result.settle.paymentId}${result.settle.txHash ? ` · ${result.settle.txHash}` : ""}\n`,
            );
          }
          return;
        }

        if (options.listTools) {
          const result = await listMcpTools(cfg, chainId, tokenId, { timeoutMs });
          if (format() === "json") {
            process.stdout.write(
              `${renderJson(
                { agent: result.agent.name, tokenId, endpoint: result.endpoint, tools: result.tools },
                { chainId, tokenId },
              )}\n`,
            );
            return;
          }
          const rows = result.tools.length
            ? result.tools.map((tool) => ({ name: tool.name, description: (tool.description ?? "").slice(0, 100) }))
            : [{ name: "(none)", description: "the server returned no tools" }];
          process.stdout.write(
            `${renderTable(rows, [
              { key: "name", label: "tool" },
              { key: "description", label: "description", width: 80 },
            ])}\n`,
          );
          return;
        }

        if (options.mcp || options.tool) {
          if (!options.tool) {
            throw new CliError("--tool is required for an MCP call; use --list-tools first", "usage");
          }
          const args = parseMcpArgs(options.args);
          const result = await callMcpTool(cfg, chainId, tokenId, options.tool, args, { timeoutMs });
          if (format() === "json") {
            process.stdout.write(
              `${renderJson(
                {
                  agent: result.agent.name,
                  tokenId,
                  endpoint: result.endpoint,
                  tool: result.tool,
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
            process.stderr.write(`${result.agent.name ?? tokenId} · ${result.latencyMs}ms · ${result.endpoint}#${result.tool}\n`);
          }
          return;
        }

        if (!options.task) {
          throw new CliError("a task is required for an A2A call; pass --task or use --mcp --tool", "usage");
        }
        const result = await callAgent(cfg, chainId, tokenId, options.task, { timeoutMs });
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
      },
    ),
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

const jobs = program
  .command("jobs")
  .description("recent ERC-8183 jobs, and the signed actions a job takes")
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

const JOB_ACTIONS: {
  name: string;
  action: JobActionName;
  done: string;
  describe: string;
  needs: "deliverable" | "reason" | "none";
  confirm?: string;
}[] = [
  {
    name: "submit",
    action: "submit",
    done: "submitted",
    describe: "the seller delivers the finished work",
    needs: "deliverable",
  },
  {
    name: "complete",
    action: "complete",
    done: "completed",
    describe: "the evaluator accepts a submitted job and releases the escrow",
    needs: "reason",
  },
  {
    name: "reject",
    action: "reject",
    done: "rejected",
    describe: "the buyer or evaluator refuses the job",
    needs: "reason",
  },
  {
    name: "refund",
    action: "claimRefund",
    done: "refunded",
    describe: "the buyer claims the escrow after an expired job, once the chain agrees",
    needs: "none",
    confirm: "this claims the escrow refund: pass --yes to confirm",
  },
];

for (const spec of JOB_ACTIONS) {
  const action = jobs.command(`${spec.name} <id>`).description(spec.describe);
  if (spec.needs === "deliverable") action.requiredOption("--deliverable <text>", "what the seller delivered");
  if (spec.needs === "reason") action.option("--reason <text>", "why, recorded on the job");
  action.option("--key-file <path>", "the key of the party this action allows");
  if (spec.confirm) action.option("--yes", "confirm the escrow movement");
  action.action(
    guard(
      async (
        id: string,
        options: { deliverable?: string; reason?: string; keyFile?: string; yes?: boolean },
      ) => {
        const cfg = config();
        const signer = loadSigner({ keyFile: options.keyFile });
        if (spec.confirm && !options.yes) throw new CliError(spec.confirm, "confirm_required", 2);

        const result = await actOnJob(cfg, signer, id, spec.action, {
          reason: options.reason,
          deliverable: options.deliverable,
        });
        if (format() === "json") {
          process.stdout.write(`${renderJson(result, { chainId: cfg.chainId, jobId: id })}\n`);
          return;
        }
        if (result.success === false) {
          process.stdout.write(`refused  ${result.error ?? result.job?.status ?? ""}\n`);
          return;
        }
        process.stdout.write(`${spec.done}  ${result.job?.id ?? id}  ${result.job?.status ?? ""}\n`);
      },
    ),
  );
}

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

const listing = program
  .command("list")
  .description("seller listing flow")
  .option("--draft <file>", "the one-shot flow: check, prepare, register, confirm")
  .option("--owner <wallet>", "the listing owner")
  .option("--mode <mode>", "call, job or both", "call")
  .option("--key-file <path>", "the owner key for the registry transaction")
  .option("--prepare-only", "stop after the transaction preview")
  .option("--yes", "send the registry transaction")
  .action(
    guard(async (options: {
      draft?: string;
      owner?: string;
      mode?: string;
      keyFile?: string;
      prepareOnly?: boolean;
      yes?: boolean;
    }) => {
      if (!options.draft) {
        throw new CliError("the one-shot flow needs --draft <file>", "usage", 2);
      }
      const cfg = config();
      const draft = JSON.parse(readFileSync(options.draft, "utf8")) as ListingDraft;
      const check = await checkListing(draft.endpoint);
      if (!check.ok) throw new CliError(`the endpoint is not listable: ${check.detail}`, "endpoint_refused");
      if (format() === "table") process.stderr.write(`endpoint ok: ${check.detail}\n`);

      // the owner signs the registry transaction, so a key is needed unless the
      // caller only wants the preview and names the owner explicitly
      let signer = null;
      if (options.keyFile) signer = loadSigner({ keyFile: options.keyFile });
      else if (process.env.AGENTSOUK_KEY) signer = loadSigner({});
      const owner = options.owner ?? signer?.address;
      if (!owner) throw new CliError("pass --owner, or --key-file to sign as the owner", "usage", 2);

      const prepared = await prepareListing(cfg, draft, { owner, mode: options.mode });
      if (!prepared.registryAddress || !prepared.registerCalldata) {
        throw new CliError("the marketplace did not return a registry transaction", "prepare_incomplete");
      }
      const preview = await previewRegister(
        cfg,
        owner as `0x${string}`,
        prepared.registryAddress as `0x${string}`,
        prepared.registerCalldata as `0x${string}`,
      );
      const previewRows = [
        { field: "claim", value: prepared.claimId },
        { field: "document", value: prepared.agentUri },
        { field: "chain", value: prepared.chainId },
        { field: "registry", value: prepared.registryAddress },
        { field: "gas", value: preview.gas.toString() },
        { field: "calldata", value: prepared.registerCalldata },
      ];
      if (format() === "json" && (options.prepareOnly || !options.yes)) {
        process.stdout.write(`${renderJson(prepared, { gas: preview.gas.toString(), chainId: cfg.chainId })}\n`);
        return;
      }
      process.stdout.write(
        `${renderTable(previewRows, [
          { key: "field", label: "field" },
          { key: "value", label: "value", width: 120 },
        ])}\n`,
      );
      if (options.prepareOnly) return;
      if (!options.yes) throw new CliError("this sends a registry transaction: pass --yes to confirm", "confirm_required", 2);
      if (!signer) throw new CliError("pass --key-file or set AGENTSOUK_KEY to sign", "key_missing", 2);
      if (!prepared.claimId) throw new CliError("the marketplace did not return a claim id", "prepare_incomplete");

      const sent = await sendRegister(
        cfg,
        signer,
        prepared.registryAddress as `0x${string}`,
        prepared.registerCalldata as `0x${string}`,
      );
      const confirmed = await confirmListing(cfg, prepared.claimId, sent.agentId, sent.txHash);
      const url = `https://app.agentsouk.xyz/agents/${cfg.chainId}/${sent.agentId}`;
      if (format() === "json") {
        process.stdout.write(`${renderJson({ ...confirmed, agentId: sent.agentId, txHash: sent.txHash, listingUrl: url })}\n`);
        return;
      }
      process.stdout.write(`listed  ${url}\n`);
    }),
  );

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
  .command("rate <agent>")
  .description("rate a completed hire, signed by the buyer")
  .requiredOption("--payment-id <id>", "the payment the rating belongs to")
  .requiredOption("--score <n>", "1 to 5")
  .option("--comment <text>")
  .option("--verifier-score <n>", "the verifier's score, when one exists")
  .option("--key-file <path>", "the buyer key")
  .action(
    guard(async (ref: string, options: { paymentId: string; score: string; comment?: string; verifierScore?: string; keyFile?: string }) => {
      const cfg = config();
      const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
      const signer = loadSigner({ keyFile: options.keyFile });
      const result = await rateAgent(cfg, signer, chainId, tokenId, {
        paymentId: options.paymentId,
        score: Number(options.score),
        comment: options.comment,
        verifierScore: options.verifierScore === undefined ? 0 : Number(options.verifierScore),
      });
      process.stdout.write(`${format() === "json" ? renderJson(result, { chainId, tokenId }) : result.success === false ? `refused  ${result.error ?? ""}` : "rated"}\n`);
    }),
  );

const listingControl = program.command("listing").description("take a listing off the market, or put it back");

listingControl
  .command("show <agent>")
  .description("the listing state, including whether it is delisted")
  .action(
    guard(async (ref: string) => {
      const cfg = config();
      const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
      const agent = await showAgent(cfg, chainId, tokenId);
      const owned = agent.owner_address
        ? await ownedAgentState(cfg, chainId, agent.owner_address, tokenId).catch(() => null)
        : null;
      const delisted = owned?.delisted ?? null;
      if (format() === "json") {
        process.stdout.write(`${renderJson({ agent, delisted }, { chainId, tokenId })}\n`);
        return;
      }
      process.stdout.write(`${agent.name ?? tokenId}  ${delisted ? `delisted ${delisted.reason ?? ""} ${delisted.at ?? ""}` : "listed"}\n`);
    }),
  );

for (const action of ["delist", "relist"] as const) {
  listingControl
    .command(`${action} <agent>`)
    .description(action === "delist" ? "take the listing off the market" : "put the listing back")
    .option("--key-file <path>", "the owner key")
    .action(
      guard(async (ref: string, options: { keyFile?: string }) => {
        const cfg = config();
        const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
        const signer = loadSigner({ keyFile: options.keyFile });
        const result = await controlListing(cfg, signer, chainId, tokenId, action);
        process.stdout.write(
          `${format() === "json" ? renderJson(result, { chainId, tokenId }) : result.success === false ? `refused  ${result.error ?? ""}` : `${action}ed ${tokenId}`}\n`,
        );
      }),
    );
}

listingControl
  .command("edit <agent>")
  .description("rewrite the description, examples and image a listing shows")
  .option("--edit <file>", "a JSON file with description, examples and imageUrl")
  .option("--clear", "drop the edit and show the registry text again")
  .option("--key-file <path>", "the owner key")
  .option("--yes", "sign and send; without it the exact signed text is only shown")
  .action(
    guard(async (ref: string, options: { edit?: string; clear?: boolean; keyFile?: string; yes?: boolean }) => {
      const cfg = config();
      const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
      if (!options.edit && !options.clear) throw new CliError("pass --edit <file> or --clear", "usage", 2);
      if (options.edit && options.clear) throw new CliError("pass either --edit or --clear, not both", "usage", 2);

      const signer = options.yes ? loadSigner({ keyFile: options.keyFile }) : null;
      const owner = signer?.address ?? (await showAgent(cfg, chainId, tokenId)).owner_address;
      if (!owner) throw new CliError("this listing has no owner to sign for", "no_owner", 2);

      let raw: unknown = {};
      if (options.edit) {
        try {
          raw = JSON.parse(readFileSync(options.edit, "utf8"));
        } catch (error) {
          throw new CliError(
            `cannot read the edit file: ${error instanceof Error ? error.message : String(error)}`,
            "bad_file",
            2,
          );
        }
      }

      const prepared = await prepareEdit(chainId, tokenId, owner, raw);
      if (!options.yes) {
        if (format() === "json") {
          process.stdout.write(
            `${renderJson(
              {
                owner,
                clear: prepared.clear,
                issuedAt: prepared.issuedAt,
                digest: prepared.digest,
                message: prepared.message,
              },
              { chainId, tokenId },
            )}\n`,
          );
          return;
        }
        process.stdout.write(`${prepared.message}\n\npass --yes to sign and save it\n`);
        return;
      }

      if (!signer) throw new CliError("pass --key-file or set AGENTSOUK_KEY to sign", "key_missing", 2);
      const result = await editListing(cfg, signer, chainId, tokenId, prepared);
      if (format() === "json") {
        process.stdout.write(`${renderJson({ ...result, owner, digest: prepared.digest }, { chainId, tokenId })}\n`);
        return;
      }
      process.stdout.write(
        `${result.success === false ? `refused  ${result.error ?? ""}` : `${prepared.clear ? "cleared" : "edited"}  ${tokenId}`}\n`,
      );
    }),
  );


const vault = program.command("vault").description("the HireVault rail, read-only");

vault
  .command("list")
  .description("the vault address, minimum deposit and open-hire cap")
  .action(
    guard(async () => {
      const cfg = config();
      const info = await vaultInfo(cfg);
      const row = vaultFor(info.vaults, cfg.chainId);
      if (format() === "json") {
        process.stdout.write(`${renderJson(row ?? info, { chainId: cfg.chainId })}\n`);
        return;
      }
      process.stdout.write(
        `${renderTable(
          [
            { field: "chain", value: row?.chainId ?? cfg.chainId },
            { field: "vault", value: row?.address },
            { field: "min deposit", value: row?.minDepositInToken0 ? `${Number(row.minDepositInToken0) / 1e18} USDT` : "-" },
            { field: "max open per buyer", value: row?.maxOpenPerBuyer ?? "-" },
          ],
          [
            { key: "field", label: "field" },
            { key: "value", label: "value", width: 80 },
          ],
        )}\n`,
      );
    }),
  );

vault
  .command("agents")
  .description("agents that declare a vault hire")
  .action(
    guard(async () => {
      const cfg = config();
      const page = await vaultAgents(cfg);
      const agents = page.agents ?? [];
      if (format() === "json") {
        process.stdout.write(`${renderJson(agents, { chainId: cfg.chainId, count: agents.length })}\n`);
        return;
      }
      process.stdout.write(
        `${renderTable(
          agents.map((agent) => ({
            token: agent.tokenId,
            name: agent.name,
            wallet: agent.wallet,
            category: agent.category,
            policy: agent.policy,
          })),
          [
            { key: "token", label: "token" },
            { key: "name", label: "name", width: 26 },
            { key: "wallet", label: "wallet", width: 44 },
            { key: "category", label: "category" },
            { key: "policy", label: "policy" },
          ],
        )}\n`,
      );
    }),
  );

vault
  .command("positions")
  .description("open and closed hires for a buyer")
  .requiredOption("--buyer <wallet>")
  .action(
    guard(async (options: { buyer: string }) => {
      const cfg = config();
      const page = await vaultPositions(cfg, options.buyer);
      const positions = page.positions ?? [];
      if (format() === "json") {
        process.stdout.write(`${renderJson(page, { chainId: cfg.chainId, count: positions.length })}\n`);
        return;
      }
      process.stdout.write(
        `${renderTable(
          positions.map((position) => ({
            id: position.id,
            agent: position.agent,
            open: position.open,
            deposit: position.deposit,
            value: position.value,
            pnl: position.pnl,
            expiry: position.expiry,
          })),
          [
            { key: "id", label: "id" },
            { key: "agent", label: "agent", width: 44 },
            { key: "open", label: "open" },
            { key: "deposit", label: "deposit" },
            { key: "value", label: "value" },
            { key: "pnl", label: "pnl" },
            { key: "expiry", label: "expiry" },
          ],
        )}\n`,
      );
    }),
  );

vault
  .command("pnl")
  .description("receipts and realized deltas per agent")
  .requiredOption("--buyer <wallet>")
  .action(
    guard(async (options: { buyer: string }) => {
      const cfg = config();
      const page = await vaultPnl(cfg, options.buyer);
      const agents = page.agents ?? [];
      if (format() === "json") {
        process.stdout.write(`${renderJson(page, { chainId: cfg.chainId })}\n`);
        return;
      }
      process.stdout.write(
        `${renderTable(
          agents.map((agent) => ({
            wallet: agent.wallet,
            label: agent.label,
            decisions: agent.decisions,
            traded: agent.traded,
            realized: agent.realized,
          })),
          [
            { key: "wallet", label: "wallet", width: 44 },
            { key: "label", label: "label", width: 24 },
            { key: "decisions", label: "decisions" },
            { key: "traded", label: "traded" },
            { key: "realized", label: "realized" },
          ],
        )}\n`,
      );
    }),
  );

vault
  .command("receipts")
  .description("the receipts for one hire")
  .requiredOption("--hire <id>")
  .action(
    guard(async (options: { hire: string }) => {
      const cfg = config();
      const body = await vaultReceipts(cfg, options.hire);
      process.stdout.write(`${renderJson(body, { chainId: cfg.chainId, hireId: options.hire })}\n`);
    }),
  );


program
  .command("hire <agent>")
  .description("quote an ERC-8183 job, and fund it with --fund --yes")
  .requiredOption("--task <text>", "the task text")
  .option("--max-usd <n>", "refuse a quote above this fee, in U")
  .option("--client <wallet>", "the buyer wallet, when not signing here")
  .option("--fund", "create and fund the job on chain")
  .option("--key-file <path>", "the buyer key")
  .option("--yes", "confirm the spend")
  .action(
    guard(async (ref: string, options: { task: string; maxUsd?: string; client?: string; fund?: boolean; keyFile?: string; yes?: boolean }) => {
      const cfg = config();
      const { chainId, tokenId } = parseAgentRef(ref, cfg.chainId);
      const signer = options.keyFile ? loadSigner({ keyFile: options.keyFile }) : process.env.AGENTSOUK_KEY ? loadSigner({}) : null;
      const client = options.client ?? signer?.address;
      if (!client) throw new CliError("pass --client, or --key-file to sign as the buyer", "usage", 2);

      const plan = await planHire(cfg, chainId, tokenId, options.task, {
        client,
        maxUsd: options.maxUsd === undefined ? undefined : Number(options.maxUsd),
      });
      const rows = [
        { field: "agent", value: plan.agent },
        { field: "fee", value: plan.feeUsd === null ? "-" : `${plan.feeUsd} U` },
        { field: "price", value: plan.price.toString() },
        { field: "currency", value: plan.currency },
        { field: "provider", value: plan.provider },
        { field: "job", value: plan.jobId.toString() },
        { field: "expires", value: new Date(Number(plan.expiredAt) * 1000).toISOString() },
        { field: "calls", value: hireCalls(plan).map((call) => call.label).join(", ") },
      ];
      if (format() === "json") {
        process.stdout.write(`${renderJson(plan, { chainId, tokenId, price: plan.price.toString(), jobId: plan.jobId.toString() })}\n`);
      } else {
        process.stdout.write(
          `${renderTable(rows, [
            { key: "field", label: "field" },
            { key: "value", label: "value", width: 100 },
          ])}\n`,
        );
      }
      if (!options.fund) return;
      if (!options.yes) throw new CliError("this funds an escrow job: pass --yes to confirm", "confirm_required", 2);
      if (!signer) throw new CliError("pass --key-file or set AGENTSOUK_KEY to sign", "key_missing", 2);

      const sent = await fundHire(cfg, signer, plan);
      const notified = await notifyJob(cfg, {
        chainId,
        tokenId,
        kernelJobId: sent.jobId,
        client: signer.address,
        task: plan.description,
      }).catch((error) => ({ error: (error as Error).message }));
      if (format() === "json") {
        process.stdout.write(`${renderJson({ ...sent, notified }, { chainId, tokenId })}\n`);
        return;
      }
      for (const tx of sent.txs) process.stdout.write(`${tx.label}  ${tx.hash}\n`);
      process.stdout.write(`job ${sent.jobId}\n`);
      if (typeof notified === "object" && notified && "error" in notified) {
        process.stderr.write(`the seller was not notified: ${String((notified as { error: unknown }).error)}\n`);
      }
    }),
  );


program
  .command("receipt <id>")
  .description("verify a payment or a transaction against BNB Chain")
  .action(
    guard(async (id: string) => {
      const cfg = config();
      const result = isTxHash(id) ? await verifyTransaction(cfg, id) : await verifyPayment(cfg, id);
      if (format() === "json") {
        process.stdout.write(`${renderJson(result, { chainId: cfg.chainId, outcome: result.outcome })}\n`);
      } else {
        process.stdout.write(
          `${renderTable(result.checks, [
            { key: "name", label: "check", width: 24 },
            { key: "ok", label: "ok" },
            { key: "expected", label: "expected", width: 52 },
            { key: "observed", label: "observed", width: 60 },
          ])}\n`,
        );
        process.stdout.write(`${result.outcome}  ${result.explorer}\n`);
      }
      if (result.outcome === "mismatch") process.exitCode = 1;
      if (result.outcome === "unverifiable") process.exitCode = 3;
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
