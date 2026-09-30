// The site calls the API cross-origin, straight from the browser, so every site
// origin must be allowed without depending on WEB_ORIGIN, and the DELETE that
// revoke and relist send must pass the preflight.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(webOrigin?: string) {
  if (webOrigin !== undefined) vi.stubEnv("WEB_ORIGIN", webOrigin);
  return import("../src/proxy");
}

function request(origin: string, method = "GET") {
  return new NextRequest("https://api.agentsouk.xyz/api/stats", {
    method,
    headers: { origin, "access-control-request-method": "DELETE" },
  });
}

describe("cors on the api", () => {
  it("allows the main domain even when WEB_ORIGIN names only pages.dev", async () => {
    const { proxy } = await load("https://agentsouk.pages.dev");
    const res = proxy(request("https://agentsouk.xyz"));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://agentsouk.xyz");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("answers a DELETE preflight and caches it for a day", async () => {
    const { proxy } = await load("https://agentsouk.pages.dev");
    const res = proxy(request("https://agentsouk.xyz", "OPTIONS"));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });

  it("gives no origin to a site that is not on the list", async () => {
    const { proxy } = await load("https://agentsouk.pages.dev");
    const res = proxy(request("https://elsewhere.example"));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
