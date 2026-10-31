// Committed JSON is for tests and local work only.
export function snapshotServingAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" || env.SHELF_SNAPSHOT === "on";
}
