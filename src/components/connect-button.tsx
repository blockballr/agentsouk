"use client";

import { useSyncExternalStore } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { shortAddress } from "@/lib/format";

const emptySubscribe = () => () => {};

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  if (!mounted) {
    return (
      <div className="h-9 w-36 rounded-lg bg-white/5 animate-shimmer" aria-hidden />
    );
  }

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300"
          title={address}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {shortAddress(address)}
        </span>
        <button
          onClick={() => disconnect()}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-white/20 hover:text-zinc-200"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: injected() })}
      className="group inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-zinc-900">
        <path
          d="M12 2v8m0 0-3-3m3 3 3-3M4 18h16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Connect wallet
    </button>
  );
}