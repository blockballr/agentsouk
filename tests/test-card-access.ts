// A card that declares its own access is shown as gated: the seller issues the
// credentials, the marketplace holds none, and the label is what spares a buyer
// a refusal wall they could not have seen coming
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { captureAgentSkills, cardRequiresAccess } from "../src/lib/agent-interface";

describe("cardRequiresAccess", () => {
  it("reads a security declaration in either shape", () => {
    expect(
      cardRequiresAccess({
        securitySchemes: { oauth: { type: "http", scheme: "bearer" } },
        security: [{ oauth: [] }],
      }),
    ).toBe(true);
    expect(cardRequiresAccess({ security: [{ oauth: [] }] })).toBe(true);
    expect(cardRequiresAccess({ securitySchemes: { oauth: {} } })).toBe(true);
  });

  it("reads a card without one as open", () => {
    expect(cardRequiresAccess({ skills: [], supportedInterfaces: [] })).toBe(false);
    expect(cardRequiresAccess({ security: [] })).toBe(false);
    expect(cardRequiresAccess(null)).toBe(false);
    expect(cardRequiresAccess("gated")).toBe(false);
  });
});

describe("captureAgentSkills", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("carries the gate off the card beside the skills", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            name: "mandaterebalance-agent",
            skills: [{ id: "negotiate", description: "quote" }],
            securitySchemes: { oauth: { type: "http", scheme: "bearer" } },
            security: [{ oauth: [] }],
          }),
          { status: 200 },
        ),
      ),
    );
    const captured = await captureAgentSkills({ a2a_endpoint: "https://agent.example/card", mcp_server: null });
    expect(captured?.accessGated).toBe(true);
    expect(captured?.skills?.map((s) => s.id)).toEqual(["negotiate"]);
  });

  it("reads an open card as open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ skills: [{ id: "plan_grid", description: "plan" }] }), { status: 200 })),
    );
    const captured = await captureAgentSkills({ a2a_endpoint: "https://agent.example/card", mcp_server: null });
    expect(captured?.accessGated).toBe(false);
    expect(captured?.skills).toHaveLength(1);
  });

  it("shows a gated card as gated even when it lists no skills", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ security: [{ oauth: [] }] }), { status: 200 })),
    );
    const captured = await captureAgentSkills({ a2a_endpoint: "https://agent.example/card", mcp_server: null });
    expect(captured?.accessGated).toBe(true);
    expect(captured?.skills).toBeNull();
  });
});
