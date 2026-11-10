// The skill is the written contract an agent reads, so it has to match the
// server: every tool, the production chain, and no testnet leftovers.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MCP_TOOLS } from "../src/lib/mcp-tools";
import { SKILL_DOCS, readSkillDoc } from "../src/lib/skill-files";

const router = readFileSync(path.join(process.cwd(), "skill", "SKILL.md"), "utf8");
const docs = Object.fromEntries(
  SKILL_DOCS.map((doc) => [doc, readFileSync(path.join(process.cwd(), "skill", doc), "utf8")]),
);
const all = Object.values(docs).join("\n");

describe("the skill matches the server", () => {
  it("names every MCP tool", () => {
    for (const tool of MCP_TOOLS) {
      expect(docs["reference/tools.md"], tool.name).toContain(tool.name);
    }
  });

  it("names the runbook as the primary", () => {
    expect(router).toContain("get_runbook");
    expect(docs["reference/tools.md"]).toContain("get_runbook");
  });

  it("routes to docs that exist", () => {
    const referenced = [...router.matchAll(/reference\/[a-z0-9-]+\.md/g)].map((m) => m[0]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const doc of new Set(referenced)) {
      expect(existsSync(path.join(process.cwd(), "skill", doc)), doc).toBe(true);
      expect(SKILL_DOCS, doc).toContain(doc);
    }
  });

  it("has no testnet leftovers", () => {
    for (const stale of ["sUSD", "Agent Souk Test USD", "eip155:97", "chain 97"]) {
      expect(all, stale).not.toContain(stale);
    }
  });

  it("names the production chain and settlement token", () => {
    expect(all).toContain("eip155:56");
    expect(all).toContain("United Stables");
    expect(all).toContain("0xcE24439F2D9C6a2289F741120FE202248B666666");
  });

  it("serves only the listed docs", async () => {
    expect(await readSkillDoc("SKILL.md")).toContain("Agent Souk");
    expect(await readSkillDoc("../package.json")).toBeNull();
    expect(await readSkillDoc("reference/nope.md")).toBeNull();
  });

  it("gives every doc a title", () => {
    for (const [name, text] of Object.entries(docs)) {
      expect(text.trimStart().startsWith("---") || text.trimStart().startsWith("#"), name).toBe(true);
      expect(text, name).toMatch(/^#{1,2} /m);
    }
  });
});
