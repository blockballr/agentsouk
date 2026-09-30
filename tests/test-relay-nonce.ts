// Every hire is broadcast by one relay wallet from whichever instance settles it,
// so two settlements at the same moment can read the same pending nonce. The one
// refused for it must resend rather than fail a buyer who already signed.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sendWithNonceRetry } from "../src/lib/facilitator";

const HASH = `0x${"ab".repeat(32)}` as const;

describe("relay send under concurrent settlements", () => {
  it("resends after a nonce clash and returns the hash that landed", async () => {
    const send = vi
      .fn<() => Promise<`0x${string}`>>()
      .mockRejectedValueOnce(new Error("nonce too low: next nonce 41, tx nonce 40"))
      .mockRejectedValueOnce(new Error("replacement transaction underpriced"))
      .mockResolvedValueOnce(HASH);
    await expect(sendWithNonceRetry(send, 3, 1)).resolves.toBe(HASH);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does not retry an error that is not a nonce clash", async () => {
    const send = vi.fn<() => Promise<`0x${string}`>>().mockRejectedValue(new Error("insufficient funds for gas"));
    await expect(sendWithNonceRetry(send, 3, 1)).rejects.toThrow(/insufficient funds/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("gives up after its retries so a stuck relay still fails the request", async () => {
    const send = vi.fn<() => Promise<`0x${string}`>>().mockRejectedValue(new Error("nonce too low"));
    await expect(sendWithNonceRetry(send, 2, 1)).rejects.toThrow(/nonce too low/);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
