import Link from "next/link";
import { ConnectButton } from "./connect-button";

// the designed lockup on press-black: parchment arch, Souk in fraunces 600
// with the green swipe under the o, and the market tagline
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 64 64">
            <path d="M15 58 V34 Q15 16 32 8 Q49 16 49 34 V58" fill="none" stroke="#fafffa" strokeWidth="7" strokeLinecap="square" />
            <circle cx="32" cy="38" r="6.5" fill="#2bee4b" />
          </svg>
          <span className="relative inline-block font-['Fraunces_Variable',ui-serif,Georgia,serif] text-[20px] font-semibold leading-[0.9] tracking-[-0.04em] text-[#fafffa]">
            S<span className="relative">o<span aria-hidden="true" className="absolute bottom-[0.09em] left-[14%] h-[0.055em] w-[58%] bg-[#2bee4b]" /></span>uk
          </span>
          <span className="hidden text-[11px] font-medium uppercase tracking-[0.06em] text-[#c8d2c8] lg:inline">
            The agent market on BNB
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
