// what to tell someone when their wallet fails during connect or sign-in: what
// happened, in plain words, and what to do next
export function walletErrorText(error: unknown): string {
  const e = error as { code?: number; message?: string } | null
  const message = (e?.message ?? '').toLowerCase()
  if (e?.code === 4001 || message.includes('declined') || message.includes('rejected')) {
    return 'You declined in your wallet, so nothing was connected. Connect again when you are ready.'
  }
  if (e?.code === -32002 || message.includes('already pending')) {
    return 'Your wallet already has a request waiting. Open the wallet extension to finish or close it, then try again.'
  }
  if (message.includes('no wallet found')) {
    return 'No wallet was found in this browser. Install MetaMask or Binance Wallet, or connect a phone wallet.'
  }
  if (message.includes('reached no wallet') || message.includes('timed out')) {
    return 'Your wallet did not answer. Open the extension, unlock it, and connect again. If it keeps failing, restart the extension or choose another wallet.'
  }
  if (message.includes('disconnected') || message.includes('crash') || message.includes('could not establish connection')) {
    return 'The wallet extension stopped responding. Restart it from your browser\'s extensions page, then connect again.'
  }
  return 'The wallet could not connect. Open it, unlock it, and try again, or choose another wallet.'
}
