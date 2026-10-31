// Committed JSON is allowed for tests and local work, never for a deployed
// shelf. The brief forbids hardcoded agent lists, so production reads the store
// and the registry only.
export function snapshotServingAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" || env.SHELF_SNAPSHOT === "on";
}
