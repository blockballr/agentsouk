// The escrow is a tuple, not a status: funded plus verified plus a clock. These
// pin the phases the card, chip and reject path used to derive separately.
import { describe, expect, it } from "vitest";
import { deriveEscrow } from "../packages/core/src/machines/escrow";

const NOW = 1_800_000_000_000; // milliseconds
const WINDOW = 1_800_000_600; // seconds, ten minutes after NOW

describe("the escrow machine", () => {
  it("reads no escrow as unfunded", () => {
    const view = deriveEscrow({ now: NOW, status: null, verifiedAt: 0, windowEndsAt: null });
    expect(view.phase).toBe("unfunded");
    expect(view.actions).toEqual([]);
    expect(view.rejectMove).toBe("plain");
  });

  it("reads funded but unverified as held, with the refund exit", () => {
    const view = deriveEscrow({ now: NOW, status: 0, verifiedAt: 0, windowEndsAt: null });
    expect(view.phase).toBe("held");
    expect(view.actions).toEqual(["refund"]);
    expect(view.rejectMove).toBe("refund");
  });

  it("reads a verified delivery inside the window as open", () => {
    const view = deriveEscrow({ now: NOW, status: 0, verifiedAt: 1_799_999_000, windowEndsAt: WINDOW });
    expect(view.phase).toBe("window-open");
    expect(view.actions).toEqual(["release", "dispute"]);
    expect(view.autoReleaseAt).toBe(WINDOW * 1000);
    expect(view.releaseInSec).toBe(600);
    expect(view.rejectMove).toBe("reject");
  });

  it("reads a closed window as releasable and refuses a reject", () => {
    const view = deriveEscrow({ now: NOW, status: 0, verifiedAt: 1_799_990_000, windowEndsAt: 1_799_999_999 });
    expect(view.phase).toBe("releasable");
    expect(view.actions).toEqual(["release"]);
    expect(view.rejectMove).toBe("refuse");
    expect(view.releaseInSec).toBeNull();
  });

  it("treats the exact window boundary as closed", () => {
    const view = deriveEscrow({ now: NOW, status: 0, verifiedAt: 1_799_000_000, windowEndsAt: Math.floor(NOW / 1000) });
    expect(view.phase).toBe("releasable");
  });

  it("keeps an unrecorded window open rather than guessing a date", () => {
    const view = deriveEscrow({ now: NOW, status: 0, verifiedAt: 1_799_999_000, windowEndsAt: null });
    expect(view.phase).toBe("window-open");
    expect(view.autoReleaseAt).toBeNull();
    expect(view.releaseInSec).toBeNull();
  });

  it("reads released and refunded as terminal", () => {
    const released = deriveEscrow({ now: NOW, status: 1, verifiedAt: 1_799_000_000, windowEndsAt: WINDOW });
    expect(released.phase).toBe("released");
    expect(released.actions).toEqual([]);
    expect(released.rejectMove).toBe("refuse");

    const refunded = deriveEscrow({ now: NOW, status: 2, verifiedAt: 0, windowEndsAt: null });
    expect(refunded.phase).toBe("refunded");
    expect(refunded.actions).toEqual([]);
    expect(refunded.rejectMove).toBe("plain");
  });

  it("does not pretend an unknown status is funded", () => {
    const view = deriveEscrow({ now: NOW, status: 9, verifiedAt: 0, windowEndsAt: null });
    expect(view.phase).toBe("unknown");
    expect(view.actions).toEqual([]);
    expect(view.rejectMove).toBe("refuse");
  });
});
