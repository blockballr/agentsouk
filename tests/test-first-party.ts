// Our own agents are disclosed on every card by the owner wallet the tracking
// addendum declares, so the label follows the chain rather than a hand-kept list.
import { describe, expect, it } from "vitest";
import { isOperatedByAgentSouk } from "../apps/web/src/lib/first-party";

describe("operated by Agent Souk", () => {
  it("labels the declared agent owner in any letter case", () => {
    expect(isOperatedByAgentSouk("0x84fedaBd1b83443aD86796C15619494878B64180")).toBe(true);
    expect(isOperatedByAgentSouk("0x84fedabd1b83443ad86796c15619494878b64180")).toBe(true);
  });

  it("never labels a third-party owner or a missing one", () => {
    expect(isOperatedByAgentSouk("0xdF1074a272C53A1a10b96Fa0201Eb58bbbaaFe00")).toBe(false);
    expect(isOperatedByAgentSouk(null)).toBe(false);
    expect(isOperatedByAgentSouk("")).toBe(false);
  });
});
