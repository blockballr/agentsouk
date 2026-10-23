// A fork proof for the venue guard: the reader sees the real Aave reserve, and
// once the reserve is frozen through Aave's own governance path, the guard turns
// from clear to pull. Opt-in, because it starts anvil and reads a public RPC:
//
//   VENUE_FORK=https://bsc-dataseed.bnbchain.org npx vitest run tests/test-venue-guard-fork.ts
//
// The offline policy tests cover the thresholds; this covers the mapping from
// Aave's state to the reading that trips them.
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Address,
} from "viem";
import { bsc } from "viem/chains";
import { decideVenueGuard, readAaveReserveRisk } from "../src/lib/venue-risk";

const FORK = process.env.VENUE_FORK;
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;

const USDT = "0x55d398326f99059fF775485246999027B3197955" as Address;
const POOL = "0x6807dc923806fE8Fd134338EABCA509979a7e0cB" as Address;
const ACL = "0x2D97F8FA96886Fd923c065F5457F9DDd494e3877" as Address;
const PROVIDER = "0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D" as Address;
const CONFIGURATOR = "0x67bdF23C7fCE7C65fF7415Ba3F2520B45D6f9584" as Address;
const ACL_ADMIN = "0x9390B1735def18560c509E2d0bc090E9d6BA257a" as Address;
const RISK_ADMIN = keccak256(toBytes("RISK_ADMIN_ROLE"));

const ACL_ABI = [
  { name: "grantRole", type: "function", stateMutability: "nonpayable", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [] },
] as const;
const CONFIG_ABI = [
  { name: "setReserveFreeze", type: "function", stateMutability: "nonpayable", inputs: [{ name: "asset", type: "address" }, { name: "freeze", type: "bool" }], outputs: [] },
] as const;

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
}

async function waitForRpc(timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await rpc("eth_blockNumber", []);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("anvil did not answer");
}

async function forkHead(url: string): Promise<bigint> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (!body.result) throw new Error(`the fork endpoint did not answer: ${body.error?.message ?? "no result"}`);
  return BigInt(body.result);
}

describe.skipIf(!FORK)("venue guard on a forked reserve", () => {
  let anvil: ChildProcess | null = null;

  beforeAll(async () => {
    // pin the fork: anvil re-reads upstream state while it executes, and a moving
    // head makes every storage read miss the block cache
    const head = await forkHead(FORK as string);
    anvil = spawn(
      "anvil",
      [
        "--fork-url",
        FORK as string,
        "--fork-block-number",
        String(head),
        "--port",
        String(PORT),
        // the archive answers a storage read slower than a local node, so anvil
        // has to wait for it rather than give up mid-transaction
        "--timeout",
        "180000",
        "--silent",
      ],
      { stdio: "ignore" },
    );
    await waitForRpc();
  }, 180_000);

  afterAll(() => {
    anvil?.kill();
  });

  it("reads the live reserve as clear, then pulls once the reserve is frozen", async () => {
    const client = createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 300_000, retryCount: 0 }) });
    const supplied = 100n * 10n ** 18n;

    const before = await readAaveReserveRisk(client, { pool: POOL, asset: USDT, provider: PROVIDER, supplied });
    expect(before.paused).toBe(false);
    expect(before.frozen).toBe(false);
    expect(before.availableLiquidity).toBeGreaterThan(supplied);
    expect(decideVenueGuard(before).action).toBe("clear");

    // Aave's own path to a frozen reserve: the ACL admin grants the risk role,
    // then the configurator closes the reserve to new supply.
    await rpc("anvil_impersonateAccount", [ACL_ADMIN]);
    await rpc("anvil_setBalance", [ACL_ADMIN, "0x56BC75E2D63100000"]);
    const admin = createWalletClient({ account: ACL_ADMIN, chain: bsc, transport: http(RPC, { timeout: 300_000, retryCount: 0 }) });

    const grant = await admin.writeContract({
      address: ACL,
      abi: ACL_ABI,
      functionName: "grantRole",
      args: [RISK_ADMIN, ACL_ADMIN],
      chain: bsc,
    });
    await client.waitForTransactionReceipt({ hash: grant });

    const freeze = await admin.writeContract({
      address: CONFIGURATOR,
      abi: CONFIG_ABI,
      functionName: "setReserveFreeze",
      args: [USDT, true],
      chain: bsc,
    });
    await client.waitForTransactionReceipt({ hash: freeze });

    const after = await readAaveReserveRisk(client, { pool: POOL, asset: USDT, provider: PROVIDER, supplied });
    expect(after.frozen).toBe(true);
    const verdict = decideVenueGuard(after);
    expect(verdict.action).toBe("pull");
    expect(verdict.reason).toContain("frozen");
  }, 600_000);
});
