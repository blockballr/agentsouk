import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useConnectedAccount } from '../lib/use-connected-account'
import { connectWallet } from '../lib/wallet-session'
import { Stack, Row, Txt, Btn, Pill, NoteBox, SectionHead, Label } from '../components/souk'
import { Turnstile } from '../components/Turnstile'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

interface Blueprint {
  version: number
  name: string
  category: string
  description: string
  skills: { id: string; name: string; description: string; inputs: { id: string; label: string; required: boolean }[] }[]
  hireMode?: string
}

interface ComposeResult {
  success: boolean
  blueprint?: Blueprint
  answers?: { skill: string; text: string }[]
  reason?: string
  message?: string
}

interface SaveResult {
  success: boolean
  id?: string
  name?: string
  category?: string
  description?: string
  card?: string
  endpoint?: string
  error?: string
}

export function BuildPage() {
  const account = useConnectedAccount()
  const [prompt, setPrompt] = useState('')
  const [composing, setComposing] = useState(false)
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null)
  const [answers, setAnswers] = useState<{ skill: string; text: string }[]>([])
  const [composeError, setComposeError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<SaveResult | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function compose() {
    if (!prompt.trim()) return
    setComposing(true)
    setComposeError(null)
    setBlueprint(null)
    setSaved(null)
    try {
      const res = await fetch(`${API_BASE}/builder/compose`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), turnstileToken }),
      })
      const body = (await res.json()) as ComposeResult
      if (!body.success || !body.blueprint) {
        setComposeError(body.message ?? 'Could not build an agent from that description.')
        return
      }
      setBlueprint(body.blueprint)
      setAnswers(body.answers ?? [])
    } catch {
      setComposeError('The builder did not answer. Try again.')
    } finally {
      setComposing(false)
    }
  }

  async function save() {
    if (!blueprint) return
    let who = account
    if (!who) {
      try {
        who = await connectWallet()
      } catch {
        setSaveError('Connect a wallet to save this agent.')
        return
      }
    }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`${API_BASE}/builder/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: who, blueprint }),
      })
      const body = (await res.json()) as SaveResult
      if (!body.success || !body.id) {
        setSaveError(body.error ?? 'The agent could not be saved.')
        return
      }
      setSaved(body)
    } catch {
      setSaveError('The agent could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack gap={20} pad={[24, 24, 24, 24]}>
      <SectionHead title="Build an agent" note="PROMPT TO BLUEPRINT" />

      <Stack gap={10}>
        <Label>Describe the agent</Label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="e.g. a grid ladder from 100 to 200, 10 levels, 50 per rung"
          className="w-full rounded-[10px] border border-souk-hair bg-souk-surface1 px-3 py-2 text-[13px] text-souk-ink placeholder:text-souk-muted focus:outline-none focus:ring-2 focus:ring-souk-sky/40"
        />
        <Turnstile onToken={setTurnstileToken} />
        <Row gap={8} align="center">
          <Btn kind="primary" disabled={composing || !prompt.trim()} onClick={() => void compose()}>
            {composing ? 'Building…' : 'Compose'}
          </Btn>
          {blueprint && (
            <Btn kind="off" onClick={() => { setBlueprint(null); setAnswers([]); setSaved(null) }}>
              Reset
            </Btn>
          )}
        </Row>
        {composeError && (
          <NoteBox title="Could not build">
            <Txt size={12} lead={18} tone="peach">
              {composeError}
            </Txt>
          </NoteBox>
        )}
      </Stack>

      {blueprint && !saved && (
        <Stack gap={12} surface pad={[16, 18, 16, 18]}>
          <Row justify="between" align="center" gap={8}>
            <Txt size={16} lead={22} weight="semibold" tone="ink">
              {blueprint.name}
            </Txt>
            <Pill variant="off">{blueprint.category}</Pill>
          </Row>
          <Txt size={12} lead={18} tone="slate">
            {blueprint.description}
          </Txt>
          <Stack gap={6}>
            <Txt size={10} lead={14} upper tone="muted">
              Skills
            </Txt>
            {blueprint.skills.map((s) => (
              <Txt key={s.id} size={12} lead={18} tone="ink">
                {s.name} — {s.description}
              </Txt>
            ))}
          </Stack>
          {answers.length > 0 && (
            <Stack gap={6}>
              <Txt size={10} lead={14} upper tone="muted">
                Proof
              </Txt>
              {answers.map((a, i) => (
                <Txt key={i} size={11} lead={16} mono tone="slate">
                  {a.text}
                </Txt>
              ))}
            </Stack>
          )}
          <Row gap={8} align="center">
            <Btn kind="primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save and host'}
            </Btn>
          </Row>
          {saveError && (
            <Txt size={11} lead={16} tone="peach">
              {saveError}
            </Txt>
          )}
        </Stack>
      )}

      {saved && saved.id && (
        <Stack gap={12} surface pad={[16, 18, 16, 18]}>
          <Txt size={16} lead={22} weight="semibold" tone="ink">
            {saved.name ?? blueprint?.name} is hosted
          </Txt>
          <Txt size={12} lead={18} tone="slate">
            Its card and endpoint are live. Register it on chain to list it on the marketplace.
          </Txt>
          <Stack gap={6}>
            <Txt size={10} lead={14} upper tone="muted">
              Card
            </Txt>
            <Txt size={11} lead={16} mono tone="ink">
              {saved.card}
            </Txt>
            <Txt size={10} lead={14} upper tone="muted">
              Endpoint
            </Txt>
            <Txt size={11} lead={16} mono tone="ink">
              {saved.endpoint}
            </Txt>
          </Stack>
          <Row gap={8} align="center">
            <Link to={`/list?endpoint=${encodeURIComponent(saved.card ?? '')}`}>
              <Btn kind="primary">Register on chain</Btn>
            </Link>
            <Btn kind="off" onClick={() => { setSaved(null); setBlueprint(null); setPrompt('') }}>
              Build another
            </Btn>
          </Row>
        </Stack>
      )}
    </Stack>
  )
}
