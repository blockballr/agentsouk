// A defence job names the buyer and, optionally, the operator. The parser decides
// whether a funded job is a defence at all, so it must not fire on a read task.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseDefenceTask } from "../src/lib/health-defence";

const BUYER = "0x1111111111111111111111111111111111111111";
const OPERATOR = "0x2222222222222222222222222222222222222222";
const DEFAULT_OPERATOR = "0x3333333333333333333333333333333333333333";

describe("defence task parser", () => {
  it("reads the buyer and the named operator", () => {
    const parsed = parseDefenceTask(`Defend my portfolio. buyer ${BUYER} operator ${OPERATOR}`);
    expect(parsed?.buyer).toBe(BUYER);
    expect(parsed?.operator).toBe(OPERATOR);
  });

  it("falls back to the configured operator", () => {
    const parsed = parseDefenceTask(`defend buyer ${BUYER}`, DEFAULT_OPERATOR as `0x${string}`);
    expect(parsed?.operator).toBe(DEFAULT_OPERATOR);
  });

  it("is not a defence without the word", () => {
    expect(parseDefenceTask(`What is the health factor for buyer ${BUYER}`)).toBeNull();
  });

  it("needs a buyer address", () => {
    expect(parseDefenceTask(`Defend my portfolio operator ${OPERATOR}`)).toBeNull();
  });

  it("needs an operator from the task or the deployment", () => {
    expect(parseDefenceTask(`Defend my portfolio buyer ${BUYER}`)).toBeNull();
  });

  it("ignores a partial address", () => {
    expect(parseDefenceTask("Defend buyer 0x1234 operator " + OPERATOR)).toBeNull();
  });
});
