// A hire signs an authorisation that exists only in memory, so a stale chunk reload
// during that window loses the payment. These pin the marker that stands the reload
// down mid-payment and the one-reload window that still applies outside a payment.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PAYMENT_IN_FLIGHT_KEY,
  reloadOnceForStaleChunk,
  setPaymentInFlight,
} from "../apps/web/src/lib/stale-chunk";

interface BrowserStub {
  data: Map<string, string>;
  reloads: number;
}

function installBrowser(): BrowserStub {
  const stub: BrowserStub = { data: new Map(), reloads: 0 };
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => (stub.data.has(key) ? stub.data.get(key)! : null),
    setItem: (key: string, value: string) => {
      stub.data.set(key, value);
    },
    removeItem: (key: string) => {
      stub.data.delete(key);
    },
  });
  vi.stubGlobal("window", {
    location: {
      reload: () => {
        stub.reloads += 1;
      },
    },
  });
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the stale chunk reload guard", () => {
  it("stands down while a payment is in flight", () => {
    const browser = installBrowser();
    setPaymentInFlight(true);

    expect(browser.data.get(PAYMENT_IN_FLIGHT_KEY)).toBe("1");
    expect(reloadOnceForStaleChunk()).toBe(false);
    expect(browser.reloads).toBe(0);
  });

  it("reloads once, then stays down for the rest of the window", () => {
    const browser = installBrowser();

    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(browser.reloads).toBe(1);

    // a second stale chunk moments later must not loop the reload
    expect(reloadOnceForStaleChunk()).toBe(false);
    expect(browser.reloads).toBe(1);
  });

  it("reloads again once the payment has cleared", () => {
    const browser = installBrowser();
    setPaymentInFlight(true);
    expect(reloadOnceForStaleChunk()).toBe(false);

    setPaymentInFlight(false);
    expect(browser.data.has(PAYMENT_IN_FLIGHT_KEY)).toBe(false);
    expect(reloadOnceForStaleChunk()).toBe(true);
    expect(browser.reloads).toBe(1);
  });
});
