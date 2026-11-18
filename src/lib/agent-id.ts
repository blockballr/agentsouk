// Binance Agent ID (a SpaceID .ai name for an Agentic Wallet) on BNB Chain, and the vault hires
// opened by its holders. The contract cannot list a wallet's token and SpaceID offers no lookup by
// address, so names come from the mint events, read forward from where the last run stopped. A
// token never moves once minted, so a row never changes. The same run reads HireVault's Opened
// events, which is how the hackathon's measure (holders who used our contract) is counted.
// Names are shown only to the wallet that owns them; nothing here looks a wallet up by name.
import "server-only";
import postgres from "postgres";
import { createPublicClient, parseAbi, parseAbiItem, type Address } from "viem";
import { bsc } from "viem/chains";
import { rpcTransport } from "@/lib/rpc";
import { VAULT_BY_CHAIN } from "@/lib/vault";

export const AGENT_ID_CONTRACT = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f" as const;
// the hackathon counts only activity from the start of its submission period
export const SUBMISSION_START = Date.parse("2026-11-18T08:00:00Z");

const CHAIN_ID = 56;
const CHUNK = 1000n;
const MAX_CHUNKS_PER_RUN = 60n;
// a first run with no cursor starts this far back, inside the window public nodes still serve
const FIRST_RUN_BLOCKS = 20_000n;

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const OPENED = parseAbiItem(
  "event Opened(uint256 indexed id, address indexed buyer, address indexed agent, address token, uint256 amount, uint64 expiry, uint16 maxSlippageBps, uint16 agentFeeBps, uint16 maxLossBps)",
);
const READS = parseAbi(["function balanceOf(address) view returns (uint256)", "function tokenURI(uint256) view returns (string)"]);
const ZERO = "0x0000000000000000000000000000000000000000";

let sql: ReturnType<typeof postgres> | null = null;
if (process.env.DATABASE_URL) {
  sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 10 });
}

let ready: Promise<boolean> | null = null;
async function ensureTables(): Promise<boolean> {
  if (!sql) return false;
  ready ??= (async () => {
    try {
      await sql!`create table if not exists agent_ids (address text primary key, token_id text not null, handle text, minted_block bigint not null)`;
      await sql!`create table if not exists vault_opens (chain_id integer not null, hire_id text not null, buyer text not null, block bigint not null, opened_at timestamptz not null, primary key (chain_id, hire_id))`;
      await sql!`create table if not exists index_cursors (name text primary key, last_block bigint not null)`;
      return true;
    } catch {
      ready = null;
      return false;
    }
  })();
  return ready;
}

function client() {
  // AGENT_ID_RPC_URL, when set, is a node that serves old logs, so a backfill can reach the first mint
  return createPublicClient({ chain: bsc, transport: rpcTransport(CHAIN_ID, process.env.AGENT_ID_RPC_URL) });
}

async function cursor(name: string): Promise<bigint | null> {
  const rows = await sql!`select last_block from index_cursors where name = ${name}`;
  return rows[0] ? BigInt(rows[0].last_block) : null;
}

async function setCursor(name: string, block: bigint): Promise<void> {
  await sql!`insert into index_cursors (name, last_block) values (${name}, ${block.toString()}) on conflict (name) do update set last_block = excluded.last_block`;
}

// the handle is the metadata file's name: https://agentid.prd.space.id/metadata/<handle>.json
export function handleFromUri(uri: string): string | null {
  const m = /\/metadata\/([a-z0-9-]{1,63})\.json$/i.exec(uri.trim());
  return m ? m[1]!.toLowerCase() : null;
}

export interface SyncResult {
  from: string;
  to: string;
  mints: number;
  opens: number;
  reachedHead: boolean;
}

export async function syncAgentIds(opts: { fromBlock?: bigint } = {}): Promise<SyncResult> {
  if (!(await ensureTables())) throw new Error("agent id index needs the database");
  const c = client();
  const head = await c.getBlockNumber();
  const vault = VAULT_BY_CHAIN[CHAIN_ID] as Address | undefined;
  const last = opts.fromBlock !== undefined ? opts.fromBlock - 1n : await cursor("agent-id");
  const from = last === null ? head - FIRST_RUN_BLOCKS : last + 1n;
  const to = from + CHUNK * MAX_CHUNKS_PER_RUN - 1n < head ? from + CHUNK * MAX_CHUNKS_PER_RUN - 1n : head;
  let mints = 0;
  let opens = 0;
  for (let start = from; start <= to; start += CHUNK) {
    const end = start + CHUNK - 1n < to ? start + CHUNK - 1n : to;
    const [minted, opened] = await Promise.all([
      c.getLogs({ address: AGENT_ID_CONTRACT, event: TRANSFER, args: { from: ZERO }, fromBlock: start, toBlock: end }),
      vault ? c.getLogs({ address: vault, event: OPENED, fromBlock: start, toBlock: end }) : Promise.resolve([]),
    ]);
    // names are read eight at a time and each chunk is saved in one write, so a busy hour of mints
    // still fits inside one scheduled run
    const rows: { address: string; token_id: string; handle: string | null; minted_block: string }[] = [];
    for (let i = 0; i < minted.length; i += 8) {
      const batch = minted.slice(i, i + 8);
      const handles = await Promise.all(
        batch.map((log) =>
          c
            .readContract({ address: AGENT_ID_CONTRACT, abi: READS, functionName: "tokenURI", args: [log.args.tokenId!] })
            .then(handleFromUri)
            .catch(() => null),
        ),
      );
      batch.forEach((log, j) =>
        rows.push({
          address: String(log.args.to).toLowerCase(),
          token_id: log.args.tokenId!.toString(),
          handle: handles[j] ?? null,
          minted_block: log.blockNumber!.toString(),
        }),
      );
    }
    if (rows.length) {
      await sql!`
        insert into agent_ids ${sql!(rows, "address", "token_id", "handle", "minted_block")}
        on conflict (address) do update set handle = coalesce(agent_ids.handle, excluded.handle)`;
      mints += rows.length;
    }
    if (opened.length) {
      const times = new Map<bigint, Date>();
      for (const log of opened) {
        const block = log.blockNumber!;
        if (!times.has(block)) times.set(block, new Date(Number((await c.getBlock({ blockNumber: block })).timestamp) * 1000));
        await sql!`
          insert into vault_opens (chain_id, hire_id, buyer, block, opened_at)
          values (${CHAIN_ID}, ${log.args.id!.toString()}, ${String(log.args.buyer).toLowerCase()}, ${block.toString()}, ${times.get(block)!.toISOString()})
          on conflict do nothing`;
        opens += 1;
      }
    }
    if (opts.fromBlock === undefined) await setCursor("agent-id", end);
  }
  return { from: from.toString(), to: to.toString(), mints, opens, reachedHead: to === head };
}

// whether an address holds an Agent ID, and its handle when the index has it. balanceOf answers
// for holders minted before the index started
export async function agentIdOf(address: string): Promise<{ holder: boolean; handle: string | null }> {
  const a = address.toLowerCase();
  if (await ensureTables()) {
    const rows = await sql!`select handle from agent_ids where address = ${a}`;
    if (rows[0]) return { holder: true, handle: rows[0].handle ?? null };
  }
  try {
    const balance = await client().readContract({ address: AGENT_ID_CONTRACT, abi: READS, functionName: "balanceOf", args: [a as Address] });
    return { holder: balance > 0n, handle: null };
  } catch {
    return { holder: false, handle: null };
  }
}

// the hackathon measure: distinct Agent ID holders who opened a vault hire since the submission
// period began. holders minted before the index started are confirmed by balanceOf
export async function agentIdHireCount(): Promise<{ holders: number; hires: number; since: string } | null> {
  if (!(await ensureTables())) return null;
  const since = new Date(SUBMISSION_START).toISOString();
  const rows = await sql!`select buyer, count(*)::int as n from vault_opens where opened_at >= ${since} group by buyer`;
  let holders = 0;
  let hires = 0;
  for (const row of rows) {
    if ((await agentIdOf(row.buyer)).holder) {
      holders += 1;
      hires += Number(row.n);
    }
  }
  return { holders, hires, since };
}

// which of these wallets hold an Agent ID: yes or no only, never the name, which is what balanceOf
// already shows to anyone. the index answers first, one multicall covers the rest
export async function agentIdHoldersAmong(wallets: string[]): Promise<string[]> {
  const asked = [...new Set(wallets.map((w) => w.toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w)))];
  if (asked.length === 0) return [];
  const holders = new Set<string>();
  if (await ensureTables()) {
    const rows = await sql!`select address from agent_ids where address in ${sql!(asked)}`;
    for (const row of rows) holders.add(String(row.address));
  }
  const rest = asked.filter((w) => !holders.has(w));
  if (rest.length) {
    const results = await client()
      .multicall({
        contracts: rest.map((w) => ({ address: AGENT_ID_CONTRACT, abi: READS, functionName: "balanceOf" as const, args: [w as Address] })),
        allowFailure: true,
      })
      .catch(() => []);
    results.forEach((r, i) => {
      if (r.status === "success" && (r.result as bigint) > 0n) holders.add(rest[i]!);
    });
  }
  return asked.filter((w) => holders.has(w));
}
