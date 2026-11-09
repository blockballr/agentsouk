// The API verifies a job action against the text it rebuilds, so the CLI's copy
// of that text has to stay identical to src/lib/jobs.ts.
import { describe, expect, it } from "vitest";
import { verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { jobActionMessage } from "../src/lib/jobs";
import { jobActionMessage as cliJobActionMessage } from "../packages/cli/src/marketplace/job-actions";

const jobId = "7d7c3d8f-1ec6-4905-9b9c-a3";
const address = "0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713";

const cases = [
  { jobId, action: "submit", address, deliverable: "ipfs://bafyresult" },
  { jobId, action: "complete", address, reason: "the report matches the ledger" },
  { jobId, action: "reject", address, reason: "the numbers did not reconcile" },
  { jobId, action: "claimRefund", address },
  { jobId, action: "submit", address, deliverable: "" },
  { jobId, action: "reject", address, reason: "" },
];

describe("the CLI and the route sign the same job action", () => {
  it("holds the same text", () => {
    for (const input of cases) {
      expect(cliJobActionMessage(input)).toBe(jobActionMessage(input));
    }
  });

  it("binds the action to the job and the address", () => {
    const base = cliJobActionMessage({ jobId, action: "complete", address });
    expect(base).toContain(`jobId: ${jobId}`);
    expect(base).toContain("action: complete");
    expect(base).toContain(`address: ${address.toLowerCase()}`);
    expect(base).toContain("reason: ");
    expect(base).toContain("deliverable: ");
    expect(base).not.toBe(cliJobActionMessage({ jobId: "another-job", action: "complete", address }));
    expect(base).not.toBe(cliJobActionMessage({ jobId, action: "reject", address }));
    expect(base).not.toBe(cliJobActionMessage({ jobId, action: "complete", address: "0x1111111111111111111111111111111111111111" }));
  });

  it("carries the reason and the deliverable it was given", () => {
    const message = cliJobActionMessage({ jobId, action: "submit", address, deliverable: "sha256:abc" });
    expect(message).toContain("deliverable: sha256:abc");
    expect(message).toContain("reason: ");
  });

  it("is exactly what a wallet signs", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const message = cliJobActionMessage({ jobId, action: "complete", address: account.address });
    const signature = await account.signMessage({ message });
    const check = (text: string) => verifyMessage({ address: account.address, message: text, signature });
    expect(await check(message)).toBe(true);
    expect(await check(message.replace("complete", "reject"))).toBe(false);
  });
});
