import { NextRequest, NextResponse } from "next/server";
import { exportBuiltAgent } from "@/lib/builder/export";
import { getBuiltAgent } from "@/lib/builder/store";
import { getHosting } from "@/lib/builder/hosting";
import { createos } from "@/lib/builder/createos";
import { pickPublicOrigin } from "@/lib/house-agent";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// GET /api/builder/export?id=<built id>&deploy=1
// returns the files of a standalone repo for the built agent. When deploy=1 and
// the owner has a CreateOS API key on file, the export is also pushed to CreateOS
// via their MCP surface (CreateProject + UploadDeploymentFiles + TriggerLatestDeployment),
// replacing the fenced browser-agent fallback with the real API thread.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const deploy = req.nextUrl.searchParams.get("deploy") === "1";
  if (!id) return json({ success: false, error: "id is required" }, 400);
  try {
    const built = await getBuiltAgent(id);
    if (!built) return json({ success: false, error: "No agent is hosted at this address." }, 404);
    const origin = pickPublicOrigin([process.env.PUBLIC_API_URL, process.env.BASE_URL]);
    const result = exportBuiltAgent(built, origin);

    let deployment: unknown = null;
    if (deploy) {
      const hosting = await getHosting(built.owner);
      const apiKey = hosting?.createosApiKey ?? process.env.CREATEOS_API_KEY ?? null;
      if (!apiKey) {
        return json({ success: true, id: built.id, name: built.blueprint.name, ...result, deployment: { ok: false, error: "no CreateOS API key on file; provision hosting first" } });
      }
      const slug = (built.blueprint.name.toLowerCase().replace(/[^a-z0-9-]/g, "-") + "-" + built.id.slice(0, 8)).slice(0, 32);
      console.error("[export] slug=", slug, "name=", built.blueprint.name);
      const project = await createos.createProject(apiKey, {
        body: {
          uniqueName: slug,
          displayName: built.blueprint.name,
          type: "upload",
          settings: { hasDockerfile: false, runtime: "node:20", port: 3000, runCommand: "npm start", installCommand: "npm install" },
        },
      });
      console.error("[export] project=", JSON.stringify(project));
      if (!project.ok) return json({ success: true, id: built.id, name: built.blueprint.name, ...result, deployment: { ok: false, error: project.error } });
      // the MCP result nests the id inside content[0].text
      let projectId: string | null = null;
      const text = (project.data as { content?: { text?: string }[] } | undefined)?.content?.[0]?.text;
      if (text) {
        try { projectId = JSON.parse(text)?.data?.id ?? null; } catch { /* ignore */ }
      }
      if (!projectId) {
        return json({ success: true, id: built.id, name: built.blueprint.name, ...result, deployment: { ok: false, error: "CreateOS did not return a project id" } });
      }
      const upload = await createos.uploadDeploymentFiles(apiKey, {
        project_id: projectId,
        body: { files: result.files.map((f) => ({ path: f.path, content: f.content })) },
      });
      deployment = { ok: upload.ok, projectId, uploadError: upload.error };
    }

    return json({ success: true, id: built.id, name: built.blueprint.name, ...result, deployment });
  } catch (e) {
    console.error("[export] failed:", e instanceof Error ? e.message : String(e));
    return json({ success: false, error: e instanceof Error ? e.message : "export failed" }, 503);
  }
}
