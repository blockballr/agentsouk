// A browser-invoked (WebMCP) listing is admitted to the shelf like any other,
// but the marketplace cannot call it. These pin the admission rules and the
// refusal a settled hire gets, so the honest label is not just a UI accident.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));

import { isShelfReady } from "../src/lib/agent-index";
import {
  BROWSER_INVOKED_DELIVERY_REFUSAL,
  NO_ENDPOINT_DELIVERY_REFUSAL,
  noEndpointDeliveryMessage,
} from "../src/lib/delivery";
import { shelfRefusalReason, summaryFromRegistration } from "../src/lib/scanner";
import type { RegistrationDraft } from "../src/lib/registry-write";

const WEB_DRAFT: RegistrationDraft = {
  name: "Range Keeper Browser",
  description: "Manages LP ranges and resets positions from a browser page.",
  category: "rebalancing",
  endpoint: "https://browser-agent.example/mcp",
  endpointKind: "web",
};

function summaryFor(draft: RegistrationDraft, tokenId = "7001") {
  return summaryFromRegistration({
    chainId: 97,
    tokenId,
    owner: "0xowner",
    registry: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
    draft,
    createdAt: "2026-09-27T00:00:00.000Z",
  });
}

describe("shelf admission for a web listing", () => {
  it("admits a web-only agent with a real category and a public endpoint", () => {
    expect(
      isShelfReady({ web_endpoint: "https://browser-agent.example/mcp", category: "yield" }),
    ).toBe(true);

    // the wizard path: the summary built from the confirmed draft carries the
    // web endpoint as its own kind, not mislabeled as A2A or MCP
    const s = summaryFor(WEB_DRAFT);
    expect(s.web_endpoint).toBe(WEB_DRAFT.endpoint);
    expect(s.a2a_endpoint).toBeNull();
    expect(s.mcp_server).toBeNull();
    expect(s.category).toBe("rebalancing");
    expect(isShelfReady(s)).toBe(true);
  });

  it("refuses a web-only agent whose endpoint is private or malformed", () => {
    expect(
      isShelfReady({ web_endpoint: "http://localhost:8080/page", category: "yield" }),
    ).toBe(false);
    expect(
      isShelfReady({ web_endpoint: "not a url", category: "yield" }),
    ).toBe(false);

    const s = summaryFor({ ...WEB_DRAFT, endpoint: "http://192.168.1.20/page" });
    expect(s.web_endpoint).toBe("http://192.168.1.20/page");
    expect(isShelfReady(s)).toBe(false);
    expect(shelfRefusalReason(s)).toMatch(/not publicly reachable/);
  });

  it("refuses a web-only agent with no real category", () => {
    expect(
      isShelfReady({ web_endpoint: "https://browser-agent.example/mcp", category: "general" }),
    ).toBe(false);
    expect(
      isShelfReady({ web_endpoint: "https://browser-agent.example/mcp", category: null }),
    ).toBe(false);

    const s = summaryFor({
      ...WEB_DRAFT,
      name: "Helper",
      description: "A general purpose assistant that answers anything at all.",
    });
    expect(isShelfReady(s)).toBe(false);
    expect(shelfRefusalReason(s)).toMatch(/general/);
  });

  it("still refuses an agent that declares no endpoint at all", () => {
    const s = summaryFor({ ...WEB_DRAFT, endpoint: "" });
    expect(s.web_endpoint).toBeNull();
    expect(isShelfReady(s)).toBe(false);
    expect(shelfRefusalReason(s)).toMatch(/no endpoint at all/);
  });
});

describe("delivery refusal for a browser-invoked agent", () => {
  it("names the browser-invoked case, not the generic empty-endpoint line", () => {
    const message = noEndpointDeliveryMessage({
      a2a_endpoint: null,
      mcp_server: null,
      web_endpoint: "https://browser-agent.example/mcp",
    });
    expect(message).toBe(BROWSER_INVOKED_DELIVERY_REFUSAL);
    expect(message).toMatch(/browser-invoked/);
    expect(message).toMatch(/cannot call it/);
    expect(message).not.toBe(NO_ENDPOINT_DELIVERY_REFUSAL);
  });

  it("keeps the generic line when there is no endpoint of any kind", () => {
    expect(noEndpointDeliveryMessage({ a2a_endpoint: null, mcp_server: null })).toBe(
      NO_ENDPOINT_DELIVERY_REFUSAL,
    );
  });

  it("still delivers over a callable endpoint when a web service is also published", () => {
    expect(
      noEndpointDeliveryMessage({
        a2a_endpoint: "https://agent.example/a2a",
        web_endpoint: "https://agent.example/page",
      }),
    ).toBe(NO_ENDPOINT_DELIVERY_REFUSAL);
  });
});
