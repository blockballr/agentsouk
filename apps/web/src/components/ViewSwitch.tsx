import { useLocation, useNavigate } from 'react-router-dom'
import { readStoredView, storeView, viewFromParam, type ShelfView } from '../lib/shelf-view'

// Shelf or Pro, from anywhere: it opens the marketplace in that view and keeps the
// filters when the marketplace is already open
export function ViewSwitch() {
  const location = useLocation()
  const navigate = useNavigate()
  const onMarket = location.pathname === '/agents'
  const params = new URLSearchParams(location.search)
  const active: ShelfView = (onMarket ? viewFromParam(params.get('view')) : null) ?? readStoredView()

  function choose(next: ShelfView) {
    storeView(next)
    const nextParams = onMarket ? new URLSearchParams(location.search) : new URLSearchParams()
    if (next === 'market') nextParams.set('view', 'pro')
    else nextParams.delete('view')
    const search = nextParams.toString()
    navigate(`/agents${search ? `?${search}` : ''}`, { replace: onMarket })
  }

  return (
    <span role="tablist" aria-label="Marketplace view" className="flex items-center gap-0.5 rounded-[7px] border border-souk-hair p-0.5">
      {(['shelf', 'market'] as const).map((v) => {
        const on = onMarket && active === v
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => choose(v)}
            className={`cursor-pointer rounded-[5px] px-2 py-0.5 text-[0.7rem] font-semibold transition-colors ${on ? 'bg-souk-surface2 text-souk-ink' : 'text-souk-steel hover:text-souk-ink'}`}
          >
            {v === 'shelf' ? 'Shelf' : 'Pro'}
          </button>
        )
      })}
    </span>
  )
}
