// The host rules run at the edge, so they are asserted here rather than by
// opening a browser and waiting for a redirect to happen.
import { describe, expect, it } from "vitest";
import { onRequest } from "../apps/web/functions/_middleware";

type Context = Parameters<typeof onRequest>[0];

async function call(url: string) {
  let passed = false;
  const response = await onRequest({
    request: new Request(url),
    next: async () => {
      passed = true;
      return new Response("app", { status: 200 });
    },
    env: {},
    params: {},
  } as Context);
  return { response, passed };
}

describe("host routing", () => {
  it("sends the app host /docs to the manual with a 308, before the bundle boots", async () => {
    const { response, passed } = await call("https://app.agentsouk.xyz/docs");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://docs.agentsouk.xyz/");
    expect(passed).toBe(false);
  });

  it("keeps the manual path when the app host deep links into it", async () => {
    const { response } = await call("https://app.agentsouk.xyz/docs/manifest");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://docs.agentsouk.xyz/manifest");
  });

  it("sends the apex /docs to the manual and keeps the path", async () => {
    const { response } = await call("https://agentsouk.xyz/docs/manifest");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://docs.agentsouk.xyz/manifest");
  });

  it("moves the app root to the shelf", async () => {
    const { response } = await call("https://app.agentsouk.xyz/");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://app.agentsouk.xyz/agents");
  });

  it("leaves app routes and api calls alone", async () => {
    const shelf = await call("https://app.agentsouk.xyz/agents");
    expect(shelf.passed).toBe(true);
    expect(shelf.response.status).toBe(200);

    const api = await call("https://app.agentsouk.xyz/api/agents");
    expect(api.passed).toBe(true);
    expect(api.response.status).toBe(200);
  });

  it("leaves the apex homepage and its assets alone", async () => {
    const home = await call("https://agentsouk.xyz/");
    expect(home.passed).toBe(true);

    const asset = await call("https://agentsouk.xyz/favicon.svg");
    expect(asset.passed).toBe(true);
  });
});
