// Committed JSON is for tests and local work only.
export function snapshotServingAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VITEST) return true;
  return env.NODE_ENV !== "production" || env.SHELF_SNAPSHOT === "on";
}
