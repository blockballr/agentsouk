import "server-only";

import { parsePair } from "../pancake";
import { readPancakePrice, type PoolReader } from "../pancake-read";
import type { DataReader } from "./run";

// what stands behind a built agent's reads: our own RPC setup, with the deadline and the
// short cache the reference agents already use. A source not named here cannot be read
export function liveReader(chainId: number, opts: { reader?: PoolReader; deadlineMs?: number } = {}): DataReader {
  return async (source, args) => {
    if (source !== "pancakeswap.v3.pool") return { error: `${source} is not an approved data source` };
    const pair = parsePair(typeof args.pair === "string" ? args.pair : "");
    if (!pair) return { error: "pair must be written base/quote, for example WBNB/USDT" };
    const quote = await readPancakePrice(chainId, pair.base, pair.quote, { reader: opts.reader, deadlineMs: opts.deadlineMs });
    return "error" in quote ? { error: quote.error } : { ...quote };
  };
}
