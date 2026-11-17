// the marketplace's two views; the link carries the choice, and this browser remembers the last one
export type ShelfView = 'shelf' | 'market'

const VIEW_KEY = 'souk.shelf-view'

export function readStoredView(): ShelfView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'market' ? 'market' : 'shelf'
  } catch {
    return 'shelf'
  }
}

export function storeView(view: ShelfView) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // storage can be blocked; the url still carries the choice
  }
}

export function viewFromParam(param: string | null): ShelfView | null {
  if (param === 'pro' || param === 'market') return 'market'
  if (param === 'shelf') return 'shelf'
  return null
}
