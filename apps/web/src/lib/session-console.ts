// mirrors src/lib/session-console.ts on the server; a test keeps the two equal
export type ConsoleAction = 'list' | 'renew' | 'revoke' | 'regrant'

export function consoleMessage(action: ConsoleAction, chainId: number, tokenId: string | null, wallet: string, at: number): string {
  return [
    'Agent Souk session console',
    `action: ${action}`,
    `chain: ${chainId}`,
    `agent: ${tokenId ?? 'all'}`,
    `by: ${wallet.toLowerCase()}`,
    `at ${at}`,
  ].join('\n')
}
