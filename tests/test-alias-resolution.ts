// The vitest resolver must honour the same "@/" mapping tsconfig declares, or a
// module that imports through the alias is unloadable from a test. These pin
// that the aliased specifier and the plain relative path reach one module.
import { describe, expect, it } from "vitest";
import * as agentIndexByPath from "../src/lib/agent-index";
import { indexKey, isShelfReady } from "@/lib/agent-index";
import { privateEndpointReason } from "@/lib/endpoint";
import * as endpointByPath from "../src/lib/endpoint";

describe("the @/ alias resolves like tsconfig", () => {
  it("imports a module through @/ and its relative path as the same instance", () => {
    expect(privateEndpointReason).toBe(endpointByPath.privateEndpointReason);
    expect(privateEndpointReason("http://localhost:8080/mcp")).toMatch(/private address/);
    expect(privateEndpointReason("https://agent.example/mcp")).toBeNull();
  });

  it("imports a second aliased module and runs its real logic", () => {
    expect(indexKey).toBe(agentIndexByPath.indexKey);
    expect(indexKey(56, "42")).toBe("56:42");
    expect(isShelfReady({ category: "defi", mcp_server: "https://agent.example/mcp" })).toBe(true);
    expect(isShelfReady({ category: "general", mcp_server: "https://agent.example/mcp" })).toBe(false);
  });

  it("resolves an aliased module that carries runtime functions", async () => {
    const types = await import("@/lib/types");
    expect(typeof types.targetChainId).toBe("function");
    expect(typeof types.targetChainId()).toBe("number");
  });
});
