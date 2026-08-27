"use client";

import Link from "next/link";
import { CompareAgent } from "@/lib/compare-store";
import { AgentAvatar } from "./agent-avatar";

export function CompareBar({
  selected,
  onRemove,
}: {
  selected: CompareAgent[];
  onRemove: (key: string) => void;
}) {
  if (selected.length === 0) return null;

  const ids = selected.map((a) => `${a.chainId}:${a.tokenId}`).join(",");

  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/95 p-3 shadow-2xl shadow-black/60 backdrop-blur-xl">
        <div className="flex -space-x-2">
          {selected.map((a) => (
            <button
              key={a.key}
              onClick={() => onRemove(a.key)}
              title={`Remove ${a.name}`}
              className="relative rounded-lg transition hover:opacity-70"
            >
              <AgentAvatar name={a.name} image={a.image} size={34} />
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[9px] text-zinc-400 ring-1 ring-white/20">
                ×
              </span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-zinc-500 sm:inline">
            {selected.length} selected
          </span>
          <button
            onClick={() => onRemove("__all__")}
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition hover:text-zinc-200"
          >
            Clear
          </button>
          <Link
            href={`/compare?ids=${ids}`}
            className="rounded-lg bg-amber-400 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 transition hover:bg-amber-300"
          >
            Compare
          </Link>
        </div>
      </div>
    </div>
  );
}