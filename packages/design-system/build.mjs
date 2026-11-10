import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const parts = ["tokens.css", "base.css", "components.css"];
const banner =
  "/* Midnight design system. Generated from packages/design-system/src. Do not edit by hand. */\n\n";

const sources = await Promise.all(parts.map((part) => readFile(resolve(root, "src", part), "utf8")));
const css = banner + sources.join("\n");

const outputs = [
  resolve(root, "dist/midnight.css"),
  resolve(root, "../../apps/agents/system.css"),
];

for (const output of outputs) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, css);
}

console.log("midnight: wrote " + outputs.length + " copies, " + css.length + " bytes");
