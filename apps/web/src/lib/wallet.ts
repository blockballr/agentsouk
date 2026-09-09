// EIP-1193 client with EIP-6963 multi-wallet discovery and WalletConnect.
// connectWallet() resolves the provider via the picker when several wallets
// announce themselves; a single detected wallet connects directly. All
// sign/chain calls operate on the chosen provider for the session.

import { hashTypedData, recoverAddress } from "viem";
import { TRANSFER_TYPES } from '@agora/core'

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
}

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    BinanceChain?: Eip1193Provider;
  }
}

export const BSC_CHAIN_ID_HEX = "0x38";

const BSC_CHAIN_PARAMS = {
  chainId: BSC_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.binance.org"],
  blockExplorerUrls: ["https://bscscan.com"],
};

export class WalletUnavailableError extends Error {
  constructor() {
    super("No wallet found. Install MetaMask or Binance Wallet to hire agents.");
  }
}

export class SmartWalletUnsupportedError extends Error {
  constructor() {
    super(
      "Smart wallet detected. Hiring currently supports standard (EOA) wallets only — please connect with MetaMask or another standard wallet. Smart wallet support is coming soon.",
    );
  }
}

// the wallet signed with a different account than the one connected: the
// recovered address proves it, so fail with both addresses instead of an
// opaque facilitator "signature verification failed"
export class WrongSignerError extends Error {
  constructor(recovered: string, expected: string) {
    const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
    super(
      `Signed by ${short(recovered)}, not ${short(expected)} — reconnect your wallet and retry.`,
    );
  }
}

// rdns values that always route through a smart account (ERC-4337): their
// typed-data signatures validate on-chain via ERC-1271 and our facilitator
// can only verify plain EOA ECDSA signatures today
const KNOWN_SMART_WALLET_RDNS = new Set(["com.coinbase.wallet"]);

// best-effort smart-account detection: known rdns, else a contract-code probe
// on the connected address (misses counterfactual accounts that are not yet
// deployed on the current chain — the known-rdns list covers those)
export async function isSmartWalletConnected(): Promise<boolean> {
  const rdns = readStoredRdns();
  if (rdns && rdns !== LEGACY_RDNS && rdns !== WALLETCONNECT_RDNS && KNOWN_SMART_WALLET_RDNS.has(rdns)) {
    return true;
  }
  try {
    const provider = await getProvider();
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    if (!accounts?.length) return false;
    const code = (await provider.request({
      method: "eth_getCode",
      params: [accounts[0], "latest"],
    })) as string;
    return typeof code === "string" && code.length > 2;
  } catch {
    return false;
  }
}

// a wallet the picker can offer; rdns is the announced rdns, 'legacy' for an
// older injected wallet that does not announce, or 'walletconnect'
export interface WalletOption {
  kind: "injected" | "walletconnect";
  rdns: string;
  name: string;
  icon?: string;
}

const LEGACY_RDNS = "legacy";
const WALLETCONNECT_RDNS = "walletconnect";
const STORAGE_KEY = "agora.wallet.rdns";

const announced = new Map<string, Eip6963ProviderDetail>();

function legacyProvider(): Eip1193Provider | undefined {
  return typeof window !== "undefined" ? window.ethereum ?? window.BinanceChain : undefined;
}

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e) => {
    const detail = (e as CustomEvent<Eip6963ProviderDetail>).detail;
    if (detail?.info?.rdns && detail.provider) {
      announced.set(detail.info.rdns, detail);
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function readStoredRdns(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeRdns(rdns: string | null): void {
  try {
    if (rdns) sessionStorage.setItem(STORAGE_KEY, rdns);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode: choice just does not survive refresh
  }
}

export function hasChosenWallet(): boolean {
  return readStoredRdns() !== null;
}

// wait once for late announcers before trusting the legacy fallback
let discoveryWait: Promise<void> | null = null;
function waitForDiscovery(): Promise<void> {
  if (!discoveryWait) {
    discoveryWait = new Promise<void>((resolve) => setTimeout(resolve, 250)).then(() => {
      if (announced.size === 0 && typeof window !== "undefined") {
        window.dispatchEvent(new Event("eip6963:requestProvider"));
      }
    });
  }
  return discoveryWait;
}

// injected wallets only (legacy fallback included); WalletConnect is added
// separately so the "exactly one wallet connects directly" rule only counts
// real extensions
export async function listInjectedWallets(): Promise<WalletOption[]> {
  await waitForDiscovery();
  const options: WalletOption[] = [...announced.values()].map((d) => ({
    kind: "injected",
    rdns: d.info.rdns,
    name: d.info.name,
    icon: d.info.icon,
  }));
  if (options.length === 0) {
    const legacy = legacyProvider();
    if (legacy) {
      options.push({
        kind: "injected",
        rdns: LEGACY_RDNS,
        name: legacy.isMetaMask ? "Detected wallet (MetaMask)" : "Detected wallet",
      });
    }
  }
  return options;
}

function pickerOptions(injected: WalletOption[]): WalletOption[] {
  return [
    ...injected,
    { kind: "walletconnect", rdns: WALLETCONNECT_RDNS, name: "WalletConnect" },
  ];
}

// --- WalletConnect (dynamic import keeps it out of the main bundle) ---

let wcProvider: Eip1193Provider | null = null;
let wcInit: Promise<Eip1193Provider> | null = null;

function wcProjectId(): string | undefined {
  return (import.meta.env.VITE_WC_PROJECT_ID as string | undefined) || undefined;
}

function initWalletConnect(): Promise<Eip1193Provider> {
  if (wcProvider) return Promise.resolve(wcProvider);
  if (!wcInit) {
    const projectId = wcProjectId();
    if (!projectId) {
      return Promise.reject(new Error("WalletConnect is not configured (missing project id)."));
    }
    wcInit = import("@walletconnect/ethereum-provider")
      .then(async ({ EthereumProvider }) => {
        const provider = await EthereumProvider.init({
          projectId,
          chains: [56],
          showQrModal: true,
          metadata: {
            name: "Agent Souk",
            description: "Hire AI agents on BNB Chain",
            url: typeof window !== "undefined" ? window.location.origin : "https://agentsouk",
            icons: [],
          },
        });
        wcProvider = provider;
        return provider;
      })
      .catch((e) => {
        wcInit = null;
        throw e;
      });
  }
  return wcInit;
}

// --- provider resolution ---

function resolveInjected(option: WalletOption): Eip1193Provider {
  if (option.rdns === LEGACY_RDNS) {
    const provider = legacyProvider();
    if (!provider) throw new WalletUnavailableError();
    return provider;
  }
  const detail = announced.get(option.rdns);
  if (!detail) throw new WalletUnavailableError();
  return detail.provider;
}

async function resolveProvider(option: WalletOption): Promise<Eip1193Provider> {
  if (option.kind === "walletconnect") return initWalletConnect();
  return resolveInjected(option);
}

// resolve the chosen provider for sign/chain calls. NO silent cross-wallet
// fallback: a stored rdns whose announced provider is missing must never
// route the signature to a different extension
export async function getProvider(): Promise<Eip1193Provider> {
  const rdns = readStoredRdns();
  if (rdns === WALLETCONNECT_RDNS) {
    if (wcProvider) return wcProvider;
    return initWalletConnect();
  }
  if (rdns === LEGACY_RDNS) {
    const legacy = legacyProvider();
    if (!legacy) throw new WalletUnavailableError();
    return legacy;
  }
  if (rdns) {
    const detail = announced.get(rdns);
    if (detail) return detail.provider;
    // extension not announced yet (reload?): re-request and wait briefly,
    // then fail instead of falling through to a different wallet
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    const retry = announced.get(rdns);
    if (retry) return retry.provider;
    throw new WalletUnavailableError();
  }
  const legacy = legacyProvider();
  if (legacy) return legacy;
  throw new WalletUnavailableError();
}

// open the picker UI (no-op fallback: legacy window provider); resolves null
// when the user dismisses it
let pickerSession: Promise<WalletOption | null> | null = null;
export async function openWalletPicker(): Promise<WalletOption | null> {
  const injected = await listInjectedWallets();
  const options = pickerOptions(injected);
  if (!pickerSession) {
    pickerSession = import("../components/WalletPicker")
      .then(({ showWalletPicker }) => showWalletPicker(options))
      .finally(() => {
        pickerSession = null;
      });
  }
  return pickerSession;
}

export function clearWalletChoice(): void {
  storeRdns(null);
  const wc = wcProvider;
  wcProvider = null;
  wcInit = null;
  try {
    (wc as { disconnect?(): void })?.disconnect?.();
  } catch {
    // already disconnected
  }
}

// --- EIP-1193 account/chain change handling ---
// an empty accountsChanged array (or leaving BSC) invalidates the stored
// connection; a different permitted account becoming active is handled at
// sign time by re-reading the active account (self-correcting), so only the
// empty case disconnects here

let activeProvider: Eip1193Provider | null = null;

function handleAccountsChanged(accounts: unknown): void {
  const list = Array.isArray(accounts) ? (accounts as string[]) : [];
  if (list.length === 0) {
    // disconnected in the wallet: drop the connection entirely
    clearWalletChoice();
  }
}

function handleChainChanged(chainId: unknown): void {
  // anything that is not BSC is treated as disconnected for hire purposes;
  // a stale wrong-chain connection must never reach the settle path
  if (typeof chainId === "string" && chainId.toLowerCase() !== BSC_CHAIN_ID_HEX) {
    clearWalletChoice();
  }
}

function detachProviderListeners(): void {
  if (activeProvider?.removeListener) {
    activeProvider.removeListener("accountsChanged", handleAccountsChanged);
    activeProvider.removeListener("chainChanged", handleChainChanged);
  }
  activeProvider = null;
}

function attachProviderListeners(provider: Eip1193Provider): void {
  if (!provider.on || !provider.removeListener) return;
  detachProviderListeners();
  activeProvider = provider;
  provider.on("accountsChanged", handleAccountsChanged);
  provider.on("chainChanged", handleChainChanged);
}

// belt-and-braces sign-time check: re-read the provider's active account and
// only proceed when it is still the address the hire is signing from
export async function activeAccountMatches(address: string): Promise<boolean> {
  try {
    const accounts = (await (await getProvider()).request({ method: "eth_accounts" })) as string[];
    return Array.isArray(accounts) && accounts[0]?.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

// the wallet's OWN active account at call time: eth_accounts returns all
// permitted accounts, and the FIRST entry is the currently active one in
// MetaMask/Rabby practice — signing uses this, so account switches
// self-correct instead of producing a stale `from`
export async function getActiveAccount(): Promise<string | null> {
  try {
    const accounts = (await (await getProvider()).request({ method: "eth_accounts" })) as string[];
    return Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : null;
  } catch {
    return null;
  }
}

async function requestAccounts(provider: Eip1193Provider): Promise<string> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.length) throw new Error("No account authorized.");
  attachProviderListeners(provider);
  return accounts[0];
}

export async function connectWallet(): Promise<string> {
  // 1. a choice made earlier this session (or WC restoring its pairing)
  const rdns = readStoredRdns();
  if (rdns) {
    if (rdns === WALLETCONNECT_RDNS) {
      try {
        return await requestAccounts(await initWalletConnect());
      } catch {
        // stale pairing or missing project id: fall through to discovery
        storeRdns(null);
      }
    } else if (rdns === LEGACY_RDNS) {
      const legacy = legacyProvider();
      if (legacy) return requestAccounts(legacy);
      storeRdns(null);
    } else {
      const detail = announced.get(rdns);
      if (detail) return requestAccounts(detail.provider);
      storeRdns(null);
    }
  }
  // 2. discovery: one wallet connects directly, several open the picker
  const injected = await listInjectedWallets();
  if (injected.length === 0) throw new WalletUnavailableError();
  let option: WalletOption;
  if (injected.length === 1) {
    option = injected[0];
  } else {
    const picked = await openWalletPicker();
    if (!picked) throw new WalletUnavailableError();
    option = picked;
  }
  const provider = await resolveProvider(option);
  storeRdns(option.rdns);
  return requestAccounts(provider);
}

// change-wallet affordance: drop the current choice, reopen the picker, and
// connect to whatever the user picks; resolves null when dismissed
export async function changeWallet(): Promise<string | null> {
  clearWalletChoice();
  const picked = await openWalletPicker();
  if (!picked) return null;
  const provider = await resolveProvider(picked);
  storeRdns(picked.rdns);
  return requestAccounts(provider);
}

// returns the active chain id after switching if needed
export async function ensureBscChain(): Promise<string> {
  const provider = await getProvider();
  const current = (await provider.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === BSC_CHAIN_ID_HEX) return current;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_ID_HEX }],
    });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code !== 4902 && code !== -32603) throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [BSC_CHAIN_PARAMS],
    });
  }
  return (await provider.request({ method: "eth_chainId" })) as string;
}

export async function signTransferAuthorization(
  address: string,
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  },
  message: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  },
): Promise<string> {
  const provider = await getProvider();
  const signature = (await provider.request({
    method: "eth_signTypedData_v4",
    params: [
      address,
      // string form: required by WalletConnect, accepted by MetaMask/Rabby
      JSON.stringify({
        domain,
        primaryType: "TransferWithAuthorization",
        types: TRANSFER_TYPES,
        message,
      }),
    ],
  })) as string;
  // client-side verification over exactly the typed data sent: a signature
  // that recovers to a different account (wrong injected wallet, stale
  // connection) is rejected here, before it can waste a settle attempt.
  // uint256 fields MUST be BigInts: viem encodes a decimal string differently
  // than the wallet's own ABI encoding, which would recover a garbage address
  // from a perfectly valid signature
  const recovered = await recoverAddress({
    hash: hashTypedData({
      domain: {
        ...domain,
        chainId: BigInt(domain.chainId),
        verifyingContract: domain.verifyingContract as `0x${string}`,
      },
      primaryType: "TransferWithAuthorization",
      types: TRANSFER_TYPES as unknown as Record<
        string,
        readonly { name: string; type: string }[]
      >,
      message: {
        from: message.from as `0x${string}`,
        to: message.to as `0x${string}`,
        value: BigInt(message.value),
        validAfter: BigInt(message.validAfter),
        validBefore: BigInt(message.validBefore),
        nonce: message.nonce as `0x${string}`,
      },
    }),
    signature: signature as `0x${string}`,
  });
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new WrongSignerError(recovered, address);
  }
  return signature;
}
