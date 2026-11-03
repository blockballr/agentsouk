// What a category is allowed to do inside the vault. The vault enforces the
// money: floor, drawdown, slippage and the loss bound. This decides the shape of
// the hire, so a yield agent does not open as a swap and a category with no rail
// says so instead of pretending.

export type VaultPolicy = "grid" | "buffer" | "band" | "porter" | "none";

export type DepositShape = "pair" | "single";

export interface CategoryRail {
  category: string;
  policy: VaultPolicy;
  deposit: DepositShape;
  supported: boolean;
  actions: ("trade" | "supply" | "withdraw")[];
  note: string;
}

const RAILS: Record<string, Omit<CategoryRail, "category">> = {
  yield: {
    policy: "buffer",
    deposit: "single",
    supported: true,
    actions: ["supply", "withdraw"],
    note: "one stable asset into a lending venue, held until the buffer policy moves it",
  },
  "grid-trading": {
    policy: "grid",
    deposit: "pair",
    supported: true,
    actions: ["trade"],
    note: "a bound pair, traded inside the stored price floor",
  },
  rebalancing: {
    policy: "band",
    deposit: "pair",
    supported: true,
    actions: ["trade"],
    note: "a bound pair today; weights across more than two assets are not modelled yet",
  },
  "health-factor": {
    policy: "none",
    deposit: "single",
    supported: false,
    actions: [],
    note: "the vault has no borrow path, so a health factor cannot be defended on this rail yet",
  },
  general: {
    policy: "grid",
    deposit: "pair",
    supported: true,
    actions: ["trade"],
    note: "a bound pair, traded inside the stored price floor",
  },
};

export function categoryRail(category: string | null | undefined): CategoryRail {
  const key = (category ?? "").trim().toLowerCase();
  const rail = RAILS[key] ?? RAILS.general;
  return { category: key || "general", ...rail };
}

const FITS: Record<string, string[]> = {
  buffer: ["yield"],
  grid: ["grid-trading", "general"],
  band: ["rebalancing"],
  porter: ["rebalancing"],
};

export function policyMatchesCategory(policy: string | null, category: string | null): boolean {
  if (!policy) return true;
  const allowed = FITS[policy];
  if (!allowed) return false;
  return allowed.includes((category ?? "general").trim().toLowerCase() || "general");
}
