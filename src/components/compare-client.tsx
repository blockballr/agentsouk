"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentDetail, CategoryKey } from "@/lib/types";
import { AgentAvatar } from "./agent-avatar";
import { CategoryBadge } from "./category-badge";
import { HireButton } from "./hire-button";
import { shortAddress, formatNumber, formatScore, formatDate } from "@/lib/format";
import { classifyAgent } from "@/lib/categories";
import { compareKey, readCompare } from "@/lib/compare-store";

interface DetailResponse {
  success: boolean;
  data: AgentDetail;
  error?: string;
}

export function CompareClient({ ids }: { ids: string[] }) {
  const [agents, setAgents] = useState<(AgentDetail & { category?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const idsKey = ids.join(",");

  useEffect(() => {
    const urlIds = idsKey.split(",").filter(Boolean);
    const stored = readCompare().map((a) => compareKey(a.chainId, a.tokenId));
    const unique = Array.from(new Set([...urlIds, ...stored]));
    Promise.all(
      unique.map(async (id) => {
        const [chainId, tokenId] = id.split(":");
        const res = await fetch(`/api/agents/${chainId}/${tokenId}`);
        const body = (await res.json()) as DetailResponse;
        return body.success ? body.data : null;
      }),
    )
      .then((results) => {
        const ok = results.filter(Boolean) as AgentDetail[];
        setAgents(
          ok.map((a) => ({
            ...a,
            category: classifyAgent(
              [a.name, a.description ?? "", (a.supported_trust_models ?? []).join(" ")].join(" "),
            ).category,
          })),
        );
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [idsKey]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4 py-10">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl border border-white/8 bg-zinc-900/60 animate-shimmer" />
        ))}
      </div>
    );
  }

  if (error || agents.length === 0) {
    return (
      <div className="rounded-2xl border border-white/8 p-16 text-center text-sm text-zinc-500">
        {error ?? "No agents selected for comparison."}
        <div className="mt-2">
          <Link href="/agents" className="text-amber-300">
            Browse the marketplace
          </Link>
        </div>
      </div>
    );
  }

  const rows: { label: string; render: (a: AgentDetail & { category?: string }) => React.ReactNode }[] = [
    { label: "Category", render: (a) => <CategoryBadge category={(a.category ?? "general") as CategoryKey | "general"} /> },
    { label: "Description", render: (a) => <p className="text-xs leading-relaxed text-zinc-500">{a.description || "—"}</p> },
    { label: "Verified", render: (a) => (a.is_verified ? <Yes /> : <No />) },
    { label: "Endpoint verified", render: (a) => (a.is_endpoint_verified ? <Yes /> : <No />) },
    { label: "x402 payments", render: (a) => (a.x402_supported ? <Yes /> : <No />) },
    { label: "Total score", render: (a) => <strong className="text-amber-300">{formatScore(a.total_score)}</strong> },
    { label: "Avg feedback", render: (a) => <span className="tabular-nums">{formatScore(a.average_score)}</span> },
    { label: "Hires", render: (a) => <span className="tabular-nums">{formatNumber(a.total_feedbacks)}</span> },
    { label: "Health score", render: (a) => <span className="tabular-nums">{a.health_score != null ? formatScore(a.health_score) : "—"}</span> },
    { label: "Quality", render: (a) => <span className="tabular-nums">{formatScore(a.quality_score)}</span> },
    { label: "Popularity", render: (a) => <span className="tabular-nums">{formatScore(a.popularity_score)}</span> },
    { label: "Activity", render: (a) => <span className="tabular-nums">{formatScore(a.activity_score)}</span> },
    { label: "Metadata", render: (a) => <span className="tabular-nums">{formatScore(a.metadata_completeness_score)}</span> },
    { label: "Trust models", render: (a) =>
        a.supported_trust_models.length ? (
          <div className="flex flex-wrap gap-1">{a.supported_trust_models.map((t) => <span key={t} className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400">{t}</span>)}</div>
        ) : <No /> },
    { label: "Receiving wallet", render: (a) => <span className="font-mono text-[11px] text-zinc-300">{shortAddress(a.agent_wallet ?? a.owner_address)}</span> },
    { label: "Owner", render: (a) => <span className="font-mono text-[11px] text-zinc-400">{shortAddress(a.owner_address)}</span> },
    { label: "Registered", render: (a) => <span>{formatDate(a.created_at)}</span> },
  ];

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/8">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-white/8 bg-zinc-900/80">
            <th className="w-44 p-4 text-xs font-medium uppercase tracking-wider text-zinc-600">
              Compare
            </th>
            {agents.map((a) => (
              <th key={a.agent_id} className="min-w-[220px] p-4 align-top">
                <div className="flex flex-col gap-2">
                  <div className="flex items-start gap-2.5">
                    <AgentAvatar name={a.name} image={a.image_url} size={40} />
                    <div>
                      <Link
                        href={`/agents/${a.chain_id}/${a.token_id}`}
                        className="text-sm font-semibold text-zinc-50 hover:text-amber-300"
                      >
                        {a.name}
                      </Link>
                      <div className="mt-0.5 text-[10px] text-zinc-600">#{a.token_id}</div>
                    </div>
                  </div>
                  <div>
                    <HireButton
                      agent={{
                        chainId: a.chain_id,
                        tokenId: a.token_id,
                        name: a.name,
                        image: a.image_url,
                        payTo: a.agent_wallet ?? a.owner_address,
                      }}
                    />
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.label} className={i % 2 === 0 ? "bg-zinc-950/40" : "bg-zinc-900/30"}>
              <td className="border-t border-white/5 px-4 py-3 text-xs font-medium text-zinc-500">
                {row.label}
              </td>
              {agents.map((a) => (
                <td key={a.agent_id} className="border-t border-white/5 px-4 py-3 text-zinc-300">
                  {row.render(a)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Yes() {
  return <span className="text-emerald-400">✓</span>;
}
function No() {
  return <span className="text-zinc-700">—</span>;
}