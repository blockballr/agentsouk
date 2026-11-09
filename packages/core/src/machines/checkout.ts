// The checkout is one money path described by four incompatible unions in the
// app. This is the canonical order and the rules the runner enforces: terms
// before a signature, a signature before a settlement, and a settlement can
// never be turned back into a failure after it has a payment id.

export type CheckoutPhase =
  | "idle"
  | "connecting"
  | "requirements"
  | "preview"
  | "signing"
  | "settling"
  | "hired"
  | "failed"
  | "cancelled";

export interface CheckoutState {
  phase: CheckoutPhase;
  hasRequirements: boolean;
  hasPreview: boolean;
  paymentId: string | null;
  txHash: string | null;
  error: string | null;
  cancelled: boolean;
}

export type CheckoutEvent =
  | { type: "connect" }
  | { type: "requirements" }
  | { type: "preview" }
  | { type: "sign" }
  | { type: "settle" }
  | { type: "hired"; paymentId?: string | null; txHash?: string | null }
  | { type: "fail"; error: string; cancelled?: boolean }
  | { type: "reset" };

export interface CheckoutTransition {
  ok: boolean;
  state: CheckoutState;
  reason?: string;
}

export function initialCheckout(): CheckoutState {
  return {
    phase: "idle",
    hasRequirements: false,
    hasPreview: false,
    paymentId: null,
    txHash: null,
    error: null,
    cancelled: false,
  };
}

const TERMINAL_SETTLED: CheckoutPhase[] = ["hired"];

function refuse(state: CheckoutState, reason: string): CheckoutTransition {
  return { ok: false, state, reason };
}

export function checkoutTransition(state: CheckoutState, event: CheckoutEvent): CheckoutTransition {
  if (event.type === "reset") return { ok: true, state: initialCheckout() };

  if (event.type === "fail") {
    if (TERMINAL_SETTLED.includes(state.phase)) {
      return refuse(state, "The payment already settled; a later error cannot undo it.");
    }
    return {
      ok: true,
      state: {
        ...state,
        phase: event.cancelled ? "cancelled" : "failed",
        error: event.error,
        cancelled: Boolean(event.cancelled),
      },
    };
  }

  if (event.type === "hired") {
    if (state.phase !== "settling") {
      return refuse(state, `A hire cannot settle from ${state.phase}.`);
    }
    if (!event.paymentId) {
      return {
        ok: false,
        state: { ...state, phase: "failed", error: "The settlement returned no payment id." },
        reason: "The settlement returned no payment id.",
      };
    }
    return {
      ok: true,
      state: {
        ...state,
        phase: "hired",
        paymentId: event.paymentId,
        txHash: event.txHash ?? null,
        error: null,
        cancelled: false,
      },
    };
  }

  if (event.type === "connect") {
    if (state.phase !== "idle" && state.phase !== "failed" && state.phase !== "cancelled") {
      return refuse(state, `A wallet cannot connect while the checkout is ${state.phase}.`);
    }
    return {
      ok: true,
      state: { ...initialCheckout(), phase: "connecting" },
    };
  }

  if (event.type === "requirements") {
    if (state.phase !== "connecting" && state.phase !== "requirements") {
      return refuse(state, `Payment terms cannot load from ${state.phase}.`);
    }
    return { ok: true, state: { ...state, phase: "requirements", hasRequirements: true } };
  }

  if (event.type === "preview") {
    if (!state.hasRequirements) return refuse(state, "A preview needs the payment terms first.");
    if (state.phase !== "requirements" && state.phase !== "preview") {
      return refuse(state, `A preview cannot open from ${state.phase}.`);
    }
    return { ok: true, state: { ...state, phase: "preview", hasPreview: true } };
  }

  if (event.type === "sign") {
    if (!state.hasPreview) return refuse(state, "A signature needs the preview first.");
    if (state.phase !== "preview") return refuse(state, `A signature cannot start from ${state.phase}.`);
    return { ok: true, state: { ...state, phase: "signing", error: null, cancelled: false } };
  }

  if (event.type === "settle") {
    if (state.phase !== "signing") {
      return refuse(state, `A settlement cannot start from ${state.phase}; it needs a signature first.`);
    }
    return { ok: true, state: { ...state, phase: "settling" } };
  }

  return refuse(state, "Unknown checkout event.");
}

export interface CheckoutView {
  phase: CheckoutPhase;
  label: string;
  retryable: boolean;
  settled: boolean;
  reason: string | null;
}

const LABELS: Record<CheckoutPhase, string> = {
  idle: "Ready to hire",
  connecting: "Connecting your wallet",
  requirements: "Reading the payment terms",
  preview: "Review the terms",
  signing: "Waiting for your signature",
  settling: "Settling on chain",
  hired: "Hired",
  failed: "Hire failed",
  cancelled: "Cancelled",
};

export function checkoutView(state: CheckoutState): CheckoutView {
  return {
    phase: state.phase,
    label: LABELS[state.phase],
    retryable: state.phase === "failed" || state.phase === "cancelled",
    settled: state.phase === "hired",
    reason: state.error,
  };
}
