import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, NoteBox, Row, SectionHead, Stack, Txt } from '../components/souk'
import { useConnectedAccount } from '../lib/use-connected-account'
import { saveProfile, useLocalProfile } from '../lib/profile'
import { shortAddress } from '@agora/core'

// The picture is the one the navbar chip wears, so a buyer sees the same mark in
// the market as the seller set here. Stored per wallet on this browser until the
// account service carries a profile record.
const MAX_BYTES = 400_000

export function SettingsProfilePage() {
  const account = useConnectedAccount()
  const stored = useLocalProfile(account)
  const [username, setUsername] = useState('')
  const [avatar, setAvatar] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)

  // a wallet switch reads that wallet's record rather than carrying the old one
  useEffect(() => {
    setUsername(stored?.username ?? '')
    setAvatar(stored?.avatar ?? '')
    setError(null)
  }, [account, stored?.username, stored?.avatar])

  // the confirmation belongs to one wallet: a switch clears it
  useEffect(() => {
    setSaved(false)
  }, [account])

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Keep the picture under 400 KB so it fits in this browser.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setAvatar(typeof reader.result === 'string' ? reader.result : '')
      setError(null)
      setSaved(false)
    }
    reader.onerror = () => setError('That file could not be read.')
    reader.readAsDataURL(file)
  }

  function save() {
    if (!account) return
    saveProfile(account, { username: username.trim(), avatar })
    setSaved(true)
  }

  return (
    <Stack gap={20} className="mx-auto max-w-[760px] pt-8">
      <Link
        to="/settings"
        className="text-[12px] font-semibold text-souk-muted transition-colors hover:text-souk-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-souk-data"
      >
        Back to settings
      </Link>
      <SectionHead title="Profile" note="NAME AND PICTURE" />

      {!account ? (
        <NoteBox title="Connect a wallet" copy="A profile belongs to a wallet. Connect one from the rail to set a name and a picture." />
      ) : (
        <>
          <Stack surface radius={16} gap={18} className="p-5">
            <Row align="center" gap={16} className="flex-wrap">
              <span className="flex h-[76px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-souk-hair bg-souk-surface2">
                {avatar ? (
                  <img src={avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FallbackGlyph />
                )}
              </span>
              <Stack gap={6}>
                <Row gap={8} className="flex-wrap">
                  <Btn kind="off" onClick={() => fileInput.current?.click()}>
                    {avatar ? 'Change picture' : 'Choose picture'}
                  </Btn>
                  {avatar ? (
                    <Btn
                      kind="off"
                      onClick={() => {
                        setAvatar('')
                        setSaved(false)
                      }}
                    >
                      Remove
                    </Btn>
                  ) : null}
                </Row>
                <Txt size={11} lead={16} tone="muted">
                  PNG, JPG or GIF, up to 400 KB. Shown on your profile tab.
                </Txt>
              </Stack>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                onChange={onFile}
                className="hidden"
              />
            </Row>

            <label className="grid gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-souk-muted">
                Username
              </span>
              <input
                type="text"
                value={username}
                maxLength={32}
                placeholder="Your name on the market"
                onChange={(e) => {
                  setUsername(e.target.value)
                  setSaved(false)
                }}
                className="h-11 w-full rounded-[8px] border border-souk-hair bg-souk-surface2 px-3 text-[13px] text-souk-ink outline-none placeholder:text-souk-muted focus-visible:border-souk-data"
              />
            </label>

            {error ? (
              <Txt size={12} lead={18} tone="peach">
                {error}
              </Txt>
            ) : null}

            <Row justify="between" align="center" gap={12} className="flex-wrap">
              <Txt size={11} lead={16} mono tone="muted">
                {shortAddress(account)}
              </Txt>
              <Row gap={10} align="center">
                {saved ? (
                  <Txt size={12} lead={18} tone="data">
                    Saved.
                  </Txt>
                ) : null}
                <Btn kind="primary" onClick={save}>
                  Save profile
                </Btn>
              </Row>
            </Row>
          </Stack>

          <Txt size={12} lead={18} tone="muted">
            This profile is kept in this browser for now, keyed to {shortAddress(account)}.
            It appears on the profile tab in the bar above.
          </Txt>
        </>
      )}
    </Stack>
  )
}

function FallbackGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-souk-muted" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
