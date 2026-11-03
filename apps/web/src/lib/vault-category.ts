// What a category is allowed to do inside the vault. The vault enforces the
// money: floor, drawdown, slippage and the loss bound. This decides the shape of
// the hire and the form a buyer sees, so a yield agent does not open as a swap
// and a category with no rail says so instead of pretending.

export type VaultPolicy = "grid" | "buffer" | "band" | "porter" | "none";

export type DepositShape = "pair" | "single";

export interface CategoryUi {
  title: string;
  heading: string;
  depositLabel: string;
  showsSlippage: boolean;
  showsPoolChoice: boolean;
  poolNote: string;
  actionLine: string;
  unsupported: { title: string; body: string } | null;
}

export interface CategoryRail {
  category: string;
  label: string;
  policy: VaultPolicy;
  deposit: DepositShape;
  supported: boolean;
  actions: ("trade" | "supply" | "withdraw")[];
  note: string;
  ui: CategoryUi;
}

const RAILS: Record<string, Omit<CategoryRail, "category" | "supported"> & { supported?: boolean }> = {
  yield: {
    label: "Yield",
    policy: "buffer",
    deposit: "single",
    supported: true,
    actions: ["supply", "withdraw"],
    note: "one asset, supplied to a venue",
    ui: {
      title: "Hire an agent that puts one asset to work.",
      heading: "Open a yield hire",
      depositLabel: "Deposit one asset",
      showsSlippage: false,
      showsPoolChoice: false,
      poolNote: "USDT is valued against the WBNB pair once at open, so the floor and the loss bound have a price.",
      actionLine:
        "The open names the agent, the deposit, the venue and the term. The agent may supply and withdraw only, and one buyer withdraw returns the balance held.",
      unsupported: null,
    },
  },
  "grid-trading": {
    label: "Grid",
    policy: "grid",
    deposit: "pair",
    supported: true,
    actions: ["trade"],
    note: "a bound pair inside the price floor",
    ui: {
      title: "Hire an agent that grids a bound pair.",
      heading: "Open a grid hire",
      depositLabel: "Deposit token",
      showsSlippage: true,
      showsPoolChoice: true,
      poolNote: "Deepest pool with 30 minutes of price history. Locked when the hire opens.",
      actionLine:
        "The open names the agent, the deposit, the expiry, the slippage ceiling and the fee tier in one call. The approval is scoped to the exact deposit.",
      unsupported: null,
    },
  },
  rebalancing: {
    label: "Rebalance",
    policy: "band",
    deposit: "pair",
    supported: true,
    actions: ["trade"],
    note: "a bound pair holding a target weight",
    ui: {
      title: "Hire an agent that holds a target weight.",
      heading: "Open a rebalance hire",
      depositLabel: "Deposit token",
      showsSlippage: true,
      showsPoolChoice: true,
      poolNote: "The pair the policy measures drift against. Locked when the hire opens.",
      actionLine:
        "The open names the agent, the deposit and the bounds. The agent trades between the two assets to hold the target weight, and never leaves the pair.",
      unsupported: null,
    },
  },
  "health-factor": {
    label: "Health factor",
    policy: "none",
    deposit: "single",
    supported: false,
    actions: [],
    note: "no borrow path on this rail",
    ui: {
      title: "Hire an agent that defends a debt.",
      heading: "Health factor",
      depositLabel: "Not available",
      showsSlippage: false,
      showsPoolChoice: false,
      poolNote: "",
      actionLine: "",
      unsupported: {
        title: "This category is not on the vault rail yet",
        body:
          "The vault holds an asset and trades a pair. It cannot borrow, so there is no debt to defend here. This listing is still hireable on the other rails.",
      },
    },
  },
  "not-declared": {
    label: "Vault",
    policy: "grid",
    deposit: "pair",
    supported: true,
    actions: ["trade"],
    note: "category not declared on this listing",
    ui: {
      title: "Hire an agent on the vault.",
      heading: "Open a vault hire",
      depositLabel: "Deposit token",
      showsSlippage: true,
      showsPoolChoice: true,
      poolNote: "Deepest pool with 30 minutes of price history. Locked when the hire opens.",
      actionLine: "",
      unsupported: null,
    },
  },
};

export function categoryRail(category: string | null | undefined): CategoryRail {
  const key = (category ?? "").trim().toLowerCase();
  const rail = RAILS[key] ?? RAILS["not-declared"];
  return { category: key || "not-declared", supported: rail.supported !== false, ...rail };
}

const FITS: Record<string, string[]> = {
  buffer: ["yield"],
  grid: ["grid-trading"],
  band: ["rebalancing"],
  porter: ["rebalancing"],
};

export function policyMatchesCategory(policy: string | null, category: string | null): boolean {
  if (!policy) return true;
  const key = (category ?? "").trim().toLowerCase();
  if (!key) return true;
  const allowed = FITS[policy];
  if (!allowed) return false;
  return allowed.includes(key);
}
