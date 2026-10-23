import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { NextRequest } from "next/server";
import { POST as validateRoute } from "../src/app/api/builder/custom/validate/route";
import { POST as buildRoute } from "../src/app/api/builder/custom/build/route";
import { POST as deployRoute } from "../src/app/api/builder/custom/deploy/route";
import { GET as statusRoute } from "../src/app/api/builder/custom/status/route";
import { POST as registerRoute } from "../src/app/api/builder/custom/register/route";
import { GET as agentRoute } from "../src/app/api/builder/custom/agent/[id]/route";
import { resetCustomAgentsForTests } from "../src/lib/builder/custom";

const MANIFEST = {
  name: "Range LP opener",
  category: "rebalancing",
  description: "Opens LP",
  runtime: "node20",
  entrypoint: "server.mjs",
  endpoint: "/a2a",
  wallet: "agent",
  payment: "job",
  deliverable: "pos",
  release: "on chain",
  actions: [{ name: "open-range", venue: "v", contracts: ["0xabc"], functions: ["openPosition"], maxValueUsd: 500 }],
  env: ["RPC_URL"],
  healthcheck: "/health",
};

const OWNER = "0x4bb30e3b3bc22082c1935fe3be7c07448e69c862";

function post(path: string, body: unknown) {
  return new NextRequest(`https://api.agentsouk.xyz${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => resetCustomAgentsForTests());

describe("custom builder smoke", () => {
  it("validate ok", async () => {
    const res = await validateRoute(post("/api/builder/custom/validate", { manifest: MANIFEST }));
    expect(res.status).toBe(200);
  });
  it("validate invalid", async () => {
    const res = await validateRoute(post("/api/builder/custom/validate", { manifest: { name: "x" } }));
    expect(res.status).toBe(422);
  });
  it("validate bare invalid body", async () => {
    const res = await validateRoute(post("/api/builder/custom/validate", "nope" as any));
    // body parse yields null? Actually string body parsed as json string -> object? NextRequest body string -> json() returns string
    expect([400, 422]).toContain(res.status);
  });
  it("build", async () => {
    const res = await buildRoute(post("/api/builder/custom/build", { owner: OWNER, manifest: MANIFEST }));
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.buildId || b.id).toBeTruthy();
  });
  it("deploy no hosting -> 503", async () => {
    const res = await deployRoute(post("/api/builder/custom/deploy", { owner: OWNER, manifest: MANIFEST }));
    expect(res.status).toBe(503);
  });
  it("status missing params -> 400", async () => {
    const res = await statusRoute(new NextRequest("https://api.agentsouk.xyz/api/builder/custom/status"));
    expect(res.status).toBe(400);
  });
  it("register prepare", async () => {
    const res = await registerRoute(post("/api/builder/custom/register", { owner: OWNER, manifest: MANIFEST }));
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.prepared).toBe(true);
  });
  it("agent not found", async () => {
    const res = await agentRoute(new NextRequest("https://api.agentsouk.xyz/api/builder/custom/agent/0000000000000000"), { params: Promise.resolve({ id: "0000000000000000" }) });
    expect(res.status).toBe(404);
  });
});