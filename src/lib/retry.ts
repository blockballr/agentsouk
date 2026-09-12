// retry policy for failed hire deliveries

export const MAX_DELIVERY_ATTEMPTS = 3;

export function shouldRetry(attempts: number, maxAttempts = MAX_DELIVERY_ATTEMPTS): boolean {
  return attempts < maxAttempts;
}

// exponential backoff in ms, capped at 30s
export function retryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30_000);
}
