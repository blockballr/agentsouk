import { useEffect, useId, useRef, useState } from 'react'
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SHARE_CAPTION,
  SHARE_URL,
  cardBlob,
  drawShareCard,
  shareLinks,
} from '../lib/share-card'
import { Action, LABEL, TextSlot, card, cx } from './ui'

const FILE_NAME = 'souk-passport.png'

// shown once the passport is complete: the holder's card, and the ways to post it
export function ShareCard({
  rank,
  points,
  wallet,
  serial,
  issuedAt,
  thirdHire = false,
}: {
  rank: string
  points: number
  wallet: string
  // the passport's number and the day it was issued, once the server has issued one
  serial?: string | null
  issuedAt?: string | null
  // whether the holder made the extra hire, which adds its stamp to the card
  thirdHire?: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // a card that leaves the holder off is laid out from nothing of the wallet
  const anonymous = useRef(`anonymous-${Math.random()}`)
  const toggleId = useId()
  const [showHolder, setShowHolder] = useState(true)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const links = shareLinks()

  useEffect(() => {
    let live = true
    setReady(false)
    if (!canvas.current) return
    drawShareCard(canvas.current, {
      rank,
      points,
      holder: showHolder ? wallet : null,
      issued: issuedAt ? new Date(issuedAt) : new Date(),
      seed: showHolder ? wallet.toLowerCase() : anonymous.current,
      // a number can be traced to its wallet, so it goes with the holder or not at all
      serial: showHolder ? (serial ?? null) : null,
      thirdHire,
    })
      .then(() => live && setReady(true))
      .catch((e) => live && setNote(e instanceof Error ? e.message : 'The card could not be drawn.'))
    return () => {
      live = false
    }
  }, [rank, points, wallet, showHolder, serial, issuedAt, thirdHire])

  async function file(): Promise<File> {
    if (!canvas.current) throw new Error('The card is not ready yet.')
    return new File([await cardBlob(canvas.current)], FILE_NAME, { type: 'image/png' })
  }

  async function run(action: () => Promise<string>) {
    setBusy(true)
    setNote('')
    try {
      setNote(await action())
    } catch (e) {
      // closing the share sheet is a choice, not a failure
      if (e instanceof DOMException && e.name === 'AbortError') setNote('')
      else setNote(e instanceof Error ? e.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      const url = URL.createObjectURL(await file())
      const a = document.createElement('a')
      a.href = url
      a.download = FILE_NAME
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      return 'Saved. Attach it to your post.'
    })

  const share = () =>
    run(async () => {
      const picture = await file()
      const data = { files: [picture], text: `${SHARE_CAPTION} ${SHARE_URL}` }
      if (!navigator.canShare?.(data)) throw new Error('This browser cannot share a picture. Save it and attach it to your post.')
      await navigator.share(data)
      return 'Shared.'
    })

  const copy = () =>
    run(async () => {
      // the clipboard is only there on a secure page
      if (!navigator.clipboard) throw new Error('This browser cannot copy from here. Select the caption and copy it by hand.')
      await navigator.clipboard.writeText(`${SHARE_CAPTION} ${SHARE_URL}`)
      return 'Caption copied.'
    })

  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'

  return (
    <section aria-labelledby={`${toggleId}-title`} className={cx(card('accent', 'md'), 'mt-10')}>
      <p className={LABEL}>Passport complete</p>
      <h2 id={`${toggleId}-title`} className="mt-2 font-serif text-[28px] font-medium leading-tight text-press-black">
        Share your passport
      </h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-newsprint-gray">
        Your card, drawn here in your browser. Post it in the Set and Earn channel or anywhere else.
      </p>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <canvas
          ref={canvas}
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          role="img"
          aria-label={`Your Souk passport, open: ${rank}, ${points.toLocaleString('en-US')} points, its stamps and the Set and Earn seal`}
          className="h-auto w-full rounded-[10px] border hairline border-slate-verdant/40"
        />

        <div className="flex flex-col gap-2">
          <Action variant="primary" size="md" onClick={() => void save()} disabled={!ready || busy} className="w-full">
            Save image
          </Action>
          {canShareFiles ? (
            <Action size="md" onClick={() => void share()} disabled={!ready || busy} className="w-full">
              Share
            </Action>
          ) : null}
          <Action size="md" onClick={() => void copy()} disabled={busy} className="w-full">
            Copy caption
          </Action>
          <div className="grid grid-cols-2 gap-2">
            <Action href={links.x} className="w-full">
              Post on X
            </Action>
            <Action href={links.telegram} className="w-full">
              Telegram
            </Action>
          </div>
          <label htmlFor={toggleId} className="mt-2 flex min-h-10 cursor-pointer items-center gap-3 text-[13px] text-press-black">
            <input
              id={toggleId}
              type="checkbox"
              checked={showHolder}
              onChange={(e) => setShowHolder(e.target.checked)}
              className="h-4 w-4 accent-highlighter-green"
            />
            Show my wallet on the card
          </label>
          <TextSlot lines={2}>
            <span role="status">{note}</span>
          </TextSlot>
        </div>
      </div>
    </section>
  )
}
