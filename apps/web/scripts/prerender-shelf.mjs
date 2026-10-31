// Writes dist/agents/index.html with the shelf already in it, so a first visit
// to /agents paints real cards before the bundle runs. The app replaces the
// block on mount. If the API is unreachable the plain shell is copied instead.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const API = 'https://api.agentsouk.xyz'
const seed = Math.floor(Date.now() / 86_400_000).toString(36)

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function card(a) {
  const category = String(a.category ?? 'general').replace(/-/g, ' ').toUpperCase()
  const price = a.skills?.[0]?.examples?.[0]?.match(/(\d+(?:\.\d+)?)\s*(?:U|USDT|\$U)/i)?.[1]
  return `<a class="sc" href="/agents/${a.chain_id}/${a.token_id}"><span class="sc-c">${esc(category)}</span><span class="sc-n">${esc(a.name)}</span><span class="sc-p">${price ? `${esc(price)} U` : 'Open'}</span></a>`
}

try {
  const res = await fetch(`${API}/api/agents?type=jobs&metric=score&limit=24&seed=${seed}`)
  if (!res.ok) throw new Error(`agents ${res.status}`)
  const body = await res.json()
  const items = (body.items ?? []).slice(0, 24)
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const style = `<style>
    #boot-shell .grid { grid-template-columns: repeat(3, 1fr); }
    #boot-shell .sc { display:flex; flex-direction:column; gap:10px; min-height:120px; padding:16px; border:1px solid #1b2230; background:#11161f; color:#e7eef6; text-decoration:none; }
    #boot-shell .sc-c { font: 600 10px/1 ui-monospace, monospace; letter-spacing:.12em; color:#88deeb; }
    #boot-shell .sc-n { font-family: Georgia, serif; font-size:20px; line-height:1.2; }
    #boot-shell .sc-p { margin-top:auto; font: 600 12px/1 ui-monospace, monospace; color:#9fb0c3; }
    @media (max-width: 760px) { #boot-shell .grid { grid-template-columns: 1fr; } }
    </style></head>`
  const cards = items.length ? items.map(card).join('') : ''
  const out = html
    .replace('</head>', style)
    .replace(
      /<!-- BOOT_CARDS_START -->[\s\S]*?<!-- BOOT_CARDS_END -->/,
      `<!-- BOOT_CARDS_START -->${cards}<!-- BOOT_CARDS_END -->`,
    )
  mkdirSync(join(dist, 'agents'), { recursive: true })
  writeFileSync(join(dist, 'agents/index.html'), out)
  console.log(`prerendered ${items.length} agents into dist/agents/index.html`)
} catch (e) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  mkdirSync(join(dist, 'agents'), { recursive: true })
  writeFileSync(join(dist, 'agents/index.html'), html)
  console.log(`prerender skipped: ${e instanceof Error ? e.message : e}`)
}
