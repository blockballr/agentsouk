import Link from "next/link";
import { ConnectButton } from "./connect-button";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" fill="#09090b" />
              <path
                d="M5 20c0-3 3-5 7-5s7 2 7 5"
                stroke="#09090b"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-zinc-50">
            Agent Souk
          </span>
          <span className="hidden rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium text-zinc-500 sm:inline-block">
            BSC
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/agents">Marketplace</NavLink>
          <NavLink href="/agents?category=rebalancing">Rebalancing</NavLink>
          <NavLink href="/agents?category=grid-trading">Grid Trading</NavLink>
          <NavLink href="/agents?category=yield">Yield</NavLink>
          <NavLink href="/agents?category=health-factor">Health Factor</NavLink>
          <NavLink href="/compare">Compare</NavLink>
        </nav>

        <ConnectButton />
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
    >
      {children}
    </Link>
  );
}