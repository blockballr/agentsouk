// The escrow is a tuple, not a status: the contract keeps status=FUNDED after a
// verified delivery and lets the dispute window and the clock decide what may
// happen next. This derives the one phase, the buyer's verbs and the rejection
// move, so the card, the chip and the reject path cannot disagree.

export type EscrowPhase =
  | "unfunded"
  | "held"
  | "window-open"
  | "releasable"
  | "released"
  | "refunded"
  | "unknown";

export type EscrowAction = "release" | "refund" | "dispute";
export type EscrowRejectMoveKind = "plain" | "refund" | "reject" | "refuse";

export interface EscrowInput {
  /** milliseconds, the clock the UI already uses */
  now: number;
  /** 0 funded, 1 released, 2 refunded; null or undefined means no escrow */
  status: number | null | undefined;
  /** unix seconds, 0 when delivery has not been verified */
  verifiedAt: number;
  /** unix seconds, null when no dispute window was recorded */
  windowEndsAt: number | null;
}

export interface EscrowView {
  phase: EscrowPhase;
  released: boolean;
  refunded: boolean;
  verified: boolean;
  /** milliseconds, the date the agent is paid if nobody acts */
  autoReleaseAt: number | null;
  /** whole seconds until auto release, null outside an open window */
  releaseInSec: number | null;
  actions: EscrowAction[];
  rejectMove: EscrowRejectMoveKind;
  reason: string;
}

const FUNDED = 0;
const RELEASED = 1;
const REFUNDED = 2;

export function deriveEscrow(input: EscrowInput): EscrowView {
  const { now, status, verifiedAt, windowEndsAt } = input;

  if (status === null || status === undefined) {
    return {
      phase: "unfunded",
      released: false,
      refunded: false,
      verified: false,
      autoReleaseAt: null,
      releaseInSec: null,
      actions: [],
      rejectMove: "plain",
      reason: "No escrow was opened for this payment.",
    };
  }

  if (status === RELEASED) {
    return {
      phase: "released",
      released: true,
      refunded: false,
      verified: verifiedAt > 0,
      autoReleaseAt: null,
      releaseInSec: null,
      actions: [],
      rejectMove: "refuse",
      reason: "Released to the agent.",
    };
  }

  if (status === REFUNDED) {
    return {
      phase: "refunded",
      released: false,
      refunded: true,
      verified: verifiedAt > 0,
      autoReleaseAt: null,
      releaseInSec: null,
      actions: [],
      rejectMove: "plain",
      reason: "Refunded to your wallet.",
    };
  }

  if (status !== FUNDED) {
    return {
      phase: "unknown",
      released: false,
      refunded: false,
      verified: verifiedAt > 0,
      autoReleaseAt: null,
      releaseInSec: null,
      actions: [],
      rejectMove: "refuse",
      reason: `The escrow reported status ${status}, which this build does not recognise.`,
    };
  }

  if (verifiedAt === 0) {
    return {
      phase: "held",
      released: false,
      refunded: false,
      verified: false,
      autoReleaseAt: null,
      releaseInSec: null,
      actions: ["refund"],
      rejectMove: "refund",
      reason: "Held in escrow, waiting on delivery.",
    };
  }

  const autoReleaseAt = windowEndsAt !== null ? windowEndsAt * 1000 : null;
  const open = autoReleaseAt === null || autoReleaseAt > now;
  return {
    phase: open ? "window-open" : "releasable",
    released: false,
    refunded: false,
    verified: true,
    autoReleaseAt,
    releaseInSec: open && autoReleaseAt !== null ? Math.max(0, Math.ceil((autoReleaseAt - now) / 1000)) : null,
    actions: open ? ["release", "dispute"] : ["release"],
    rejectMove: open ? "reject" : "refuse",
    reason: open
      ? "Delivered verified, dispute window open."
      : "The dispute window has passed; the payment releases to the agent.",
  };
}
