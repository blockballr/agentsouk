// Committed JSON is for tests and local work only.
export function snapshotServingAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return env.SHELF_SNAPSHOT === "on";
  return true;
}
