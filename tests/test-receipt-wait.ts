// A hung provider read must not hang the wait past its budget. The wallet popup
// can close with the request in flight, leaving a promise that never settles,
// which used to wedge the wizard at checking with no recovery control.
import { describe, expect, it } from "vitest";
import {
  waitForTransactionReceipt,
  type TransactionReceipt,
} from "../apps/web/src/lib/register";

const RECEIPT: TransactionReceipt = { status: "0x1", logs: [] };
const hang = () => new Promise<TransactionReceipt | null>(() => {});

describe("waiting for a transaction receipt", () => {
  it("returns the receipt as soon as a poll answers", async () => {
    let calls = 0;
    const out = await waitForTransactionReceipt(
      async () => (++calls === 2 ? RECEIPT : null),
      { intervalMs: 5, readTimeoutMs: 50 },
    );
    expect(out).toBe(RECEIPT);
    expect(calls).toBe(2);
  });

  it("treats a rejecting read as a miss and keeps polling", async () => {
    let calls = 0;
    const out = await waitForTransactionReceipt(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("provider vanished");
        return RECEIPT;
      },
      { intervalMs: 5, readTimeoutMs: 50 },
    );
    expect(out).toBe(RECEIPT);
    expect(calls).toBe(2);
  });

  it("gives up on budget rather than hanging on a read that never settles", async () => {
    const started = Date.now();
    const out = await waitForTransactionReceipt(hang, {
      timeoutMs: 150,
      intervalMs: 10,
      readTimeoutMs: 20,
    });
    expect(out).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
