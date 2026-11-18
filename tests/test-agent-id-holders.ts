// the seller badge: which wallets hold an Agent ID, answered yes or no, never with a name
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const wallet = "0x042A000000000000000000000000000000fa9c00";

describe("the seller badge lookup", () => {
  it("answers which wallets hold an Agent ID, with no names", async () => {
    const lib = await import("../src/lib/agent-id");
    const spy = vi.spyOn(lib, "agentIdHoldersAmong").mockResolvedValueOnce([wallet.toLowerCase()]);
    const { GET } = await import("../src/app/api/agent-id/holders/route");
    const res = await GET(new NextRequest(`https://api.agentsouk.xyz/api/agent-id/holders?wallets=${wallet},0x0000000000000000000000000000000000000001`));
    const body = await res.json();
    expect(body).toEqual({ success: true, holders: [wallet.toLowerCase()] });
    expect(JSON.stringify(body)).not.toContain(".ai");
    spy.mockRestore();
  });

  it("refuses an empty or oversized request", async () => {
    const { GET } = await import("../src/app/api/agent-id/holders/route");
    expect((await GET(new NextRequest("https://api.agentsouk.xyz/api/agent-id/holders"))).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => `0x${i.toString(16).padStart(40, "0")}`).join(",");
    expect((await GET(new NextRequest(`https://api.agentsouk.xyz/api/agent-id/holders?wallets=${many}`))).status).toBe(400);
  });
});
