// the picture a quester shares once their passport is complete: an open passport, the
// identity page on the left and the stamped visa page on the right. It is drawn here, in
// their own browser, from what the passport page already shows; the picture is never uploaded

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630
// drawn at twice the size, so it stays sharp when an app scales it
const SCALE = 2

export const SHARE_URL = 'https://agentsouk.xyz/quest'
export const SHARE_CAPTION =
  "I collected my Souk passport on Agent Souk: hired agents and listed one of my own, for BNB Chain's Set and Earn."

export interface ShareCardData {
  rank: string
  points: number
  // the holder's address, or nothing when they chose to leave it off the card
  holder: string | null
  issued: Date
  // what the stamps and the portrait are laid out from, so one wallet's card is always
  // the same picture
  seed: string
  // the passport's number, issued once to the wallet; without one the foot shows the date
  serial: string | null
  // the extra hire, which a finished passport may or may not carry
  thirdHire: boolean
}

// the number on the card made for the announcement; holders' numbers count on from it
export const SPECIMEN_SERIAL = '0110000'

// the brand's own colours, fixed: a shared picture looks the same whatever theme drew it
const BONE = '#fafffa'
const PAPER = '#f1f7f1'
const BLACK = '#121613'
const GRAY = '#516254'
const SAGE = '#c8d2c8'
const GREEN = '#2bee4b'
// stamp ink: the green dark enough to read on paper
const INK = '#0f7a28'
const BNB_YELLOW = '#f0b90b'

const SERIF = '"Fraunces Variable", Georgia, "Times New Roman", serif'
const SANS = '"Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace'

// the BNB mark, on a 24 unit grid
const BNB_MARK =
  'M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0115l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6595-2.7174-2.7154 7.353-7.353z'

const STALL = 'OWN STALL'
// the most stamps a passport can carry: three hires and the stall
const MOST_VISAS = 4
const COUNT_WORD = ['NONE', 'ONE', 'TWO', 'THREE', 'FOUR']

// the stamps a finished passport holds: its two hires and its stall, and the third hire if made
function visasFor(thirdHire: boolean): { label: string; note: string }[] {
  return [
    { label: 'FIRST HIRE', note: 'HIRED' },
    { label: 'SECOND HIRE', note: 'HIRED' },
    ...(thirdHire ? [{ label: 'THIRD HIRE', note: 'HIRED' }] : []),
    { label: STALL, note: 'LISTED' },
  ]
}

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string }

function box(ctx: Ctx, x: number, y: number, w: number, h: number, radius: number): void {
  ctx.beginPath()
  // an older browser has no rounded rectangle; square corners still give a whole card
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, radius)
  else ctx.rect(x, y, w, h)
}

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  opts: { align?: CanvasTextAlign; spacing?: number } = {},
): void {
  ctx.font = font
  ctx.fillStyle = fill
  ctx.textAlign = opts.align ?? 'left'
  // where a browser cannot space letters the type is simply set a little looser
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${opts.spacing ?? 0}px`
  ctx.fillText(value, x, y)
}

// the largest size at which a line fits, so a long title never runs off the page
function fitted(ctx: Ctx, value: string, family: string, weight: number, size: number, max: number): number {
  let s = size
  for (; s > 18; s -= 1) {
    ctx.font = `${weight} ${s}px ${family}`
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
    if (ctx.measureText(value).width <= max) break
  }
  return s
}

async function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  await Promise.all(
    [`500 40px ${SERIF}`, `600 30px ${SERIF}`, `600 13px ${SANS}`, `400 18px ${SANS}`].map((f) => document.fonts.load(f).catch(() => [])),
  )
}

export function issuedLabel(date: Date): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return `${String(date.getUTCDate()).padStart(2, '0')} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

// the last four are never printed. The portrait and the stamp layout are drawn from the
// whole address whether the holder is printed on the card or not, so someone who knows the
// wallet can match the card
export function shortHolder(address: string): string {
  return `${address.slice(0, 6)}...xxxx`
}

// the top title as the souk itself would write it
const TITLE_ARABIC: Record<string, string> = { 'Master of the Souk': 'سيد السوق' }
const ARABIC = '"Noto Naskh Arabic", "Geeza Pro", "Segoe UI", Tahoma, serif'

// the two lines at the foot of an identity page, padded with chevrons the way a passport is
export function machineLines(data: ShareCardData): [string, string] {
  const WIDTH = 40
  const pad = (s: string) => s.slice(0, WIDTH).padEnd(WIDTH, '<')
  const title = data.rank.toUpperCase().replace(/[^A-Z0-9]+/g, '<')
  const holder = data.holder ? `${data.holder.slice(2, 6).toUpperCase()}XXXX` : 'HOLDER'
  const d = data.issued
  const date = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  return [pad(`P<SOUK<${title}`), pad(`${holder}<<${data.points}PTS<<${visasFor(data.thirdHire).length}OF${MOST_VISAS}<<${data.serial ?? date}<<BNB`)]
}

const PORTRAIT_COLS = 5
const PORTRAIT_ROWS = 6
type Tile = 'black' | 'sage' | 'green' | null

// the tiles of the portrait, row by row: black and sage from the address, mirrored left to
// right so the pattern reads as a face would, and exactly one in the brand's green, the lowest
// black tile of the middle column
export function portraitTiles(holder: string): Tile[][] {
  const hex = holder.toLowerCase().replace(/^0x/, '')
  const mid = Math.floor(PORTRAIT_COLS / 2)
  const tiles: Tile[][] = []
  for (let r = 0; r < PORTRAIT_ROWS; r++) {
    const row: Tile[] = new Array(PORTRAIT_COLS).fill(null)
    for (let c = 0; c <= mid; c++) {
      const v = parseInt(hex[(r * 3 + c) % hex.length] ?? '0', 16)
      if (v % 3 === 0) continue
      row[c] = row[PORTRAIT_COLS - 1 - c] = v % 2 === 0 ? 'black' : 'sage'
    }
    tiles.push(row)
  }
  let green = PORTRAIT_ROWS - 1
  for (let r = PORTRAIT_ROWS - 1; r >= 0; r--) {
    if (tiles[r][mid] === 'black') {
      green = r
      break
    }
  }
  // an address with no black tile down the middle still gets its green one, at the foot
  tiles[green][mid] = 'green'
  return tiles
}

// a pattern of squares that is the same for the same seed, standing where a photo would
function portrait(ctx: Ctx, x: number, y: number, w: number, h: number, source: string): void {
  ctx.fillStyle = PAPER
  box(ctx, x, y, w, h, 10)
  ctx.fill()
  ctx.save()
  box(ctx, x, y, w, h, 10)
  ctx.clip()
  const cell = w / PORTRAIT_COLS
  const tall = h / PORTRAIT_ROWS
  portraitTiles(source).forEach((row, r) =>
    row.forEach((tile, c) => {
      if (!tile) return
      ctx.fillStyle = tile === 'green' ? GREEN : tile === 'black' ? BLACK : SAGE
      ctx.fillRect(x + c * cell, y + r * tall, cell, tall)
    }),
  )
  ctx.restore()
  ctx.strokeStyle = 'rgba(18, 22, 19, 0.35)'
  ctx.lineWidth = 1
  box(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 10)
  ctx.stroke()
}

function field(ctx: Ctx, label: string, value: string, x: number, y: number, font: string): void {
  text(ctx, label, x, y, `600 11px ${SANS}`, GRAY, { spacing: 1.1 })
  text(ctx, value, x, y + 26, font, BLACK)
}

// a stamp's lines are broken, the outer one most, the way a rubber stamp's edge prints
const DASH = [9, 6]
const FINE_DASH = [3, 3]

// a rectangular visa stamp, set a little crooked the way a border officer leaves it
function visa(ctx: Ctx, cx: number, cy: number, tilt: number, label: string, note: string, ink: string): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((tilt * Math.PI) / 180)
  ctx.globalAlpha = 0.88
  ctx.strokeStyle = ink
  ctx.lineWidth = 3
  ctx.setLineDash(DASH)
  box(ctx, -78, -34, 156, 68, 8)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.setLineDash(FINE_DASH)
  box(ctx, -72, -28, 144, 56, 5)
  ctx.stroke()
  ctx.setLineDash([])
  text(ctx, label, 0, -4, `700 14px ${SANS}`, ink, { align: 'center', spacing: 1.2 })
  text(ctx, note, 0, 17, `600 11px ${SANS}`, ink, { align: 'center', spacing: 2.4 })
  ctx.restore()
}

function ringText(ctx: Ctx, value: string, radius: number, font: string, ink: string): void {
  ctx.font = font
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  const step = (Math.PI * 2) / value.length
  for (let i = 0; i < value.length; i++) {
    ctx.save()
    ctx.rotate(i * step)
    ctx.fillText(value[i], 0, -radius)
    ctx.restore()
  }
}

// the round seal on the set: two rings, the campaign round the edge, the date across the middle
function seal(ctx: Ctx, cx: number, cy: number, tilt: number, issued: string, count: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((tilt * Math.PI) / 180)
  ctx.globalAlpha = 0.9
  ctx.strokeStyle = INK
  ctx.lineWidth = 4
  ctx.setLineDash(DASH)
  ctx.beginPath()
  ctx.arc(0, 0, 92, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 1.5
  ctx.setLineDash(FINE_DASH)
  ctx.beginPath()
  ctx.arc(0, 0, 84, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.arc(0, 0, 54, 0, Math.PI * 2)
  ctx.stroke()
  ringText(ctx, 'SET AND EARN * AGENT SOUK * BNB CHAIN * ', 62, `700 13px ${SANS}`, INK)
  text(ctx, 'COMPLETE', 0, -6, `800 17px ${SANS}`, INK, { align: 'center', spacing: 1.6 })
  ctx.fillStyle = INK
  ctx.fillRect(-36, 2, 72, 1.5)
  text(ctx, issued, 0, 22, `600 12px ${SANS}`, INK, { align: 'center', spacing: 1 })
  text(ctx, `${count} OF ${MOST_VISAS}`, 0, 38, `600 10px ${SANS}`, INK, { align: 'center', spacing: 1.6 })
  ctx.restore()
}

export interface StampPlace {
  x: number
  y: number
  tilt: number
}

// where a stamp may land on the visa page, before it is nudged; more places than stamps, so
// two cards rarely fill the same ones
const VISA_SLOTS: [number, number][] = [
  [736, 184],
  [906, 170],
  [1054, 214],
  [728, 296],
  [898, 300],
  [742, 408],
  [770, 496],
]
// the places with room above and below for a stamp that came down at a slant
const ROOMY_SLOTS = [VISA_SLOTS[3], VISA_SLOTS[4], VISA_SLOTS[5]]

// stamps land where the officer's hand happened to fall: each card picks its places, nudges
// and tilts from the seed, so no two wallets match and one wallet never changes
export function stampPlaces(seed: string): { visas: StampPlace[]; seal: StampPlace } {
  // FNV-1a into mulberry32: small, repeatable, and good enough to scatter a few stamps
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193)
  let state = h >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const between = (min: number, max: number) => Math.round(min + next() * (max - min))
  const slots = [...VISA_SLOTS]
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }
  const taken = slots.slice(0, MOST_VISAS)
  // one of the places with room is always among them, so every card has a stamp at a slant
  if (!taken.some((slot) => ROOMY_SLOTS.includes(slot))) {
    taken[taken.length - 1] = slots.slice(MOST_VISAS).find((slot) => ROOMY_SLOTS.includes(slot)) ?? taken[taken.length - 1]
  }
  // one or two came down at a real slant, the rest only a little crooked
  const slanted = new Set(taken.filter((slot) => ROOMY_SLOTS.includes(slot)).slice(0, between(1, 2)))
  const visas = taken.map((slot) => ({
    x: slot[0] + between(-14, 14),
    y: slot[1] + between(-10, 10),
    tilt: slanted.has(slot) ? between(24, 38) * (next() < 0.5 ? -1 : 1) : between(-9, 9),
  }))
  // the seal keeps to the lower right, clear of the line of words written under it
  return { visas, seal: { x: between(968, 1036), y: between(424, 452), tilt: between(-16, 8) } }
}

export async function drawShareCard(canvas: HTMLCanvasElement, data: ShareCardData): Promise<void> {
  await fontsReady()
  canvas.width = CARD_WIDTH * SCALE
  canvas.height = CARD_HEIGHT * SCALE
  const ctx = canvas.getContext('2d') as Ctx | null
  if (!ctx) throw new Error('This browser cannot draw the card.')
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
  ctx.textBaseline = 'alphabetic'
  const issued = issuedLabel(data.issued)

  // the cover showing round the open pages
  ctx.fillStyle = BLACK
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  ctx.fillStyle = BONE
  box(ctx, 28, 28, CARD_WIDTH - 56, CARD_HEIGHT - 56, 18)
  ctx.fill()

  // security printing: fine waves across both pages, clipped to the paper
  ctx.save()
  box(ctx, 28, 28, CARD_WIDTH - 56, CARD_HEIGHT - 56, 18)
  ctx.clip()
  ctx.strokeStyle = 'rgba(15, 122, 40, 0.07)'
  ctx.lineWidth = 1
  for (let y = 40; y < CARD_HEIGHT; y += 9) {
    ctx.beginPath()
    for (let x = 28; x <= CARD_WIDTH - 28; x += 12) {
      const wave = y + Math.sin((x + y * 2) / 38) * 4
      if (x === 28) ctx.moveTo(x, wave)
      else ctx.lineTo(x, wave)
    }
    ctx.stroke()
  }
  // the fold down the middle
  const fold = ctx.createLinearGradient(576, 0, 624, 0)
  fold.addColorStop(0, 'rgba(18, 22, 19, 0)')
  fold.addColorStop(0.5, 'rgba(18, 22, 19, 0.13)')
  fold.addColorStop(1, 'rgba(18, 22, 19, 0)')
  ctx.fillStyle = fold
  ctx.fillRect(576, 28, 48, CARD_HEIGHT - 56)
  ctx.restore()

  // identity page: the house mark and wordmark, with its green stroke under the "o" of Souk
  const squares: [number, number, string][] = [[64, 60, BLACK], [86, 60, BLACK], [64, 82, BLACK], [86, 82, GREEN]]
  for (const [x, y, fill] of squares) {
    ctx.fillStyle = fill
    box(ctx, x, y, 19, 19, 4)
    ctx.fill()
  }
  text(ctx, 'Agent Souk', 120, 91, `600 30px ${SERIF}`, BLACK, { spacing: -0.9 })
  const before = ctx.measureText('Agent S').width
  // the same proportions the site's wordmark uses for its swipe
  const letter = ctx.measureText('o').width
  ctx.fillStyle = GREEN
  ctx.fillRect(120 + before + letter * 0.14, 96, letter * 0.58, 3)
  text(ctx, 'PASSPORT', 552, 78, `700 13px ${SANS}`, BLACK, { align: 'right', spacing: 3 })
  text(ctx, 'SOUK OF AGENTS', 552, 96, `600 10px ${SANS}`, GRAY, { align: 'right', spacing: 1.6 })

  portrait(ctx, 64, 138, 150, 180, data.seed)

  const fx = 240
  text(ctx, 'TITLE', fx, 150, `600 11px ${SANS}`, GRAY, { spacing: 1.1 })
  const titleSize = fitted(ctx, data.rank, SERIF, 500, 40, 310)
  text(ctx, data.rank, fx, 150 + 12 + titleSize * 0.82, `500 ${titleSize}px ${SERIF}`, BLACK, { spacing: -titleSize * 0.03 })
  field(ctx, 'HOLDER', data.holder ? shortHolder(data.holder) : 'Not shown', fx, 226, `400 18px ${MONO}`)
  field(ctx, 'POINTS', `${data.points.toLocaleString('en-US')} of 1,000`, fx, 286, `500 18px ${SANS}`)
  field(ctx, 'ISSUED', issued, fx + 170, 286, `500 18px ${SANS}`)
  field(ctx, 'TYPE', 'P', 64, 346, `500 18px ${SANS}`)
  field(ctx, 'AUTHORITY', 'Agent Souk, Set and Earn', fx, 346, `500 18px ${SANS}`)

  // the machine-readable lines every identity page ends with
  ctx.fillStyle = 'rgba(18, 22, 19, 0.05)'
  ctx.fillRect(28, 430, 548, 172)
  const [first, second] = machineLines(data)
  text(ctx, first, 64, 492, `500 19px ${MONO}`, BLACK, { spacing: 1.2 })
  text(ctx, second, 64, 528, `500 19px ${MONO}`, BLACK, { spacing: 1.2 })
  text(ctx, 'AGENTSOUK.XYZ/QUEST', 64, 572, `600 11px ${SANS}`, GRAY, { spacing: 1.4 })

  // visa page: who ran the campaign, then the stamps
  ctx.save()
  ctx.translate(648, 58)
  ctx.scale(1.5, 1.5)
  ctx.fillStyle = BNB_YELLOW
  ctx.fill(new Path2D(BNB_MARK))
  ctx.restore()
  text(ctx, 'BNB CHAIN', 696, 74, `700 14px ${SANS}`, BLACK, { spacing: 1.6 })
  text(ctx, 'SET AND EARN', 696, 92, `600 11px ${SANS}`, GRAY, { spacing: 1.6 })
  text(ctx, 'VISAS', 1136, 78, `700 13px ${SANS}`, BLACK, { align: 'right', spacing: 3 })
  const visas = visasFor(data.thirdHire)
  text(ctx, `${COUNT_WORD[visas.length]} OF ${COUNT_WORD[MOST_VISAS]}`, 1136, 96, `600 10px ${SANS}`, GRAY, { align: 'right', spacing: 1.6 })

  const places = stampPlaces(data.seed)
  visas.forEach((v, i) => {
    const { x, y, tilt } = places.visas[i]
    visa(ctx, x, y, tilt, v.label, v.note, v.label === STALL ? INK : BLACK)
  })

  seal(ctx, places.seal.x, places.seal.y, places.seal.tilt, issued, visas.length)
  // a quiet line under the seal; joined script breaks apart when spaced, so it is set with none
  const arabic = TITLE_ARABIC[data.rank]
  if (arabic) text(ctx, arabic, places.seal.x, places.seal.y + 122, `400 15px ${ARABIC}`, 'rgba(81, 98, 84, 0.6)', { align: 'center' })
  text(ctx, 'The open market for agents that work', 648, 572, `500 15px ${SERIF}`, GRAY)
}

export function cardBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be made.'))), 'image/png')
  })
}

// the topic in Agent Souk's Telegram where passport cards are posted
export const TELEGRAM_CARDS = 'https://t.me/agentsouk/106'

// X takes the caption with it; Telegram opens the topic itself, where the saved picture is attached
export function shareLinks(): { x: string; telegram: string } {
  const caption = encodeURIComponent(SHARE_CAPTION)
  const url = encodeURIComponent(SHARE_URL)
  return {
    x: `https://x.com/intent/post?text=${caption}&url=${url}`,
    telegram: TELEGRAM_CARDS,
  }
}
