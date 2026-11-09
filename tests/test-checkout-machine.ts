// One money path, one order. These pin the transitions the four local unions
// used to imply separately, including the settled-payment rule.
import { describe, expect, it } from "vitest";
import {
  checkoutTransition,
  checkoutView,
  initialCheckout,
  type CheckoutEvent,
  type CheckoutState,
} from "../packages/core/src/machines/checkout";

function run(events: CheckoutEvent[]): CheckoutState {
  let state = initialCheckout();
  for (const event of events) {
    const next = checkoutTransition(state, event);
    if (!next.ok) throw new Error(next.reason);
    state = next.state;
  }
  return state;
}

describe("the checkout machine", () => {
  it("walks the happy path in order", () => {
    const state = run([
      { type: "connect" },
      { type: "requirements" },
      { type: "preview" },
      { type: "sign" },
      { type: "settle" },
      { type: "hired", paymentId: "pay_1", txHash: "0xabc" },
    ]);
    expect(state.phase).toBe("hired");
    expect(state.paymentId).toBe("pay_1");
    expect(checkoutView(state)).toMatchObject({ settled: true, retryable: false });
  });

  it("refuses a signature before the preview", () => {
    const next = checkoutTransition({ ...initialCheckout(), phase: "requirements", hasRequirements: true }, { type: "sign" });
    expect(next.ok).toBe(false);
    expect(next.reason).toMatch(/preview/);
  });

  it("refuses a settlement before a signature", () => {
    const next = checkoutTransition({ ...initialCheckout(), phase: "preview", hasRequirements: true, hasPreview: true }, { type: "settle" });
    expect(next.ok).toBe(false);
    expect(next.reason).toMatch(/signature/);
  });

  it("fails a settlement that returns no payment id", () => {
    const next = checkoutTransition({ ...initialCheckout(), phase: "settling" }, { type: "hired" });
    expect(next.ok).toBe(false);
    expect(next.state.phase).toBe("failed");
    expect(next.reason).toMatch(/no payment id/);
  });

  it("will not fail a payment that already settled", () => {
    const settled = { ...initialCheckout(), phase: "hired" as const, paymentId: "pay_1" };
    const next = checkoutTransition(settled, { type: "fail", error: "receipt read failed" });
    expect(next.ok).toBe(false);
    expect(next.state.phase).toBe("hired");
    expect(next.state.paymentId).toBe("pay_1");
  });

  it("reads a declined signature as cancelled and retryable", () => {
    const state = run([
      { type: "connect" },
      { type: "requirements" },
      { type: "preview" },
      { type: "sign" },
      { type: "fail", error: "User rejected", cancelled: true },
    ]);
    expect(state.phase).toBe("cancelled");
    expect(state.cancelled).toBe(true);
    expect(checkoutView(state).retryable).toBe(true);
  });

  it("refuses a hard failure from a settled payment", () => {
    const settled = { ...initialCheckout(), phase: "hired" as const, paymentId: "pay_1" };
    expect(checkoutTransition(settled, { type: "connect" }).ok).toBe(false);
    expect(checkoutTransition(settled, { type: "requirements" }).ok).toBe(false);
    expect(checkoutTransition(settled, { type: "sign" }).ok).toBe(false);
  });

  it("resets to idle", () => {
    const state = run([
      { type: "connect" },
      { type: "requirements" },
      { type: "fail", error: "boom" },
      { type: "reset" },
    ]);
    expect(state).toEqual(initialCheckout());
  });

  it("labels every phase", () => {
    for (const phase of ["idle", "connecting", "requirements", "preview", "signing", "settling", "hired", "failed", "cancelled"] as const) {
      expect(checkoutView({ ...initialCheckout(), phase }).label.length).toBeGreaterThan(0);
    }
  });
});
