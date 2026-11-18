// with no wallet linked, the assistant is told the exact line to give the user, for the surface it is
// on, and it is told never to talk about its tools
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, walletNote } from "../src/lib/assistant/brain";

describe("asking about your own agents with no wallet linked", () => {
  it("points a website user at the Connect button", () => {
    const note = walletNote(null, "web");
    expect(note).toContain("Connect button at the top of the page");
    expect(note).not.toContain("my_");
  });

  it("points a Telegram user at /link", () => {
    expect(walletNote(null, "telegram")).toContain("send /link here");
  });

  it("names the wallet once one is linked", () => {
    expect(walletNote("0xabc", "web")).toContain("0xabc");
  });

  it("forbids naming tools in replies", () => {
    expect(SYSTEM_PROMPT).toContain("Never mention your tools");
  });
});
