// The active account for a surface that acts: the address this browser signed
// in with, never whatever the provider happens to expose. A connected wallet
// with no signed record reads as no account, so a page cannot manage a
// notification feed or a security setting for an unauthorized address.
export { useConnectedAccount as useActiveAccount } from './use-connected-account'
