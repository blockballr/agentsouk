// The wallet session is an authorization, not just the provider's current
// account. A late adoption must never overwrite a newer decision, so every
// intent (select, connect, disconnect, suspend) takes a ticket and a report
// that carries an older ticket is ignored. This is the rule the module's
// sequence counter enforces; the machine names the states around it.

export type SessionPhase =
  | "disconnected"
  | "selecting"
  | "connecting"
  | "connected"
  | "authorized"
  | "suspended";

export interface SessionState {
  phase: SessionPhase;
  address: string | null;
  /** monotonic intent ticket; a report older than this is stale */
  sequence: number;
  reason: string | null;
}

export type SessionEvent =
  | { type: "select" }
  | { type: "connect" }
  | { type: "report"; address: string; sequence: number; authorized: boolean }
  | { type: "authorize"; address: string; sequence: number }
  | { type: "disconnect" }
  | { type: "suspend"; reason?: string }
  | { type: "resume" };

export interface SessionTransition {
  ok: boolean;
  state: SessionState;
  reason?: string;
}

export function initialSession(): SessionState {
  return { phase: "disconnected", address: null, sequence: 0, reason: null };
}

function tick(state: SessionState, phase: SessionPhase, reason: string | null = null): SessionTransition {
  return {
    ok: true,
    state: { phase, address: phase === "authorized" ? state.address : null, sequence: state.sequence + 1, reason },
  };
}

export function sessionTransition(state: SessionState, event: SessionEvent): SessionTransition {
  if (event.type === "report") {
    if (event.sequence !== state.sequence) {
      return { ok: false, state, reason: "A wallet report older than the current decision was ignored." };
    }
    if (event.authorized) {
      return { ok: true, state: { ...state, phase: "authorized", address: event.address, reason: null } };
    }
    return {
      ok: true,
      state: { ...state, phase: "connected", address: event.address, reason: "This wallet has no signed session on this browser." },
    };
  }

  if (event.type === "authorize") {
    if (event.sequence !== state.sequence) {
      return { ok: false, state, reason: "A sign-in older than the current decision was ignored." };
    }
    return { ok: true, state: { ...state, phase: "authorized", address: event.address, reason: null } };
  }

  if (event.type === "select") return tick(state, "selecting");
  if (event.type === "connect") return tick(state, "connecting");
  if (event.type === "disconnect") return tick(state, "disconnected");
  if (event.type === "suspend") return tick(state, "suspended", event.reason ?? null);
  if (event.type === "resume") return tick(state, "disconnected");

  return { ok: false, state, reason: "Unknown session event." };
}

export function sessionView(state: SessionState): {
  phase: SessionPhase;
  authorized: boolean;
  label: string;
} {
  const labels: Record<SessionPhase, string> = {
    disconnected: "Not connected",
    selecting: "Choose a wallet",
    connecting: "Connecting",
    connected: "Connected, sign in to authorize",
    authorized: "Signed in",
    suspended: "Disconnected",
  };
  return { phase: state.phase, authorized: state.phase === "authorized", label: labels[state.phase] };
}
