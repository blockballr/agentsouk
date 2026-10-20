import { useEffect, useState } from 'react'
import { useConnectedAccount } from '../lib/use-connected-account'
import { getProvider } from '../lib/wallet'
import { Stack, Row, Txt, Btn, Pill, NoteBox, SectionHead } from '../components/souk'

interface BuiltAgent {
  id: string
  name: string
  category: string
  hireMode: string
  agentWallet: string | null
  card: string
  endpoint: string
  custody: 'held' | 'exported' | 'revoked' | 'none'
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

function exportMessage(agentId: string, owner: string, nonce: string): string {
  return `Agent Souk key export\nagent: ${agentId}\nby: ${owner.toLowerCase()}\nnonce: ${nonce}`
}

function revokeMessage(agentId: string, owner: string, nonce: string): string {
  return `Agent Souk key revoke\nagent: ${agentId}\nby: ${owner.toLowerCase()}\nnonce: ${nonce}`
}

export function SettingsPage() {
  const account = useConnectedAccount()
  const [agents, setAgents] = useState<BuiltAgent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // revealed key per agent id, held in memory only
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [blurred, setBlurred] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!account) {
      setAgents([])
      return
    }
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/builder/agents?owner=${account}`)
      .then((r) => r.json())
      .then((body) => {
        if (body?.success) setAgents(body.items ?? [])
        else setError(body?.error ?? 'could not load agents')
      })
      .catch(() => setError('could not load agents'))
      .finally(() => setLoading(false))
  }, [account])

  async function sign(owner: string, message: string): Promise<string | null> {
    try {
      const provider = await getProvider()
      return (await provider.request({ method: 'personal_sign', params: [message, owner] })) as string
    } catch {
      return null
    }
  }

  async function revealKey(agent: BuiltAgent) {
    if (!account) return
    setBusy(agent.id)
    const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 32)
    const message = exportMessage(agent.id, account, nonce)
    const signature = await sign(account, message)
    if (!signature) {
      setBusy(null)
      return
    }
    try {
      const res = await fetch(`${API_BASE}/builder/keys/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: account, agentId: agent.id, signature, nonce }),
      })
      const body = await res.json()
      if (body?.success && body.key) {
        setRevealed((r) => ({ ...r, [agent.id]: body.key }))
        setBlurred((b) => ({ ...b, [agent.id]: true }))
      } else {
        setError(body?.error ?? 'reveal failed')
      }
    } catch {
      setError('reveal failed')
    } finally {
      setBusy(null)
    }
  }

  async function revokeKey(agent: BuiltAgent) {
    if (!account) return
    setBusy(agent.id)
    const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 32)
    const message = revokeMessage(agent.id, account, nonce)
    const signature = await sign(account, message)
    if (!signature) {
      setBusy(null)
      return
    }
    try {
      const res = await fetch(`${API_BASE}/builder/keys/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: account, agentId: agent.id, signature, nonce }),
      })
      const body = await res.json()
      if (body?.success) {
        setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, custody: 'revoked' } : a)))
        setRevealed((r) => {
          const next = { ...r }
          delete next[agent.id]
          return next
        })
      } else {
        setError(body?.error ?? 'revoke failed')
      }
    } catch {
      setError('revoke failed')
    } finally {
      setBusy(null)
    }
  }

  function copyKey(agentId: string) {
    const key = revealed[agentId]
    if (!key) return
    void navigator.clipboard?.writeText(key)
    setBlurred((b) => ({ ...b, [agentId]: true }))
  }

  if (!account) {
    return (
      <Stack gap={16} pad={[24, 24, 24, 24]}>
        <SectionHead title="Settings" note="KEYS" />
        <NoteBox title="Connect a wallet">
          <Txt size={13} lead={20} tone="slate">
            Connect the wallet that owns your built agents to manage their keys.
          </Txt>
        </NoteBox>
      </Stack>
    )
  }

  return (
    <Stack gap={20} pad={[24, 24, 24, 24]}>
      <SectionHead title="Settings" note="KEYS AND PREFERENCES" />
      <Txt size={13} lead={20} tone="slate">
        Built agents whose hire mode is job or both carry a seller key. Reveal it
        to take custody; the marketplace keeps signing unless you revoke.
      </Txt>

      {error && (
        <NoteBox title="Error">
          <Txt size={12} lead={18} tone="peach">
            {error}
          </Txt>
        </NoteBox>
      )}

      {loading ? (
        <Txt size={12} lead={18} tone="muted">
          Loading…
        </Txt>
      ) : agents.length === 0 ? (
        <NoteBox title="No built agents">
          <Txt size={13} lead={20} tone="slate">
            You have not built an agent yet. Build one from the marketplace.
          </Txt>
        </NoteBox>
      ) : (
        <Stack gap={12}>
          {agents.map((agent) => {
            const key = revealed[agent.id]
            const isBusy = busy === agent.id
            return (
              <Stack key={agent.id} surface gap={10} pad={[14, 16, 14, 16]}>
                <Row justify="between" align="center" gap={8}>
                  <Txt size={13} lead={18} weight="semibold" tone="ink">
                    {agent.name}
                  </Txt>
                  <Pill variant={agent.custody === 'revoked' ? 'off' : agent.custody === 'exported' ? 'keep' : 'off'}>
                    {agent.custody}
                  </Pill>
                </Row>
                <Txt size={11} lead={16} mono tone="muted">
                  {agent.id} · {agent.hireMode} · {agent.agentWallet ?? 'no seller key'}
                </Txt>
                {agent.custody !== 'none' && agent.custody !== 'revoked' && (
                  <>
                    {key ? (
                      <Row gap={8} align="center" className="flex-wrap">
                        <Txt
                          size={12}
                          lead={18}
                          mono
                          tone="ink"
                          className={`flex-1 truncate rounded-[6px] border border-souk-hair bg-souk-surface2 px-3 py-2 ${blurred[agent.id] ? 'blur-sm select-none' : ''}`}
                        >
                          {key}
                        </Txt>
                        <Btn kind="off" disabled={isBusy} onClick={() => setBlurred((b) => ({ ...b, [agent.id]: !b[agent.id] }))}>
                          {blurred[agent.id] ? 'Reveal' : 'Hide'}
                        </Btn>
                        <Btn kind="off" disabled={isBusy} onClick={() => copyKey(agent.id)}>
                          Copy
                        </Btn>
                      </Row>
                    ) : (
                      <Btn kind="off" disabled={isBusy} onClick={() => void revealKey(agent)}>
                        {isBusy ? 'Signing…' : 'Reveal key'}
                      </Btn>
                    )}
                    <Btn kind="warn" disabled={isBusy} onClick={() => void revokeKey(agent)}>
                      {isBusy ? 'Signing…' : 'Take full custody'}
                    </Btn>
                  </>
                )}
              </Stack>
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}
