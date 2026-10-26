import { NextRequest, NextResponse } from "next/server";
import { validateCustomManifest, getCustomAgent } from "@/lib/builder/custom";
import { verifyWalletAuth } from "@/lib/builder/auth";
import { targetChainId } from "@/lib/types";
import { vaultCardSkill, vaultEnvExample, vaultPackageJson, vaultReadme, vaultRunnerSource, vaultServerSource, vaultStrategySource } from "@/lib/builder/vault-export";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

function safeIdent(name: string, i: number): string {
  const base = name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "") || `action_${i}`;
  return /^[0-9]/.test(base) ? `a_${base}` : base;
}

function escapeJs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

function slugify(name: string, owner: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (base + "-" + owner.slice(2, 10)).slice(0, 48);
}


export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as {
    owner?: unknown;
    manifest?: unknown;
    id?: unknown;
    image?: unknown;
  } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, error: "request body must be a JSON object" }, 400);
  }
  if (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, ok: false, error: "owner must be a wallet address" }, 400);
  }
  const owner = body.owner;
  const id = typeof body.id === "string" ? body.id : null;
  const auth = await verifyWalletAuth(req, owner, "export", id ?? "");
  if (!auth.ok) return json({ success: false, ok: false, error: auth.error }, 401);

  const check = validateCustomManifest(body.manifest);
  if (!check.ok) {
    return json({ success: false, ok: false, error: check.errors.join("; "), errors: check.errors }, 400);
  }
  const manifest = check.manifest;

  if (id) {
    const existing = await getCustomAgent(id);
    if (!existing) return json({ success: false, ok: false, error: "agent not found" }, 404);
    if (existing.owner.toLowerCase() !== owner.toLowerCase()) {
      return json({ success: false, ok: false, error: "owner does not match" }, 403);
    }
  }

  const slug = slugify(manifest.name, owner);
  const files: { path: string; content: string }[] = [];

  // manifest.json
  files.push({ path: "manifest.json", content: JSON.stringify(manifest, null, 2) + "\n" });

  // agent-card.json (static, host placeholder)
  const card = {
    name: manifest.name,
    description: manifest.description,
    version: "1.0.0",
    url: "https://YOUR_HOST/a2a",
    protocolVersion: "0.3.0",
    provider: { organization: "Built on Agent Souk", url: "https://YOUR_HOST" },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: manifest.payment === "vault"
      ? [vaultCardSkill(manifest.category)]
      : manifest.actions.map((a) => ({
          id: a.name,
          name: a.name,
          description: `${a.venue}: ${a.functions.join(", ")}`,
          tags: a.contracts,
          examples: [],
          inputModes: ["text/plain", "application/json"],
          outputModes: ["text/plain", "application/json"],
        })),
    supportedInterfaces: [{ url: "https://YOUR_HOST/a2a", transport: "JSONRPC" }],
    x402Support: manifest.payment === "x402",
    ...(manifest.wallet !== "none" ? { agentWallet: "set via AGENT_PRIVATE_KEY env" } : {}),
  };
  files.push({ path: "agent-card.json", content: JSON.stringify(card, null, 2) + "\n" });

  // actions.mjs
  const actionEntries = manifest.actions.map((a, i) => {
    const fn = safeIdent(a.name, i);
    return `  ${JSON.stringify(a.name)}: async ({ task, input }) => {
    // venue: ${escapeJs(a.venue)}
    // contracts: ${a.contracts.join(", ") || "(none)"}
    // functions: ${a.functions.join(", ") || "(none)"}
    // maxValueUsd: ${a.maxValueUsd}
    throw new NotImplemented(${JSON.stringify(a.name)});
  },`;
  }).join("\n");
  const actionsFile = `// Implement these to make the agent execute on chain.
// Each function receives { task, input } and must return { text, state, artifact }.
// maxValueUsd is the per-action cap from the manifest. Enforce it before any write.
export class NotImplemented extends Error {
  constructor(name) { super(name); this.name = "NotImplemented"; }
}

export const actions = {
${actionEntries}
};
`;
  files.push({ path: "actions.mjs", content: actionsFile });

  // server.mjs
  const normalServerFile = `// Standalone runtime for a custom agent. Reads manifest.json beside it.
import http from "node:http";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const manifest = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const { actions, NotImplemented } = await import("./actions.mjs");

function origin() { return (process.env.PUBLIC_ORIGIN || "").replace(/\\/+$/, ""); }

function card() {
  const o = origin();
  return {
    name: manifest.name,
    description: manifest.description,
    version: "1.0.0",
    url: o ? o + "/a2a" : "/a2a",
    protocolVersion: "0.3.0",
    provider: { organization: "Built on Agent Souk", url: o || "/" },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: (manifest.actions || []).map((a) => ({
      id: a.name,
      name: a.name,
      description: a.venue + ": " + (a.functions || []).join(", "),
      tags: a.contracts || [],
      examples: [],
      inputModes: ["text/plain", "application/json"],
      outputModes: ["text/plain", "application/json"],
    })),
    supportedInterfaces: [{ url: o ? o + "/a2a" : "/a2a", transport: "JSONRPC" }],
    x402Support: manifest.payment === "x402",
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, agent: manifest.name, wallet: process.env.AGENT_PRIVATE_KEY ? "configured" : null }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(card()));
    return;
  }
  if (req.method === "POST" && url.pathname === "/a2a") {
    const raw = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
      return;
    }
    const id = parsed && parsed.id != null ? parsed.id : null;
    const message = parsed && parsed.params ? parsed.params.message : null;
    const texts = Array.isArray(message && message.parts) ? message.parts.filter((p) => typeof p && p.text === "string").map((p) => p.text) : [];
    const task = texts.join("\\n");
    const input = Array.isArray(message && message.parts) ? message.parts.reduce((acc, p) => {
      if (p && typeof p === "object" && p.data && typeof p.data === "object") {
        const payload = (p.data.input && typeof p.data.input === "object") ? p.data.input : p.data;
        return Object.assign({}, acc, payload);
      }
      return acc;
    }, {}) : {};
    const actionName = (input && input.action) || (manifest.actions && manifest.actions[0] && manifest.actions[0].name) || null;
    const fn = actionName ? (actions || {})[actionName] : null;
    if (!actionName || typeof fn !== "function") {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + (actionName || "(none)") } }));
      return;
    }
    try {
      const reply = await fn({ task, input });
      const taskId = randomUUID();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0", id,
        result: { task: { id: taskId, contextId: taskId, kind: "task", status: { state: (reply && reply.state) || "completed", timestamp: new Date().toISOString(), message: { role: "agent", kind: "message", messageId: randomUUID(), parts: [{ kind: "text", text: (reply && reply.text) || "" }] } }, artifacts: [{ parts: [{ kind: "data", data: (reply && reply.artifact) || {} }] }] } },
      }));
    } catch (e) {
      const isNotImpl = e && (e.name === "NotImplemented" || (e instanceof NotImplemented));
      res.statusCode = isNotImpl ? 422 : 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: isNotImpl ? -32001 : -32603, message: isNotImpl ? "action not implemented yet: " + actionName : String(e) } }));
    }
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log("custom agent listening on :" + port));
`;
    const serverFile = manifest.payment === "vault"
      ? vaultServerSource(manifest.category, "https://YOUR_HOST")
      : normalServerFile;
    files.push({ path: "server.mjs", content: serverFile });

    if (manifest.payment === "vault") {
      files.push({ path: "vault.mjs", content: vaultRunnerSource(targetChainId()) });
      files.push({ path: "strategy.mjs", content: vaultStrategySource() });
    }

    files.push({
      path: "package.json",
      content: manifest.payment === "vault"
        ? vaultPackageJson(slug)
        : JSON.stringify(
            {
              name: slug,
              version: "1.0.0",
              private: true,
              type: "module",
              scripts: { start: "node server.mjs", dev: "node --watch server.mjs" },
              engines: { node: ">=20" },
            },
            null,
            2,
          ) + "\n",
    });

    files.push({ path: "Dockerfile", content: manifest.payment === "vault" ? "FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install --omit=dev\nEXPOSE 3000\nCMD [\"node\", \"server.mjs\"]\n" : "FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nEXPOSE 3000\nCMD [\"node\", \"server.mjs\"]\n" });
    files.push({ path: ".dockerignore", content: "node_modules\n.git\n.env\n" });
    files.push({
      path: ".env.example",
      content: manifest.payment === "vault" ? vaultEnvExample() : "PORT=3000\nPUBLIC_ORIGIN=\nRPC_URL=\nAGENT_PRIVATE_KEY=\n",
    });

    const normalReadme = `# ${manifest.name}

Exported from Agent Souk. This is a standalone agent you own and deploy.

## Run locally

\`\`\`
npm start
curl http://localhost:3000/health
curl http://localhost:3000/.well-known/agent-card.json
\`\`\`

## Deploy anywhere

This repo has no build step. Any Node 20 host works.

- Railway: new project, deploy from repo, set PUBLIC_ORIGIN to the assigned URL.
- Render: new Web Service, runtime Node, start command \`npm start\`.
- Fly.io: \`fly launch\` then \`fly deploy\`.
- Docker: \`docker build -t ${slug} . && docker run -p 3000:3000 ${slug}\`.
- Your own box: \`node server.mjs\` behind a reverse proxy.

Set \`PUBLIC_ORIGIN\` to the public URL so the card resolves. Set \`RPC_URL\` only
if you want a private RPC. Set \`AGENT_PRIVATE_KEY\` only if an action writes on
chain.

## Make it execute

\`actions.mjs\` ships with one function per declared action, each throwing
\`NotImplemented\`. Replace those bodies with real on-chain logic. The
\`maxValueUsd\` cap is written next to each function; enforce it before any write.

Registering this agent on chain proves ownership. It does not prove execution.
Execution is proven by completed jobs.

## Legacy option

CreateOS deploy is archived. If you still have a working CreateOS account you
can import this repo through its GitHub import instead.
`;
    files.push({ path: "README.md", content: manifest.payment === "vault" ? vaultReadme(manifest.name) : normalReadme });

  return json({ success: true, ok: true, slug, files });
}
