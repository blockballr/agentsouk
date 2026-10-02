// the team panel's doors: who gets a nonce, a session, a page, and a say over members
// runs without a database, where members and sessions live in memory
import { beforeEach, describe, expect, it, vi } from "vitest";

// three wallets made for this run alone, so no key is written down here
const keys = await vi.hoisted(async () => {
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const made = { owner: generatePrivateKey(), viewer: generatePrivateKey(), outsider: generatePrivateKey() };
  delete process.env.DATABASE_URL;
  process.env.STATION_OWNER = privateKeyToAccount(made.owner).address;
  return made;
});
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/station-data", () => ({
  stationOverview: async () => ({ generatedAt: "now" }),
  stationAgents: async () => [],
  stationHires: async () => [],
  stationOperations: async () => ({ generatedAt: "now" }),
}));

import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { POST as nonceRoute } from "../src/app/api/station/nonce/route";
import { DELETE as signOutRoute, POST as sessionRoute } from "../src/app/api/station/session/route";
import { GET as overviewRoute } from "../src/app/api/station/overview/route";
import { DELETE as removeRoute, GET as membersRoute, POST as grantRoute } from "../src/app/api/station/members/route";
import { resetRateLimitsForTests } from "../src/lib/rate-limit";
import { memberChangeProblem, roleAllows, stationMemberChangeMessage, stationSignInMessage } from "../src/lib/station";
import { listAudit, listMembers, resetStationForTests } from "../src/lib/station-store";

const owner = privateKeyToAccount(keys.owner);
const viewer = privateKeyToAccount(keys.viewer);
const outsider = privateKeyToAccount(keys.outsider);

type Account = typeof owner;

function request(path: string, method: string, body?: unknown, token?: string, ip = "203.0.113.7") {
  return new NextRequest(`https://api.agentsouk.xyz/api/station/${path}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function nonceFor(account: Account, ip?: string): Promise<{ nonce: string; message: string }> {
  return (await nonceRoute(request("nonce", "POST", { address: account.address }, undefined, ip))).json();
}

async function signIn(account: Account): Promise<{ status: number; token?: string; role?: string }> {
  const { nonce, message } = await nonceFor(account);
  const signature = await account.signMessage({ message });
  const res = await sessionRoute(request("session", "POST", { address: account.address, nonce, signature }));
  const body = await res.json();
  return { status: res.status, token: body.session?.token, role: body.session?.role };
}

// the body an owner sends for one change, signed over a nonce of their own
async function signedChange(by: Account, target: string, role: string | null) {
  const { nonce } = await nonceFor(by);
  const signature = await by.signMessage({ message: stationMemberChangeMessage(by.address, target, (role ?? "remove") as "viewer", nonce) });
  return { address: target, role, nonce, signature };
}

async function send(token: string, body: { role: string | null }) {
  const res = await (body.role ? grantRoute : removeRoute)(request("members", body.role ? "POST" : "DELETE", body, token));
  return { status: res.status, body: await res.json() };
}

async function change(by: Account, token: string, target: string, role: string | null) {
  return send(token, await signedChange(by, target, role));
}

beforeEach(() => {
  resetStationForTests();
  resetRateLimitsForTests();
});

describe("roles", () => {
  it("each include the ones below them", () => {
    expect(roleAllows("owner", "operator")).toBe(true);
    expect(roleAllows("operator", "viewer")).toBe(true);
    expect(roleAllows("viewer", "operator")).toBe(false);
    expect(roleAllows("operator", "owner")).toBe(false);
  });

  it("never leave the station without an owner", () => {
    const members = [{ address: owner.address.toLowerCase(), role: "owner" as const, addedBy: null, addedAt: "x" }];
    expect(memberChangeProblem(members, owner.address, null)).toBe("the station needs at least one owner");
    expect(memberChangeProblem(members, owner.address, "viewer")).toBe("the station needs at least one owner");
    expect(memberChangeProblem(members, viewer.address, "viewer")).toBeNull();
    expect(memberChangeProblem(members, viewer.address, null)).toBe("that wallet is not a member");
  });
});

describe("signing in", () => {
  it("gives the first owner a session with the owner's role", async () => {
    const result = await signIn(owner);
    expect(result.status).toBe(200);
    expect(result.role).toBe("owner");
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the station in the text a member signs", async () => {
    const { message } = await nonceFor(owner);
    expect(message).toContain("site: station.agentsouk.xyz");
  });

  it("hands a nonce to anyone, and a session to nobody who is not a member", async () => {
    const result = await signIn(outsider);
    expect(result.status).toBe(401);
    expect(result.token).toBeUndefined();
  });

  it("takes a nonce once only", async () => {
    const { nonce, message } = await nonceFor(owner);
    const signature = await owner.signMessage({ message });
    const first = await sessionRoute(request("session", "POST", { address: owner.address, nonce, signature }));
    const second = await sessionRoute(request("session", "POST", { address: owner.address, nonce, signature }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
  });

  it("refuses a nonce signed by another wallet, or issued to another wallet", async () => {
    const { nonce } = await nonceFor(owner);
    const forged = await outsider.signMessage({ message: stationSignInMessage(owner.address, nonce) });
    expect((await sessionRoute(request("session", "POST", { address: owner.address, nonce, signature: forged }))).status).toBe(401);

    const other = await nonceFor(outsider);
    const signature = await owner.signMessage({ message: stationSignInMessage(owner.address, other.nonce) });
    expect((await sessionRoute(request("session", "POST", { address: owner.address, nonce: other.nonce, signature }))).status).toBe(401);
  });

  it("asks for an address before it issues anything", async () => {
    expect((await nonceRoute(request("nonce", "POST", { address: "not an address" }))).status).toBe(400);
    expect((await sessionRoute(request("session", "POST", { address: owner.address }))).status).toBe(400);
  });

  it("cannot be shut to a member by a stranger asking in their name", async () => {
    let last = 200;
    for (let i = 0; i < 130; i++) last = (await nonceRoute(request("nonce", "POST", { address: owner.address }, undefined, "198.51.100.9"))).status;
    // the stranger has used up their own allowance, and only theirs
    expect(last).toBe(429);
    expect((await signIn(owner)).status).toBe(200);
  });
});

describe("signing out", () => {
  it("ends the session on the server, not only in the tab", async () => {
    const { token } = await signIn(owner);
    expect((await overviewRoute(request("overview", "GET", undefined, token))).status).toBe(200);
    expect((await signOutRoute(request("session", "DELETE", {}, token))).status).toBe(200);
    expect((await overviewRoute(request("overview", "GET", undefined, token))).status).toBe(401);
  });

  it("can end every session the wallet has open", async () => {
    const first = await signIn(owner);
    const second = await signIn(owner);
    await signOutRoute(request("session", "DELETE", { all: true }, first.token));
    expect((await overviewRoute(request("overview", "GET", undefined, second.token))).status).toBe(401);
  });
});

describe("the pages", () => {
  it("answer a member and nobody else", async () => {
    const { token } = await signIn(owner);
    expect((await overviewRoute(request("overview", "GET", undefined, token))).status).toBe(200);
    expect((await overviewRoute(request("overview", "GET"))).status).toBe(401);
    expect((await overviewRoute(request("overview", "GET", undefined, "f".repeat(64)))).status).toBe(401);
    expect((await overviewRoute(request("overview", "GET", undefined, "not a token"))).status).toBe(401);
  });

  it("are never cached", async () => {
    const { token } = await signIn(owner);
    const res = await overviewRoute(request("overview", "GET", undefined, token));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("members", () => {
  it("are added by an owner who signs the change, and can then sign in with their role", async () => {
    const { token } = await signIn(owner);
    const granted = await change(owner, token!, viewer.address, "viewer");
    expect(granted.status).toBe(200);
    expect(granted.body.members.map((m: { role: string }) => m.role).sort()).toEqual(["owner", "viewer"]);
    const session = await signIn(viewer);
    expect(session.role).toBe("viewer");
    // a viewer reads pages but not the member list
    expect((await overviewRoute(request("overview", "GET", undefined, session.token))).status).toBe(200);
    expect((await membersRoute(request("members", "GET", undefined, session.token))).status).toBe(403);
  });

  it("cannot be changed with a session alone, or with a signature made for another change", async () => {
    const { token } = await signIn(owner);
    const { nonce } = await nonceFor(owner);
    const bare = await grantRoute(request("members", "POST", { address: viewer.address, role: "viewer", nonce }, token));
    expect(bare.status).toBe(401);
    const forOutsider = await signedChange(owner, outsider.address, "viewer");
    const swapped = await send(token!, { ...forOutsider, address: viewer.address, role: "owner" });
    expect(swapped.status).toBe(401);
    expect((await listMembers()).map((m) => m.role)).toEqual(["owner"]);
  });

  it("cannot be changed by sending a signed change a second time", async () => {
    const { token } = await signIn(owner);
    const promote = await signedChange(owner, viewer.address, "owner");
    expect((await send(token!, promote)).status).toBe(200);
    expect((await change(owner, token!, viewer.address, "viewer")).status).toBe(200);
    // the first body again would make them an owner once more
    expect((await send(token!, promote)).status).toBe(401);
    const roles = Object.fromEntries((await listMembers()).map((m) => [m.address, m.role]));
    expect(roles[viewer.address.toLowerCase()]).toBe("viewer");
  });

  it("lose their session the moment they are removed", async () => {
    const { token } = await signIn(owner);
    await change(owner, token!, viewer.address, "operator");
    const session = await signIn(viewer);
    expect((await overviewRoute(request("overview", "GET", undefined, session.token))).status).toBe(200);
    expect((await change(owner, token!, viewer.address, null)).status).toBe(200);
    expect((await overviewRoute(request("overview", "GET", undefined, session.token))).status).toBe(401);
  });

  it("cannot remove or demote the last owner", async () => {
    const { token } = await signIn(owner);
    expect((await change(owner, token!, owner.address, null)).status).toBe(409);
    expect((await change(owner, token!, owner.address, "viewer")).status).toBe(409);
  });

  it("keep an owner when two owners demote each other at the same moment", async () => {
    const first = await signIn(owner);
    await change(owner, first.token!, viewer.address, "owner");
    const second = await signIn(viewer);
    const [a, b] = await Promise.all([
      signedChange(owner, viewer.address, "viewer"),
      signedChange(viewer, owner.address, "viewer"),
    ]);
    const results = await Promise.all([send(first.token!, a), send(second.token!, b)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await listMembers()).filter((m) => m.role === "owner")).toHaveLength(1);
  });

  it("leave a line in the log for every sign-in, change and refusal", async () => {
    const { token } = await signIn(owner);
    await change(owner, token!, viewer.address, "viewer");
    await change(owner, token!, viewer.address, null);
    await change(owner, token!, owner.address, null);
    const v = viewer.address.toLowerCase();
    const log = (await listAudit()).map((e) => e.action);
    expect(log).toEqual([`refused: remove ${owner.address.toLowerCase()}`, `removed ${v}`, `made ${v} viewer`, "signed in"]);
  });
});
