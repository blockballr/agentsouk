// The wallet session is an authorization, and a late report must not overwrite
// a newer intent. These pin the ticket rule the runtime counter enforces.
import { describe, expect, it } from "vitest";
import {
  initialSession,
  sessionTransition,
  sessionView,
  type SessionState,
} from "../packages/core/src/machines/session";

function connect(): SessionState {
  const next = sessionTransition(initialSession(), { type: "connect" });
  expect(next.ok).toBe(true);
  return next.state;
}

describe("the wallet session machine", () => {
  it("starts disconnected with a zero ticket", () => {
    const state = initialSession();
    expect(state.phase).toBe("disconnected");
    expect(state.sequence).toBe(0);
    expect(sessionView(state).authorized).toBe(false);
  });

  it("takes a new ticket on connect", () => {
    const state = connect();
    expect(state.phase).toBe("connecting");
    expect(state.sequence).toBe(1);
  });

  it("ignores a report older than the current intent", () => {
    const state = connect();
    const next = sessionTransition(state, {
      type: "report",
      address: "0x1111111111111111111111111111111111111111",
      sequence: 0,
      authorized: true,
    });
    expect(next.ok).toBe(false);
    expect(next.state.phase).toBe("connecting");
  });

  it("authorizes a report that carries the current ticket", () => {
    const state = connect();
    const next = sessionTransition(state, {
      type: "report",
      address: "0x1111111111111111111111111111111111111111",
      sequence: state.sequence,
      authorized: true,
    });
    expect(next.ok).toBe(true);
    expect(next.state.phase).toBe("authorized");
    expect(sessionView(next.state).authorized).toBe(true);
  });

  it("shows a connected wallet without a signed record as unverified", () => {
    const state = connect();
    const next = sessionTransition(state, {
      type: "report",
      address: "0x2222222222222222222222222222222222222222",
      sequence: state.sequence,
      authorized: false,
    });
    expect(next.ok).toBe(true);
    expect(next.state.phase).toBe("connected");
    expect(sessionView(next.state).authorized).toBe(false);
    expect(next.state.reason).toMatch(/signed session/);
  });

  it("ignores a sign-in from an older intent", () => {
    const state = connect();
    const next = sessionTransition(state, {
      type: "authorize",
      address: "0x1111111111111111111111111111111111111111",
      sequence: state.sequence - 1,
    });
    expect(next.ok).toBe(false);
    expect(next.state.phase).toBe("connecting");
  });

  it("invalidates an in-flight adoption on disconnect", () => {
    const state = connect();
    const gone = sessionTransition(state, { type: "disconnect" });
    expect(gone.state.phase).toBe("disconnected");
    expect(gone.state.sequence).toBe(state.sequence + 1);
    const late = sessionTransition(gone.state, {
      type: "report",
      address: "0x1111111111111111111111111111111111111111",
      sequence: state.sequence,
      authorized: true,
    });
    expect(late.ok).toBe(false);
    expect(late.state.phase).toBe("disconnected");
  });

  it("keeps a suspension until a resume", () => {
    const state = sessionTransition(connect(), { type: "suspend", reason: "user left" });
    expect(state.state.phase).toBe("suspended");
    expect(state.state.reason).toBe("user left");
    const resumed = sessionTransition(state.state, { type: "resume" });
    expect(resumed.state.phase).toBe("disconnected");
  });

  it("labels every phase", () => {
    for (const phase of ["disconnected", "selecting", "connecting", "connected", "authorized", "suspended"] as const) {
      expect(sessionView({ ...initialSession(), phase }).label.length).toBeGreaterThan(0);
    }
  });
});
