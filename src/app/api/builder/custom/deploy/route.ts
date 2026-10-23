import { NextRequest, NextResponse } from "next/server";
import { validateCustomManifest, saveCustomAgent, updateCustomAgent } from "@/lib/builder/custom";
import { getHosting } from "@/lib/builder/hosting";
import { createos, createosCall } from "@/lib/builder/createos";
import { pickPublicOrigin } from "@/lib/house-agent";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// POST /api/builder/custom/deploy  { owner, manifest, buildId?, files? }
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { owner?: unknown; manifest?: unknown; buildId?: unknown; files?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, ok: false, error: "request body must be a JSON object" }, 400);
  }
  if (typeof body.owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(body.owner)) {
    return json({ success: false, ok: false, error: "owner must be a wallet address" }, 400);
  }
  const owner = body.owner.toLowerCase();
  const manifestInput = body.manifest !== undefined ? body.manifest : body;
  const check = validateCustomManifest(manifestInput);
  if (!check.ok) {
    return json({ success: false, ok: false, valid: false, errors: check.errors, error: check.errors[0] }, 422);
  }

  const files = Array.isArray(body.files) && body.files.length > 0
    ? (body.files as { path: string; content: string }[])
    : [
        { path: "package.json", content: JSON.stringify({ name: check.manifest.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"), version: "1.0.0", private: true, type: "module", scripts: { build: "echo no build step", start: "node server.mjs" }, engines: { node: ">=20" } }, null, 2) },
        { path: "server.mjs", content: "import http from 'node:http';\nconst server = http.createServer((req,res)=>{ if (req.url==='/health') { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ok:true})); return; } res.statusCode=404; res.end('not found'); });\nserver.listen(Number(process.env.PORT||3000));\n" },
      ];

  try {
    const hosting = await getHosting(owner);
    const apiKey = hosting?.createosApiKey ?? process.env.CREATEOS_API_KEY ?? null;
    if (!apiKey) {
      return json({ success: false, ok: false, error: "no CreateOS API key on file; provision hosting first" }, 503);
    }

    const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
    const slug = (check.manifest.name.toLowerCase().replace(/[^a-z0-9-]/g, "-") + "-" + owner.slice(2, 10)).slice(0, 32);
    const project = await createos.createProject(apiKey, {
      body: {
        uniqueName: slug,
        displayName: check.manifest.name,
        type: "upload",
        settings: { hasDockerfile: false, runtime: "node:20", port: 3000, runCommand: "npm start", installCommand: "npm install" },
      },
    });
    if (!project.ok) {
      return json({ success: false, ok: false, error: project.error ?? "create project failed" }, 502);
    }
    let projectId: string | null = null;
    const text = (project.data as { content?: { text?: string }[] } | undefined)?.content?.[0]?.text;
    if (text) {
      try { projectId = JSON.parse(text)?.data?.id ?? null; } catch { /* ignore */ }
    }
    if (!projectId) {
      return json({ success: false, ok: false, error: "CreateOS did not return a project id" }, 502);
    }

    const upload = await createos.uploadDeploymentFiles(apiKey, {
      project_id: projectId,
      body: { files: files.map((f) => ({ path: f.path, content: f.content })) },
    });
    if (!upload.ok) {
      return json({ success: false, ok: false, error: upload.error ?? "upload failed" }, 502);
    }

    let deploymentId: string | null = null;
    let status = "building";
    let endpoint: string | null = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const list = await createosCall(apiKey, "ListDeployments", { project_id: projectId });
      const d = (list.data as { content?: { text?: string }[] } | undefined)?.content?.[0]?.text;
      let parsed: { data?: { data?: { id: string; status: string; extra?: { endpoint?: string } }[] } } = {};
      if (d) { try { parsed = JSON.parse(d); } catch { /* ignore */ } }
      const dep = parsed?.data?.data?.[0];
      if (dep) {
        deploymentId = dep.id;
        status = dep.status;
        endpoint = dep.extra?.endpoint ?? endpoint;
        if (status === "deployed" || status === "failed" || status === "build_error") break;
      }
    }

    const agent = await saveCustomAgent(owner, check.manifest, typeof body.buildId === "string" ? body.buildId : null);
    await updateCustomAgent(agent.id, {
      deployment: { ok: status === "deployed", projectId, url: endpoint, error: status === "deployed" ? null : status },
    });

    return json({
      success: status === "deployed",
      ok: status === "deployed",
      id: agent.id,
      agentId: agent.id,
      projectId,
      deploymentId,
      status,
      endpoint: endpoint ?? `${origin.replace(/\/+$/, "")}/api/built/${agent.id}/a2a`,
      healthcheck: check.manifest.healthcheck,
    }, status === "deployed" ? 200 : 502);
  } catch (e) {
    return json({ success: false, ok: false, error: e instanceof Error ? e.message : "deploy failed" }, 503);
  }
}