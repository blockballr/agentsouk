// CreateOS (NodeOps) client: the programmatic surface that replaces the fenced
// browser agent. Every operation goes through the MCP endpoint with an API key,
// so the marketplace never holds a CreateOS password and the buyer never visits
// nodeops.network.

const MCP_ENDPOINT = "https://api-createos.nodeops.network/mcp";

export interface CreateosResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// sessions are per API key and persist across calls; a 401/400 on session
// expiry re-initialises automatically
const sessions = new Map<string, string>();

async function ensureSession(apiKey: string): Promise<string | null> {
  const cached = sessions.get(apiKey);
  if (cached) return cached;
  try {
    const res = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Api-Key": apiKey, "accept": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent-souk", version: "1.0.0" } } }),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) { sessions.set(apiKey, sid); return sid; }
    return null;
  } catch {
    return null;
  }
}

export async function createosCall(apiKey: string, tool: string, args: Record<string, unknown> = {}): Promise<CreateosResult> {
  if (!apiKey) return { ok: false, error: "CreateOS API key missing" };
  let sid = await ensureSession(apiKey);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "X-Api-Key": apiKey,
        "accept": "application/json",
      };
      if (sid) headers["Mcp-Session-Id"] = sid;
      const res = await fetch(MCP_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
      });
      const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: { message?: string } };
      if (res.status === 400 && /session/i.test(body?.error?.message ?? "")) {
        sessions.delete(apiKey);
        sid = await ensureSession(apiKey);
        continue;
      }
      if (!res.ok || body.error) {
        return { ok: false, error: body.error?.message ?? `createos ${res.status}` };
      }
      return { ok: true, data: body.result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: false, error: "session init failed" };
}

// convenience wrappers for the operations the bridge uses
export const createos = {
  listProjects: (apiKey: string) => createosCall(apiKey, "ListProjects", {}),
  createProject: (apiKey: string, args: Record<string, unknown>) => createosCall(apiKey, "CreateProject", args),
  triggerLatestDeployment: (apiKey: string, args: Record<string, unknown>) => createosCall(apiKey, "TriggerLatestDeployment", args),
  uploadDeploymentFiles: (apiKey: string, args: Record<string, unknown>) => createosCall(apiKey, "UploadDeploymentFiles", args),
  getBuildLogs: (apiKey: string, args: Record<string, unknown>) => createosCall(apiKey, "GetBuildLogs", args),
  getDeploymentLogs: (apiKey: string, args: Record<string, unknown>) => createosCall(apiKey, "GetDeploymentLogs", args),
  createProjectEnvironment: (apiKey: string, args: Record<string, unknown>) => createosCall(apiKey, "CreateProjectEnvironment", args),
  updateProjectEnvironmentEnvironmentVariables: (apiKey: string, args: Record<string, unknown>) => createosCall(apiKey, "UpdateProjectEnvironmentEnvironmentVariables", args),
  updateProjectEnvironmentResources: (apiKey: string, args: Record<string, unknown>) => createosCall(apiKey, "UpdateProjectEnvironmentResources", args),
  listConnectedGithubAccounts: (apiKey: string) => createosCall(apiKey, "ListConnectedGithubAccounts", {}),
  listGithubRepositories: (apiKey: string, args: Record<string, unknown> = {}) => createosCall(apiKey, "ListGithubRepositories", args),
  listGithubRepositoryBranches: (apiKey: string, args: Record<string, unknown>) => createosCall(apiKey, "ListGithubRepositoryBranches", args),
  installGithubApp: (apiKey: string) => createosCall(apiKey, "InstallGithubApp", {}),
  createDomain: (apiKey: string, args: Record<string, unknown>) => createosCall(apiKey, "CreateDomain", args),
  refreshDomain: (apiKey: string, args: Record<string, unknown>) => createosCall(apiKey, "RefreshDomain", args),
  getCurrentUser: (apiKey: string) => createosCall(apiKey, "GetCurrentUser", {}),
};
