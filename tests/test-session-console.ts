import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/altana-store", () => ({
  loadAltanaSessionsFromDb: async () => [
    {
      chainId: 56,
      label: "grid",
      tokenId: "391004",
      walletAddress: "0x0000000000000000000000000000000000000001",
      sessionBlob: "{}",
      sessionKey: "0x01",
      adminKey: "0x02",
      expiry: 1,
      createdAt: "2026-11-01T00:00:00.000Z",
      revokedAt: "2026-11-17T00:00:00.000Z",
    },
  ],
  saveAltanaSession: async () => {
    throw new Error("a revoked session must not be saved");
  },
}));

describe("session console", () => {
  it("signs the same text in the browser and on the server", async () => {
    const server = await import("../src/lib/session-console");
    const web = await import("../apps/web/src/lib/session-console");
    const wallet = "0x84FEDaBd1B83443Ad86796C15619494878B64180";
    for (const action of server.CONSOLE_ACTIONS) {
      expect(web.consoleMessage(action, 56, "391004", wallet, 1)).toBe(server.consoleMessage(action, 56, "391004", wallet, 1));
    }
    expect(server.consoleMessage("list", 56, null, wallet, 5)).toContain("agent: all");
    expect(server.consoleMessage("list", 56, null, wallet, 5)).toContain(`by: ${wallet.toLowerCase()}`);
  });

  it("leaves a revoked session alone, even when forced, unless asked to grant it again", async () => {
    const { renewSessions } = await import("../src/lib/session-renewal");
    const run = await renewSessions({ chainId: 56, force: true });
    expect(run.renewed).toEqual([]);
    expect(run.outcomes[0]?.error).toMatch(/revoked/);
  });
});

describe("relay errors in plain words", () => {
  it("names a fee shortfall and passes anything else through", async () => {
    const { plainRelayError } = await import("../src/lib/session-console");
    expect(plainRelayError("Details: quote has asset deficits and is expected to fail")).toMatch(/enough BNB/);
    expect(plainRelayError("Session grant did not confirm: status=FAILED (relay code 300)")).toMatch(/enough BNB/);
    expect(plainRelayError("unknown key hash")).toBe("unknown key hash");
  });
});
