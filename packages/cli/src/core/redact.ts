// Nothing the CLI prints may carry key material. A 32 byte hex string is the
// shape of every private key, and registration pastes may carry prefixed keys,
// so both are masked at the door.
export function redact(input: string): string {
  return input
    .replace(/0x[0-9a-fA-F]{64}/g, "0x<redacted>")
    .replace(/\b(AGENTSOUK_KEY|PRIVATE_KEY|SECRET|TOKEN)=([^\s]+)/gi, "$1=<redacted>");
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redact(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /key|secret|token|signature/i.test(key) && typeof item === "string" ? "<redacted>" : redactValue(item);
    }
    return out as T;
  }
  return value;
}
