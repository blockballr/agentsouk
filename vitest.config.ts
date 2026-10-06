import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

// Build the resolve aliases from the app tsconfig through TypeScript's own
// parser, so the test resolver and `next build` share one path mapping and the
// two cannot drift. A paths entry like "@/*": ["./src/*"] becomes find "@" ->
// replacement "<root>/src", which their alias matchers extend to "@/lib/x".
function aliasesFromTsconfig(configPath: string) {
  const loaded = ts.readConfigFile(configPath, (file) => readFileSync(file, "utf8"));
  if (loaded.error) {
    throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  }
  const { options } = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    root,
    undefined,
    configPath,
  );
  return Object.entries(options.paths ?? {}).flatMap(([pattern, targets]) => {
    const target = targets[0];
    if (!target) return [];
    const find = pattern.replace(/\*$/, "").replace(/\/$/, "");
    const replacement = resolve(root, target.replace(/\*$/, ""));
    return [{ find, replacement }];
  });
}

export default defineConfig({
  resolve: {
    alias: {
      ...Object.fromEntries(aliasesFromTsconfig(resolve(root, "tsconfig.json")).map((a) => [a.find, a.replacement])),
      "server-only": resolve(root, "tests/server-only-stub.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.ts"],
    // the stub stands in for the "server-only" package under the runner; it is
    // not a suite and the broad include would otherwise collect it as one
    exclude: ["tests/server-only-stub.ts"],
  },
});
