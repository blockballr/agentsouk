// persisted hire cart, keyed as chainId/tokenId; max 8 agents per checkout
// a window custom event keeps the nav badge and pages in sync

const KEY = 'agentsouk.cart'
const EVENT = 'agentsouk.cart.changed'
const MAX_ITEMS = 8

export interface CartItem {
  chainId: number
  tokenId: number
  name: string
  category: string
  addedAt: number
}

function itemKey(item: Pick<CartItem, 'chainId' | 'tokenId'>): string {
  return `${item.chainId}/${item.tokenId}`
}

export function cartKeyOf(chainId: number | string, tokenId: number | string): string {
  return `${chainId}/${tokenId}`
}

function persist(items: CartItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items))
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function getCart(): CartItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (x): x is CartItem =>
        x &&
        typeof x === 'object' &&
        typeof x.chainId === 'number' &&
        typeof x.tokenId === 'number' &&
        typeof x.name === 'string',
    )
  } catch {
    return []
  }
}

export type AddResult = 'added' | 'exists' | 'full'

export function addToCart(item: Omit<CartItem, 'addedAt'>): AddResult {
  const current = getCart()
  if (current.some((c) => itemKey(c) === itemKey(item))) return 'exists'
  if (current.length >= MAX_ITEMS) return 'full'
  persist([...current, { ...item, addedAt: Date.now() }])
  return 'added'
}

export function removeFromCart(chainId: number, tokenId: number): void {
  persist(getCart().filter((c) => itemKey(c) !== itemKey({ chainId, tokenId })))
}

export function clearCart(): void {
  persist([])
}

export function isInCart(chainId: number, tokenId: number): boolean {
  return getCart().some((c) => itemKey(c) === itemKey({ chainId, tokenId }))
}

export function cartCount(): number {
  return getCart().length
}

export const CART_MAX_ITEMS = MAX_ITEMS

// subscribe to cart changes (same tab and cross tab); returns unsubscribe
export function subscribe(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn()
  }
  window.addEventListener(EVENT, fn)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, fn)
    window.removeEventListener('storage', onStorage)
  }
}
