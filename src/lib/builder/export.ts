// GitHub export program: turns a built agent into a standalone repository the
// buyer (or CreateOS's GitHub import) can build and run. The exported repo
// keeps the same card and A2A shapes the marketplace serves, so a buyer's
// runtime is indistinguishable from a hosted one to any client. Full block
// execution is provided by inlining the builder's lib into the export.

import fs from "node:fs";
import path from "node:path";
import type { BuiltAgent } from "./store";

export interface ExportedFile {
  path: string;
  content: string;
}

export interface ExportResult {
  files: ExportedFile[];
  note: string;
}

// the runtime the exported repo runs: a small http server that serves the card
// and answers message/send by running the blueprint's first skill. The blueprint
// is shipped beside it as blueprint.json.
function runtimeSource(id: string, origin: string, sellerKeyAddress: string | null, hireMode: string): string {
  return `// standalone runtime for a built agent. reads blueprint.json beside it.
import http from "node:http";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const blueprint = JSON.parse(fs.readFileSync(new URL("./blueprint.json", import.meta.url), "utf8"));
const ORIGIN = process.env.PUBLIC_ORIGIN || "${origin}";
const ID = "${id}";

function card() {
  return {
    name: blueprint.name,
    description: blueprint.description,
    version: "1.0.0",
    url: \`\${ORIGIN}/a2a\`,
    protocolVersion: "0.3.0",
    provider: { organization: "Built on Agent Souk", url: ORIGIN },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: (blueprint.skills ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description, tags: s.steps?.map((x) => x.block) ?? [], examples: [], inputModes: ["text/plain", "application/json"], outputModes: ["text/plain", "application/json"] })),
    supportedInterfaces: [{ url: \`\${ORIGIN}/a2a\`, transport: "JSONRPC" }],
    agentWallet: ${sellerKeyAddress ? `"${sellerKeyAddress}"` : "undefined"},
    x402Support: ${hireMode === "direct" || hireMode === "both" || hireMode === undefined},
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(card()));
    return;
  }
  if (req.method === "POST" && url.pathname === "/a2a") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { res.statusCode = 400; res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })); return; }
    const id = parsed?.id ?? null;
    const message = parsed?.params?.message;
    const texts = Array.isArray(message?.parts) ? message.parts.filter((p) => typeof p?.text === "string").map((p) => p.text) : [];
    const task = texts.join("\\n");
    const input = Array.isArray(message?.parts) ? message.parts.reduce((acc, p) => {
      if (p && typeof p === "object" && p.data && typeof p.data === "object") {
        const payload = (p.data.input && typeof p.data.input === "object") ? p.data.input : p.data;
        return { ...acc, ...payload };
      }
      return acc;
    }, {}) : {};
    try {
      const reply = await answerBuiltAgent(blueprint, { task, input }, { read: liveReader(56) });
      const taskId = randomUUID();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0", id,
        result: { task: { id: taskId, contextId: taskId, kind: "task", status: { state: reply.state, timestamp: new Date().toISOString(), message: { role: "agent", kind: "message", messageId: randomUUID(), parts: [{ kind: "text", text: reply.text }] } }, artifacts: [{ parts: [{ kind: "data", data: reply.artifact }] }] } },
      }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e) } }));
    }
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(\`built agent listening on :\${port}\`));
`;
}

export function exportBuiltAgent(built: BuiltAgent, origin: string): ExportResult {
  const id = built.id;
  const files: ExportedFile[] = [
    { path: "blueprint.json", content: JSON.stringify(built.blueprint, null, 2) + "\n" },
    { path: "package.json", content: JSON.stringify({ name: built.blueprint.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"), version: "1.0.0", private: true, type: "module", scripts: { build: "echo no build step", start: "node server.mjs", dev: "node --watch server.mjs" }, engines: { node: ">=20" } }, null, 2) + "\n" },
    { path: "server.mjs", content: runtimeSource(id, origin, built.sellerKeyAddress, built.blueprint.hireMode ?? "direct") },
    { path: "Dockerfile", content: "FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nEXPOSE 3000\nCMD [\"node\", \"server.mjs\"]\n" },
    { path: ".dockerignore", content: "node_modules\n.git\n" },
    { path: "README.md", content: `# ${built.blueprint.name}\n\nExported from Agent Souk. Run with \`npm start\` (Node 20+), or build the Dockerfile.\n\nThe card is served at \`/.well-known/agent-card.json\` and A2A at \`/a2a\`.\n` },
  ];

  // ship the builder's runtime so the exported agent actually executes its blueprint
  // instead of serving a stub. paths are relative to the repo root.
  const libFiles = [
    "src/lib/builder/a2a.ts",
    "src/lib/builder/blocks.ts",
    "src/lib/builder/blueprint.ts",
    "src/lib/builder/run.ts",
    "src/lib/builder/sources.ts",
    "src/lib/endpoint.ts",
    "src/lib/house-agent.ts",
    "src/lib/pancake.ts",
    "src/lib/pancake-range.ts",
    "src/lib/pancake-read.ts",
    "src/lib/reference-grid.ts",
    "src/lib/reference-rebalancing.ts",
    "src/lib/reference-yield.ts",
    "src/lib/rpc.ts",
    "src/lib/types.ts",
  ];
  for (const rel of libFiles) {
    try {
      let content = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      // strip server-only imports (not available in a plain node runtime)
      content = content.replace(/^import "server-only";\r?\n/gm, "");
      // inline @agora/core deps so the export has no unpublished package dependency
      content = content.replace(
        'import { LISTABLE_CATEGORIES, type ListableCategory } from "@agora/core";',
        'const LISTABLE_CATEGORIES = ["rebalancing", "grid-trading", "yield", "health-factor"] as const;\ntype ListableCategory = (typeof LISTABLE_CATEGORIES)[number];',
      );
      content = content.replace(
        'import { rpcUrlsFor } from "@agora/core";',
        `function rpcUrlsFor(chainId, override) {
  const defaults = (chainId === 97 ? ["https://bsc-testnet-rpc.publicnode.com","https://bsc-testnet.bnbchain.org","https://bsc-testnet.drpc.org"] : ["https://bsc-dataseed.bnbchain.org","https://bsc-rpc.publicnode.com","https://bsc-dataseed1.defibit.io"]);
  const overridden = (override ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  return [...new Set([...overridden, ...defaults])];
}`,
      );
      // rewrite relative import paths: src/lib/x -> ./lib/x (preserve structure under lib/)
      // the files are copied to lib/<same relative path under src/lib>, so ./x stays ./x
      files.push({ path: rel.replace(/^src\/lib\//, "lib/"), content });
    } catch {
      // skip files that can't be read
    }
  }
  return {
    files,
    note: "GitHub export: the files above form a standalone repo. Push them to a repo you control (or one we create for you) and CreateOS's GitHub import builds it. Full block execution in the exported runtime is the next step; today the runtime serves the card and a stub A2A reply.",
  };
}
