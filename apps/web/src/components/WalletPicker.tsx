// wallet picker modal, opened by wallet.ts when several wallets are detected;
// self-mounting so any connect call site (detail page, compare bar, cart)
// gets the picker without wiring it into the tree

import { createRoot } from 'react-dom/client'
import type { WalletOption } from '../lib/wallet'

// oxlint-disable-next-line react/only-export-components
function WalletPicker({
  options,
  onPick,
}: {
  options: WalletOption[]
  onPick: (option: WalletOption | null) => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-press-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a wallet"
      onClick={() => onPick(null)}
    >
      <div
        className="w-full max-w-sm rounded-[4px] border hairline border-slate-verdant/30 bg-bone-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="micro text-newsprint-gray">Choose a wallet</p>
        <div className="mt-4 space-y-2">
          {options.map((o) => (
            <button
              key={o.rdns}
              type="button"
              onClick={() => onPick(o)}
              className="flex w-full items-center gap-3 rounded-[4px] border hairline border-slate-verdant/30 px-4 py-3 text-left transition hover:border-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
            >
              {o.icon ? (
                <img src={o.icon} alt="" className="h-7 w-7 rounded-[4px]" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-slate-verdant/10 font-mono text-[10px] text-press-black">
                  {o.kind === 'walletconnect' ? 'WC' : o.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="text-sm text-press-black">{o.name}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onPick(null)}
          className="micro mt-4 w-full rounded-[4px] border hairline border-slate-verdant/30 px-4 py-3 text-newsprint-gray transition hover:text-press-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export function showWalletPicker(options: WalletOption[]): Promise<WalletOption | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = (option: WalletOption | null) => {
      root.unmount()
      host.remove()
      resolve(option)
    }
    root.render(<WalletPicker options={options} onPick={done} />)
  })
}
