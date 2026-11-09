// A kernel job is recorded twice: the marketplace row and the ERC-8183 kernel.
// They can disagree while a sweep catches up, and the chain is the authority for
// money and terminal state. This names the divergence and the actions that are
// actually available, instead of letting a route silently pick one side.

export type JobMirrorStatus = "Open" | "Funded" | "Submitted" | "Completed" | "Rejected" | "Expired";

export type JobMirrorSource = "chain" | "store" | "none";

export type JobMirrorAction = "complete" | "reject" | "claim-refund" | "wait";

export interface JobMirrorInput {
  /** the marketplace row's status, e.g. Funded */
  mirrorStatus: string | null;
  /** the kernel's uint8 status; null when the read failed or the job is unknown */
  chainStatus: number | null;
  /** ISO expiry, used to decide whether a refund is claimable */
  expiredAt?: string | null;
  /** milliseconds */
  now?: number;
}

export interface JobMirrorView {
  status: JobMirrorStatus | null;
  mirrorStatus: JobMirrorStatus | null;
  chainStatus: JobMirrorStatus | null;
  divergence: boolean;
  source: JobMirrorSource;
  allowedActions: JobMirrorAction[];
  reason: string;
}

// the ERC-8183 kernel's uint8 order
const CHAIN_STATUS: Record<number, JobMirrorStatus> = {
  0: "Open",
  1: "Funded",
  2: "Submitted",
  3: "Completed",
  4: "Rejected",
  5: "Expired",
};

const KNOWN: JobMirrorStatus[] = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

function mirrorOf(value: string | null): JobMirrorStatus | null {
  if (!value) return null;
  return KNOWN.includes(value as JobMirrorStatus) ? (value as JobMirrorStatus) : null;
}

function chainOf(value: number | null): JobMirrorStatus | null {
  if (value === null || value === undefined) return null;
  return CHAIN_STATUS[value] ?? null;
}

function actionsFor(status: JobMirrorStatus | null, refundable: boolean): JobMirrorAction[] {
  if (status === "Submitted") {
    return refundable ? ["complete", "reject", "claim-refund", "wait"] : ["complete", "reject", "wait"];
  }
  if (status === "Funded") return refundable ? ["reject", "claim-refund", "wait"] : ["reject", "wait"];
  if (status === "Open") return ["reject", "wait"];
  return ["wait"];
}

export function deriveJobMirror(input: JobMirrorInput): JobMirrorView {
  const mirror = mirrorOf(input.mirrorStatus);
  const chain = chainOf(input.chainStatus);
  const status = chain ?? mirror;
  const divergence =
    (chain !== null || mirror !== null) &&
    (chain === null || mirror === null || chain !== mirror);
  const source: JobMirrorSource = chain ? "chain" : mirror ? "store" : "none";

  const expiredAt = input.expiredAt ? Date.parse(input.expiredAt) : Number.NaN;
  const now = input.now ?? Date.now();
  const refundable = Number.isFinite(expiredAt) && now >= expiredAt;

  let reason: string;
  if (!chain && !mirror) {
    reason = "Neither the chain nor the marketplace record has a known status.";
  } else if (input.chainStatus !== null && chain === null) {
    reason = `The chain returned status ${input.chainStatus}, which this build does not recognise.`;
  } else if (chain && mirror && chain !== mirror) {
    reason = `The record says ${mirror}; the chain says ${chain}. The chain wins.`;
  } else if (chain && !mirror) {
    reason = `The chain says ${chain}; the marketplace has no record of it.`;
  } else if (!chain && mirror) {
    reason = `The chain did not answer; the marketplace record says ${mirror}.`;
  } else {
    reason = `The record and the chain agree on ${status}.`;
  }

  return {
    status,
    mirrorStatus: mirror,
    chainStatus: chain,
    divergence,
    source,
    allowedActions: actionsFor(status, refundable),
    reason,
  };
}
