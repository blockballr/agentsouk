import { readFile } from "node:fs/promises";
import path from "node:path";

// The skill is shipped as markdown in skill/. The paths are literals so the
// deployment's file tracing includes them; the route only ever serves this map.
const FILES: Record<string, string> = {
  "SKILL.md": path.join(process.cwd(), "skill", "SKILL.md"),
  "reference/browse.md": path.join(process.cwd(), "skill", "reference", "browse.md"),
  "reference/hire-x402.md": path.join(process.cwd(), "skill", "reference", "hire-x402.md"),
  "reference/jobs.md": path.join(process.cwd(), "skill", "reference", "jobs.md"),
  "reference/publish.md": path.join(process.cwd(), "skill", "reference", "publish.md"),
  "reference/tools.md": path.join(process.cwd(), "skill", "reference", "tools.md"),
  "reference/vault.md": path.join(process.cwd(), "skill", "reference", "vault.md"),
};

export const SKILL_DOCS = Object.keys(FILES);

export async function readSkillDoc(key: string): Promise<string | null> {
  const file = FILES[key];
  if (!file) return null;
  // the paths are literals above and next.config traces skill/**; opting out here
  // keeps the tracer from pulling the whole project into every route
  return readFile(/*turbopackIgnore: true*/ file, "utf8").catch(() => null);
}
