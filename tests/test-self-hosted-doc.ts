// The self hosted document reader: a foreign uri is address-checked at every
// hop, a redirect may not leave https, an oversized or non json body is refused,
// and the draft checking covers the shape a registration can mint.
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";

const dnsLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

vi.mock("node:dns/promises", () => ({
  default: { lookup: (...args: unknown[]) => (dnsLookup as (...a: unknown[]) => unknown)(...args) },
}));

import {
  ipForbidden,
  readSelfHostedDocument,
  readSelfHostedFileAgainst,
  draftFromSelfHostedFile,
  resetSelfHostedDocCache,
} from "../src/lib/self-hosted-doc";

afterEach(() => {
  vi.unstubAllGlobals();
  resetSelfHostedDocCache();
});

describe("ipForbidden", () => {
  it("refuses loopback, private, link local and the zero block", () => {
    expect(ipForbidden("127.0.0.1")).toBe(true);
    expect(ipForbidden("10.1.2.3")).toBe(true);
    expect(ipForbidden("192.168.0.9")).toBe(true);
    expect(ipForbidden("172.16.0.1")).toBe(true);
    expect(ipForbidden("172.31.255.255")).toBe(true);
    expect(ipForbidden("172.32.0.1")).toBe(false);
    expect(ipForbidden("169.254.169.254")).toBe(true);
    expect(ipForbidden("0.1.2.3")).toBe(true);
    expect(ipForbidden("100.64.0.1")).toBe(true);
    expect(ipForbidden("100.63.255.255")).toBe(false);
  });

  it("refuses the ipv6 counterparts, including ipv4 mapped ones", () => {
    expect(ipForbidden("::1")).toBe(true);
    expect(ipForbidden("::")).toBe(true);
    expect(ipForbidden("::ffff:127.0.0.1")).toBe(true);
    expect(ipForbidden("::ffff:8.8.8.8")).toBe(false);
    expect(ipForbidden("fc00::1")).toBe(true);
    expect(ipForbidden("fd12:3456::1")).toBe(true);
    expect(ipForbidden("fe80::1")).toBe(true);
    expect(ipForbidden("fe80::1%eth0")).toBe(true);
    expect(ipForbidden("fe10::1")).toBe(false);
    expect(ipForbidden("2606:4700::1111")).toBe(false);
  });
});

const draft = {
  name: "Souk Grid Pilot",
  description: "Runs grid orders",
  category: "" as const,
  endpoint: "https://grid.agentsouk.xyz/a2a",
};

const file = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "Souk Grid Pilot",
  description: "Runs grid orders",
  services: [{ name: "A2A", endpoint: "https://grid.agentsouk.xyz/a2a" }],
  x402Support: true,
  active: true,
  registrations: [],
};

describe("readSelfHostedFileAgainst", () => {
  it("accepts a matching v1 document", () => {
    const checked = readSelfHostedFileAgainst(file as never, draft);
    expect(checked.ok).toBe(true);
  });

  it("refuses a document that is not registration-v1, mismatches, or is already registered", () => {
    for (const [f, expected] of [
      [ { ...file, type: "https://example.com/other" }, "registration-v1" ],
      [ { ...file, name: "Another Nickname" }, "name does not match" ],
      [ { ...file, description: "" }, "no usable description" ],
      [ { ...file, services: [] }, "no services" ],
      [ { ...file, registrations: [{ agentId: "3", agentRegistry: "eip155:56:0x8004" }] }, "registered somewhere already" ],
      [ { ...file, services: [{ name: "web", endpoint: "https://grid.agentsouk.xyz" }] }, "no a2a service" ],
      [ { ...file, services: [{ name: "a2a", endpoint: "https://other.example/a2a" }] }, "does not match the listing's endpoint" ],
    ] as [typeof file, string][]) {
      const checked = readSelfHostedFileAgainst(f as never, draft);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.error).toContain(expected);
    }
  });
});

describe("draftFromSelfHostedFile", () => {
  it("derives the endpoint, protocols and picture from the document, keeping the base category", () => {
    const checked = draftFromSelfHostedFile(
      {
        ...file,
        name: "Grid Pilot Renamed",
        services: [
          { name: "MCP", endpoint: "https://grid.agentsouk.xyz/mcp" },
          { name: "A2A", endpoint: "https://grid.agentsouk.xyz/a2a" },
        ],
        image: "https://grid.agentsouk.xyz/face.png",
      } as never,
      { ...draft, category: "grid-trading" as const },
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.draft.name).toBe("Grid Pilot Renamed");
    expect(checked.draft.endpoint).toBe("https://grid.agentsouk.xyz/a2a");
    expect(checked.draft.endpointKinds).toEqual(["A2A", "MCP"]);
    expect(checked.draft.category).toBe("grid-trading");
    expect(checked.draft.image).toBe("https://grid.agentsouk.xyz/face.png");
    expect(checked.draft.selfHosted).toBe(true);
  });

  it("accepts a web-only service and keeps it on the shelf", () => {
    const checked = draftFromSelfHostedFile(
      { ...file, services: [{ name: "web", endpoint: "https://grid.agentsouk.xyz" }] } as never,
      draft,
    );
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.draft.endpoint).toBe("https://grid.agentsouk.xyz");
  });

  it("refuses a shapeless service list", () => {
    const checked = draftFromSelfHostedFile(
      { ...file, services: [{ name: "a2a" }] } as never,
      draft,
    );
    expect(checked.ok).toBe(false);
  });
});

describe("readSelfHostedDocument", () => {
  const doc = () => new Response(JSON.stringify(file), { status: 200, headers: { "content-type": "application/json" } });
  const hop = (status: number, location: string) => new Response(null, { status, headers: { location } });

  it("refuses a loopback address before any fetch", async () => {
    const f = vi.fn(async () => doc());
    vi.stubGlobal("fetch", f);
    const read = await readSelfHostedDocument("https://127.0.0.1/agent.json");
    expect(read.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("follows a redirect that stays public https and returns the document", async () => {
    // the first hop is the location-checked redirect; the record header claims len 7 for a longer body
    const f = vi.fn(async (input: string | URL) =>
      hop(302, input === "https://a.example/agent.json" ? "https://b.example/agent.json" : "https://a.example/agent.json") ?? doc(),
    );
    f.mockImplementationOnce(async () => hop(302, "https://b.example/agent.json"));
    f.mockImplementation(async () => doc());
    vi.stubGlobal("fetch", f);
    const read = await readSelfHostedDocument("https://a.example/agent.json/");
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.locator).toBe("https://a.example/agent.json");
  });

  it("refuses a redirect that leaves https", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => hop(301, "http://b.example/agent.json")),
    );
    const read = await readSelfHostedDocument("https://a.example/agent.json");
    expect(read.ok).toBe(false);
  });

  it("refuses an oversized declared body without fetching past it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(file), {
          status: 200,
          headers: { "content-length": String(256 * 1024 * 10) },
        }),
      ),
    );
    const read = await readSelfHostedDocument("https://a.example/agent.json");
    expect(read.ok).toBe(false);
  });

  it("refuses a non json answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>nope</html>", { status: 200 })),
    );
    const read = await readSelfHostedDocument("https://a.example/agent.json");
    expect(read.ok).toBe(false);
  });
});
