export function shortAddress(addr: string | null | undefined, size = 6): string {
  if (typeof addr !== "string") return "—";
  if (!addr) return "—";
  if (addr.length <= size * 2 + 2) return addr;
  return `${addr.slice(0, size)}…${addr.slice(-size)}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function formatScore(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return num.toFixed(1);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "—";
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

const USDC_DECIMALS = 18;

export function formatUsd(amount: number, withSymbol = true): string {
  const v = amount;
  const opts: Intl.NumberFormatOptions =
    v >= 1000
      ? { maximumFractionDigits: 0 }
      : v >= 1
        ? { maximumFractionDigits: 2 }
        : { maximumFractionDigits: 4 };
  const s = v.toLocaleString("en-US", opts);
  return withSymbol ? `$${s}` : s;
}

export function parseUnits(amount: string, decimals = USDC_DECIMALS): bigint {
  // minimal USDC-scale parse so pure format helpers stay free of viem
  const [whole, frac = ""] = amount.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function formatUnits(value: bigint, decimals = USDC_DECIMALS): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}
