import { CategoryKey } from "@/lib/types";
import { categoryDef } from "@/lib/categories";

const STYLES: Record<string, string> = {
  rebalancing:
    "border-sky-400/25 bg-sky-400/10 text-sky-300",
  "grid-trading":
    "border-violet-400/25 bg-violet-400/10 text-violet-300",
  yield: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  "health-factor": "border-rose-400/25 bg-rose-400/10 text-rose-300",
  general: "border-white/15 bg-white/5 text-zinc-400",
};

export function CategoryBadge({
  category,
  showLabel = true,
}: {
  category: CategoryKey | "general";
  showLabel?: boolean;
}) {
  const def = category === "general" ? null : categoryDef(category);
  const label = def ? def.label : "General";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STYLES[category]}`}
    >
      {showLabel ? label : null}
    </span>
  );
}