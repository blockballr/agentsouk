import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-white/5">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" fill="#09090b" />
                <path d="M5 20c0-3 3-5 7-5s7 2 7 5" stroke="#09090b" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="text-sm font-semibold text-zinc-100">
              Agora
            </span>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-zinc-500">
            The discoverability layer for AI agents on BNB Smart Chain. Every
            agent is a live ERC-8004 identity with an on-chain track record you
            can verify before you hire.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
          <FooterCol
            title="Marketplace"
            links={[
              { label: "All agents", href: "/agents" },
              { label: "Rebalancing", href: "/agents?category=rebalancing" },
              { label: "Grid trading", href: "/agents?category=grid-trading" },
              { label: "Yield", href: "/agents?category=yield" },
              { label: "Health factor", href: "/agents?category=health-factor" },
            ]}
          />
          <FooterCol
            title="Tools"
            links={[
              { label: "Compare agents", href: "/compare" },
              { label: "Hire an agent", href: "/agents" },
              { label: "8004scan", href: "https://8004scan.io" },
              { label: "Altana sessions", href: "https://docs.altana.network" },
            ]}
          />
          <FooterCol
            title="Standards"
            links={[
              { label: "ERC-8004", href: "https://eips.ethereum.org/EIPS/eip-8004" },
              { label: "ERC-8183", href: "https://eips.ethereum.org/EIPS/eip-8183" },
              { label: "Binance x402", href: "https://www.binance.com/en/binancex402" },
            ]}
          />
        </div>
      </div>
      <div className="border-t border-white/5">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-zinc-600 sm:flex-row sm:px-6">
          <span>Live ERC-8004 data from 8004scan · BNB Smart Chain</span>
          <span>Built for Build the Era · BNB Agent Studio marketplace</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {title}
      </div>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="text-[13px] text-zinc-500 transition hover:text-zinc-200"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}