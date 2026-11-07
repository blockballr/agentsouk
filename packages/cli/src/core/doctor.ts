import { apiRequest } from "./http";

export interface DoctorRow {
  check: string;
  ok: boolean;
  detail: string;
  ms: number;
}

// the two reads that decide whether anything else can work: the API answers and
// the chain the API serves is the one the config names
export async function runDoctor(apiUrl: string, chainId: number): Promise<DoctorRow[]> {
  const rows: DoctorRow[] = [];
  const started = Date.now();
  try {
    const chain = await apiRequest<{ chainId?: number; success?: boolean }>(apiUrl, "/api/chain", { timeoutMs: 8000 });
    const served = Number(chain?.chainId ?? 0);
    rows.push({
      check: "api",
      ok: true,
      detail: `chain ${served}`,
      ms: Date.now() - started,
    });
    rows.push({
      check: "chain",
      ok: served === chainId,
      detail: served === chainId ? `matches ${chainId}` : `api serves ${served}, config says ${chainId}`,
      ms: Date.now() - started,
    });
  } catch (error) {
    rows.push({ check: "api", ok: false, detail: (error as Error).message, ms: Date.now() - started });
  }
  const statusStarted = Date.now();
  try {
    const status = await apiRequest<{ data?: { store?: string; chainId?: number } }>(apiUrl, "/api/status", {
      timeoutMs: 8000,
    });
    const store = status?.data?.store ?? "unknown";
    rows.push({
      check: "status",
      ok: true,
      detail: `store ${store}`,
      ms: Date.now() - statusStarted,
    });
  } catch (error) {
    rows.push({ check: "status", ok: false, detail: (error as Error).message, ms: Date.now() - statusStarted });
  }
  return rows;
}
