import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // build output and gitignored local tooling: neither is shipped source, and
    // the minified bundles parse as binary rather than as JavaScript
    "dist/**",
    "**/dist/**",
    ".local-scripts/**",
  ]),
]);

export default eslintConfig;
