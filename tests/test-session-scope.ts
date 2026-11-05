// A session grant names the contracts and functions it may call, plus the moment
// it lapses. The executor reads both before a sweep, so a vault redeploy or an
// expiring grant is a named state instead of an opaque UnauthorizedCall.
import { describe, expect, it } from "vitest";
import {
  daysUntil,
  isStaleTarget,
  missingFunctions,
  needsRenewal,
  readCallScope,
  readSessionScope,
  VAULT_FUNCTIONS,
} from "../src/lib/session-scope";

const VAULT = "0x028816557cb14b8edde51b34d937a063e05cf84e";
const OLD = "0x028129c230123a46f4305ce0d2b29f8ac5255149";

function blob(calls?: unknown): string {
  const permissions = calls === undefined ? { spend: [] } : { calls };
  return JSON.stringify({ walletAddress: "0xabc", publicKey: "0x04", permissions, expiry: 1 });
}

const bySignature = VAULT_FUNCTIONS.map((signature) => ({ signature }));

describe("session scope", () => {
  it("reads a contract rule", () => {
    const scope = readCallScope(blob([{ to: VAULT.toUpperCase() }]));
    expect(scope.unrestricted).toBe(false);
    expect(scope.rules).toEqual([{ to: VAULT, signature: null }]);
  });

  it("treats a grant with no calls list as unrestricted", () => {
    const scope = readCallScope(blob(undefined));
    expect(scope.unrestricted).toBe(true);
    expect(isStaleTarget(scope, VAULT)).toBe(false);
  });

  it("a contract rule that names the live vault reaches every function", () => {
    expect(missingFunctions(readCallScope(blob([{ to: VAULT }])), VAULT)).toEqual([]);
  });

  it("a contract rule that names another contract reaches nothing", () => {
    expect(missingFunctions(readCallScope(blob([{ to: OLD }])), VAULT)).toEqual([...VAULT_FUNCTIONS]);
  });

  it("function rules reach the vault without naming it, so a redeploy does not break them", () => {
    const scope = readCallScope(blob(bySignature));
    expect(scope.rules.every((rule) => rule.to === null)).toBe(true);
    expect(isStaleTarget(scope, VAULT)).toBe(false);
  });

  it("names the functions a partial grant cannot reach", () => {
    const scope = readCallScope(blob([{ signature: VAULT_FUNCTIONS[0] }]));
    expect(missingFunctions(scope, VAULT)).toEqual(VAULT_FUNCTIONS.slice(1));
    expect(isStaleTarget(scope, VAULT)).toBe(true);
  });

  it("treats an unreadable grant as stale rather than trusting it", () => {
    const scope = readCallScope("not json");
    expect(scope.rules).toEqual([]);
    expect(isStaleTarget(scope, VAULT)).toBe(true);
  });

  it("does not call a grant stale when no vault is configured", () => {
    expect(isStaleTarget(readCallScope(blob([{ to: OLD }])), null)).toBe(false);
  });

  it("counts the days left before expiry", () => {
    const now = Date.parse("2026-11-05T00:00:00Z");
    expect(daysUntil(Math.floor(now / 1000) + 86_400 * 10, now)).toBe(10);
    expect(daysUntil(Math.floor(now / 1000) - 86_400, now)).toBe(-1);
    expect(daysUntil(null, now)).toBeNull();
  });

  it("renews inside the window and leaves a fresh grant alone", () => {
    const now = Date.parse("2026-11-05T00:00:00Z");
    const inThree = Math.floor(now / 1000) + 86_400 * 3;
    const inTwenty = Math.floor(now / 1000) + 86_400 * 20;
    expect(needsRenewal(inThree, now, 7)).toBe(true);
    expect(needsRenewal(inTwenty, now, 7)).toBe(false);
    expect(needsRenewal(null, now, 7)).toBe(false);
  });

  it("composes the scope the routes report", () => {
    const now = Date.parse("2026-11-05T00:00:00Z");
    const expiry = Math.floor(now / 1000) + 86_400 * 2;
    const scope = readSessionScope("368655", "0xb815", blob([{ to: OLD }]), expiry, VAULT, now);
    expect(scope.stale).toBe(true);
    expect(scope.expiresInDays).toBe(2);
    expect(scope.targets).toEqual([OLD]);
  });

  it("reports function rules without inventing a target", () => {
    const now = Date.parse("2026-11-05T00:00:00Z");
    const scope = readSessionScope("368655", "0xb815", blob(bySignature), null, VAULT, now);
    expect(scope.targets).toEqual([]);
    expect(scope.signatures).toEqual([...VAULT_FUNCTIONS]);
    expect(scope.stale).toBe(false);
  });
});
