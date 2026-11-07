import { build } from "esbuild";
import { rmSync } from "node:fs";

// The CLI ships as one ESM file. The two runtime dependencies stay external, so
// the install pulls them at their own versions instead of duplicating them in a
// bundle, and the source can use extensionless imports that tsc and vitest both
// resolve.
rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/index.js",
  external: ["commander", "viem"],
  logLevel: "warning",
});
