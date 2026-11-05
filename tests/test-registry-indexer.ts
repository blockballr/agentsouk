import { describe, expect, it } from "vitest";
import { decodeAbiEventString, draftFromRegistrationFile } from "../src/lib/registry-indexer";

describe("registry indexer", () => {
  it("decodes an abi event string payload", () => {
    const uri = "https://example.com/agent.json";
    const value = Buffer.from(uri, "utf8").toString("hex");
    const data = "0x" + "20".padStart(64, "0") + uri.length.toString(16).padStart(64, "0") + value.padEnd(Math.ceil(value.length / 64) * 64, "0");
    expect(decodeAbiEventString(data)).toBe(uri);
  });

  it("answers empty for junk payloads", () => {
    expect(decodeAbiEventString("0x")).toBe("");
    expect(decodeAbiEventString("0x" + "00".repeat(32))).toBe("");
  });

  it("maps a registration file to the draft fields the shelf reads", () => {
    const draft = draftFromRegistrationFile({
      name: "Grid Pilot",
      description: "runs a grid",
      image: "https://example.com/a.png",
      x402Support: true,
      services: [
        { name: "A2A", url: "https://p.example/a2a" },
        { name: "MCP", url: "https://p.example/mcp" },
      ],
    });
    expect(draft.name).toBe("Grid Pilot");
    expect(draft.endpoint).toBe("https://p.example/a2a");
    expect(draft.endpointKinds).toEqual(["A2A", "MCP"]);
    expect(draft.x402Support).toBe(true);
  });

  it("falls back to an mcp-only card without inventing an a2a claim", () => {
    const draft = draftFromRegistrationFile({
      name: "Mcp Only",
      services: [{ name: "MCP", url: "https://p.example/mcp" }],
    });
    expect(draft.endpointKinds).toEqual(["MCP"]);
    expect(draft.endpoint).toBe("https://p.example/mcp");
  });

  it("reads unnamed services as a2a and web as web", () => {
    const draft = draftFromRegistrationFile({
      services: [
        { url: "https://p.example/x" },
        { name: "web", url: "https://p.example/home" },
      ],
    });
    expect([...draft.endpointKinds]).toEqual(["A2A", "web"]);
  });
});
