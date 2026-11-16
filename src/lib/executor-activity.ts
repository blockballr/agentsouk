// What each vault executor has actually done. An executor's own transaction
// count says nothing, because its trades are relayed. Three sources are read:
// the vault's state for the hires that name it, the execution receipts for
// when it last ran and traded, and the vault's Traded events as a check on the
// last few hours. Public log endpoints drop older logs without an error, so
// the events are never the source for anything older than the scanned window.

export interface ChainTrade {
  agent: string;
  txHash: string;
  blockNumber: number;
}

export interface ReceiptLike {
  agent: string;
  status: "traded" | "skipped" | "refused";
  createdAt: string;
}

export interface ExecutorActivity {
  address: string;
  /** hires on the vault that name this executor, from contract state; null when it could not be read */
  hires: number | null;
  openHires: number | null;
  /** trades the vault itself recorded for this executor inside the window */
  chainTrades: number;
  lastChainTrade: { txHash: string; blockNumber: number; at: string | null } | null;
  /** the executor's own record of its passes inside the window */
  receipts: { traded: number; skipped: number; refused: number };
  /** the newest pass of any outcome, which shows the executor is being run at all */
  lastPassAt: string | null;
  lastTradedReceiptAt: string | null;
  /** has an open hire to work, or traded on chain inside the window */
  active: boolean;
}

export function summarizeExecutorActivity(input: {
  executors: string[];
  trades: ChainTrade[];
  receipts: ReceiptLike[];
  /** when the window starts, in ms since the epoch */
  since: number;
  /** block number to ISO time, for the blocks the caller looked up */
  blockTimes?: Map<number, string>;
  /** hires per executor from contract state, keyed by lower-case address */
  hires?: Map<string, { total: number; open: number }>;
}): ExecutorActivity[] {
  const lower = (value: string) => value.toLowerCase();
  return input.executors.map((address) => {
    const mine = input.trades
      .filter((trade) => lower(trade.agent) === lower(address))
      .sort((a, b) => a.blockNumber - b.blockNumber);
    const last = mine[mine.length - 1] ?? null;
    // receipts arrive newest first or in any order, so sort rather than assume
    const passes = input.receipts
      .filter((receipt) => lower(receipt.agent) === lower(address))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const inWindow = passes.filter((receipt) => Date.parse(receipt.createdAt) >= input.since);
    const count = (status: ReceiptLike["status"]) => inWindow.filter((receipt) => receipt.status === status).length;
    const held = input.hires?.get(lower(address)) ?? null;
    return {
      address,
      hires: held ? held.total : null,
      openHires: held ? held.open : null,
      chainTrades: mine.length,
      lastChainTrade: last
        ? { txHash: last.txHash, blockNumber: last.blockNumber, at: input.blockTimes?.get(last.blockNumber) ?? null }
        : null,
      receipts: { traded: count("traded"), skipped: count("skipped"), refused: count("refused") },
      lastPassAt: passes[0]?.createdAt ?? null,
      lastTradedReceiptAt: passes.find((receipt) => receipt.status === "traded")?.createdAt ?? null,
      active: mine.length > 0 || (held?.open ?? 0) > 0,
    };
  });
}

/** How many log chunks cover a window, given how fast the chain is making blocks. */
export function chunksForWindow(hours: number, secondsPerBlock: number, chunkBlocks: number, maxChunks: number): number {
  if (!(secondsPerBlock > 0)) return maxChunks;
  const blocks = Math.ceil((hours * 3600) / secondsPerBlock);
  return Math.max(1, Math.min(maxChunks, Math.ceil(blocks / chunkBlocks)));
}
