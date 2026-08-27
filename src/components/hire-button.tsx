"use client";

import { useState } from "react";
import { HireFlow, HireAgent } from "./hire-flow";

export function HireButton({ agent }: { agent: HireAgent }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300"
      >
        Hire this agent
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <HireFlow agent={agent} onClose={() => setOpen(false)} />}
    </>
  );
}