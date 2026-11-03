// The host rules run at the edge, so they are asserted here rather than by
// opening a browser and waiting for a redirect to happen.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { onRequest } from "../apps/web/functions/_middleware";

type Context = Parameters<typeof onRequest>[0];

// the real head, so a reformat that breaks the rewrite fails here instead of on a share
const PAGE = readFileSync(new URL("../apps/web/index.html", import.meta.url), "utf8");

async function call(url: string, body = "app", contentType = "text/plain") {
  let passed = false;
  const response = await onRequest({
    request: new Request(url),
    next: async () => {
      passed = true;
      return new Response(body, { status: 200, headers: { "content-type": contentType } });
    },
    env: {},
    params: {},
  } as Context);
  return { response, passed };
}

async function questPage() {
  const { response } = await call("https://app.agentsouk.xyz/quest", PAGE, "text/html; charset=utf-8");
  return response.text();
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

describe("quest card", () => {
  it("writes the quest tags into the html a crawler receives", async () => {
    const html = await questPage();
    expect(html).toContain('<title>Set and Earn on Agent Souk</title>');
    expect(html).toContain('<link rel="canonical" href="https://app.agentsouk.xyz/quest" />');
    expect(html).toContain('<meta property="og:title" content="Set and Earn on Agent Souk" />');
    expect(html).toContain('<meta property="og:url" content="https://app.agentsouk.xyz/quest" />');
    expect(html).toContain('<meta property="og:image" content="https://app.agentsouk.xyz/quest-og.png" />');
    expect(html).toContain('<meta name="twitter:image" content="https://app.agentsouk.xyz/quest-og.png" />');
    expect(html).toContain("Every stamp is backed by a settled hire.");
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).not.toContain("https://agentsouk.xyz/og-image.png");
  });

  it("leaves every other page on the site card", async () => {
    const { response } = await call("https://app.agentsouk.xyz/agents", PAGE, "text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain('<meta property="og:title" content="Agent Souk - the open market for working agents" />');
    expect(html).toContain('<meta property="og:image" content="https://agentsouk.xyz/og-image.png" />');
    expect(html).not.toContain("quest-og.png");
  });

  it("ships the card at the size the tags declare", () => {
    const png = readFileSync(new URL("../apps/web/public/quest-og.png", import.meta.url));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});
