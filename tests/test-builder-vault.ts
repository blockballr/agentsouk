// the vault lane is an addition, not a replacement. a job seller keeps the
// runtime and card it had, and only a vault build gets the vault card, the
// shipped SDK and the bounded runner.
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/builder/auth", () => ({
  verifyWalletAuth: async () => ({ ok: true }),
}));

import { NextRequest } from "next/server";
import { answerBuiltAgent, builtAgentCard } from "../src/lib/builder/a2a";
import { validateBlueprint, type Blueprint } from "../src/lib/builder/blueprint";
import { exportBuiltAgent } from "../src/lib/builder/export";
import { POST as customExport } from "../src/app/api/builder/custom/export/route";
import type { BuiltAgent } from "../src/lib/builder/store";

const WALLET = "0x1111111111111111111111111111111111111111";

const base = {
  version: 1,
  name: "Souk Weight Keeper",
  description:
    "Keeps a two-asset position at equal weight on chain. Trims the heavier side when drift leaves a band.",
  skills: [
    {
      id: "check-drift",
      name: "Drift check",
      description: "Works out how far a two-asset position has drifted from equal weight.",
      inputs: [
        { id: "valueAUsd", label: "Value in token A", type: "number", required: true, description: "value of the first token in USD" },
        { id: "valueBUsd", label: "Value in token B", type: "number", required: true, description: "value of the second token in USD" },
        { id: "targetAPercent", label: "Target share of A", type: "number", required: true, description: "target share of asset A, above 0 and below 100" },
      ],
      reads: [],
      steps: [
        {
          id: "drift",
          block: "drift-check",
          args: { valueAUsd: { ref: "input.valueAUsd" }, valueBUsd: { ref: "input.valueBUsd" }, targetAPercent: { ref: "input.targetAPercent" } },
        },
      ],
      answer: "The position sits at {drift.currentAPercent}% in A and {drift.state}.",
      example: { valueAUsd: 600, valueBUsd: 400, targetAPercent: 50 },
    },
  ],
};

function blueprint(hireMode: "direct" | "job" | "both" | "vault", category = "rebalancing"): Blueprint {
  const check = validateBlueprint({ ...base, category, hireMode });
  if (!check.ok) throw new Error(check.errors.join("; "));
  return check.blueprint;
}

function built(mode: "direct" | "job" | "vault"): BuiltAgent {
  return {
    id: "0123456789abcdef",
    owner: WALLET,
    blueprint: blueprint(mode),
    sellerKeyAddress: mode === "vault" ? null : WALLET,
    createdAt: "2026-10-25T00:00:00.000Z",
  };
}

describe("a vault build is a vault build", () => {
  it("accepts a rebalancing strategy", () => {
    expect(blueprint("vault").hireMode).toBe("vault");
  });

  it("refuses a category the vault runner does not implement", () => {
    const check = validateBlueprint({ ...base, category: "yield", hireMode: "vault" });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors.join(" ")).toContain("rebalancing");
  });
});

describe("the card tells the truth about how the agent is hired", () => {
  it("a vault card carries one vault skill and no x402", () => {
    const card = builtAgentCard(blueprint("vault"), { origin: "https://api.example", id: "0123456789abcdef", sellerKeyAddress: WALLET });
    expect(card.skills.map((s: { id: string }) => s.id)).toEqual(["vault-execution"]);
    expect(card.x402Support).toBe(false);
    expect((card as { agentWallet?: string }).agentWallet).toBe(WALLET);
  });

  it("a job seller keeps negotiate and notify_funded", () => {
    const card = builtAgentCard(blueprint("job"), { origin: "https://api.example", id: "0123456789abcdef", sellerKeyAddress: WALLET });
    expect(card.skills.map((s: { id: string }) => s.id)).toContain("negotiate");
    expect(card.skills.map((s: { id: string }) => s.id)).toContain("notify_funded");
    expect(card.x402Support).toBe(false);
  });

  it("a direct seller keeps x402", () => {
    const card = builtAgentCard(blueprint("direct"), { origin: "https://api.example", id: "0123456789abcdef" });
    expect(card.x402Support).toBe(true);
    expect(card.skills.map((s: { id: string }) => s.id)).toEqual(["check-drift"]);
  });
});

describe("A2A answers through the vault, not per call", () => {
  it("a vault agent names the hire and sells nothing", async () => {
    const reply = await answerBuiltAgent(blueprint("vault"), { task: "run" });
    expect(reply.state).toBe("completed");
    expect(reply.text).toContain("HireVault");
    expect(reply.text).toContain("sells no per-call work");
    expect(reply.artifact).toMatchObject({ hire: "vault", readOnly: true });
  });

  it("a job seller still answers its own skill", async () => {
    const reply = await answerBuiltAgent(blueprint("job"), {
      task: "drift",
      input: { valueAUsd: 600, valueBUsd: 400, targetAPercent: 50 },
    });
    expect(reply.artifact).toMatchObject({ skill: "check-drift", status: "ok" });
  });
});

const dist = path.join(process.cwd(), "packages", "vault-sdk", "dist");

describe("the export keeps both runtimes", () => {
  it("a vault build ships the SDK, a card and a bounded runner", () => {
    if (!existsSync(dist)) return;
    const out = exportBuiltAgent(built("vault"), "https://api.example");
    const paths = out.files.map((f) => f.path);
    expect(paths).toContain("vault.mjs");
    expect(paths).toContain("strategy.mjs");
    expect(paths).toContain("vault-sdk/index.js");
    const pkg = JSON.parse(out.files.find((f) => f.path === "package.json")!.content);
    expect(pkg.dependencies.viem).toBeTruthy();
    expect(pkg.scripts.run).toContain("vault.mjs");
    const server = out.files.find((f) => f.path === "server.mjs")!.content;
    expect(server).toContain('x402Support: false');
    expect(server).toContain('id: "vault-execution"');
    expect(server).not.toContain("negotiate");
  });

  it("a job seller keeps the old runtime and gains no vault files", () => {
    const out = exportBuiltAgent(built("job"), "https://api.example");
    const paths = out.files.map((f) => f.path);
    expect(paths).not.toContain("vault.mjs");
    expect(paths).not.toContain("vault-sdk/index.js");
    const server = out.files.find((f) => f.path === "server.mjs")!.content;
    expect(server).toContain("answerBuiltAgent");
    expect(server).toContain('x402Support: false');
    const pkg = JSON.parse(out.files.find((f) => f.path === "package.json")!.content);
    expect(pkg.dependencies).toBeUndefined();
  });
});

const CUSTOM = {
  name: "Range Keeper",
  category: "rebalancing",
  description: "Keeps a two-asset position inside a drift band.",
  runtime: "node20",
  entrypoint: "server.mjs",
  endpoint: "/a2a",
  wallet: "agent",
  payment: "job",
  deliverable: "A report of the drift and the amount to move",
  release: "The report names both values and the direction",
  actions: [{ name: "open-range", venue: "pancakeswap-v3", contracts: ["0xabc"], functions: ["openPosition"], maxValueUsd: 500 }],
  env: ["RPC_URL"],
  healthcheck: "/health",
};

function customPost(manifest: Record<string, unknown>) {
  return new NextRequest("https://api.agentsouk.xyz/api/builder/custom/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner: WALLET, manifest }),
  });
}

describe("the custom export branches without touching the job path", () => {
  it("a job seller keeps its action card and server", async () => {
    const res = await customExport(customPost(CUSTOM));
    expect(res.status).toBe(200);
    const body = await res.json();
    const card = JSON.parse(body.files.find((f: { path: string }) => f.path === "agent-card.json").content);
    expect(card.skills.map((s: { id: string }) => s.id)).toEqual(["open-range"]);
    expect(card.x402Support).toBe(false);
    expect(body.files.map((f: { path: string }) => f.path)).not.toContain("vault.mjs");
    const server = body.files.find((f: { path: string }) => f.path === "server.mjs").content;
    expect(server).toContain("actions");
  });

  it("a vault build gets a vault card, a runner and the SDK", async () => {
    const res = await customExport(customPost({ ...CUSTOM, wallet: "vault", payment: "vault", actions: [] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const card = JSON.parse(body.files.find((f: { path: string }) => f.path === "agent-card.json").content);
    expect(card.skills.map((s: { id: string }) => s.id)).toEqual(["vault-execution"]);
    expect(card.x402Support).toBe(false);
    const paths = body.files.map((f: { path: string }) => f.path);
    expect(paths).toContain("vault.mjs");
    expect(paths).toContain("strategy.mjs");
    expect(paths).toContain("vault-sdk/index.js");
    const server = body.files.find((f: { path: string }) => f.path === "server.mjs").content;
    expect(server).toContain("vault-execution");
    expect(server).toContain("sells no per-call work");
  });
});
