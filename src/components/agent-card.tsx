import Link from "next/link";
import { AgentSummary } from "@/lib/types";
import { AgentAvatar } from "./agent-avatar";
import { CategoryBadge } from "./category-badge";
import { formatNumber, formatScore, timeAgo } from "@/lib/format";

export function AgentCard({ agent }: { agent: AgentSummary }) {
  const href = `/agents/${agent.chain_id}/${agent.token_id}`;
  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-4 rounded-2xl border border-white/8 bg-zinc-900/60 p-5 transition hover:border-amber-400/25 hover:bg-zinc-900"
    >
      <div className="flex items-start justify-between gap-3">
        <AgentAvatar name={agent.name} image={agent.image_url} size={52} />
        <CategoryBadge category={agent.category ?? "general"} />
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="truncate text-[15px] font-semibold text-zinc-50">
          {agent.name}
        </h3>
        <p className="line-clamp-2 text-[13px] leading-relaxed text-zinc-500">
          {agent.description || "No description registered on-chain."}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-white/5 pt-3 text-xs text-zinc-500">
        <div className="flex items-center gap-3">
          {agent.x402_supported && (
            <span className="inline-flex items-center gap-1 text-emerald-400/90">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 12l2 2 4-4M12 3l7 4v5c0 4-3 7-7 8-4-1-7-4-7-8V7l7-4Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              x402
            </span>
          )}
          <span>
            {formatNumber(agent.total_feedbacks)} hires
          </span>
        </div>
        <span className="text-zinc-600">{timeAgo(agent.created_at)}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric
          label="Score"
          value={formatScore(agent.total_score)}
          strong
        />
        <Metric
          label="Avg"
          value={formatScore(agent.average_score)}
        />
        <Metric
          label="Health"
          value={
            agent.health_score !== null && agent.health_score !== undefined
              ? formatScore(agent.health_score)
              : "—"
          }
        />
      </div>
    </Link>
  );
}

function Metric({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-600">
        {label}
      </div>
      <div
        className={`text-sm tabular-nums ${strong ? "font-semibold text-amber-300" : "text-zinc-300"}`}
      >
        {value}
      </div>
    </div>
  );
}