import { useState, useEffect } from 'react'
import { useConnectedAccount } from '../lib/use-connected-account'
import { sessionAccount } from '../lib/wallet-session'
import { signPersonalMessage } from '../lib/wallet'
import { Stack, Row, Txt, Btn, Pill, SectionHead, Label } from '../components/souk'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

const DEFAULT_MANIFEST = `{
  "name": "WBNB wrapper",
  "category": "wrapping",
  "description": "Wraps BNB into WBNB via the WBNB contract on a named venue.",
  "runtime": "node20",
  "entrypoint": "server.mjs",
  "endpoint": "/a2a",
  "wallet": "agent",
  "payment": "job",
  "deliverable": "A WBNB balance increase with the amount and tx hash",
  "release": "The WBNB balance increased by the wrapped amount and the tx hash matches",
  "actions": [
    {
      "name": "swap",\r\n      "venue": "pancakeswap-v3",\r\n      "contracts": ["0x13f4EA83D0bd40E75C8222255bc855a974568Dd4"],\r\n      "functions": ["exactInputSingle"],
      "maxValueUsd": 500
    }
  ],
  "env": ["RPC_URL"],
  "healthcheck": "/health"
}`

const DEFAULT_CODE = `import http from 'node:http'
import fs from 'node:fs'
import { createPublicClient, createWalletClient, http as httpTransport, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { bscTestnet } from 'viem/chains'

const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))

const WBNB = '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd'

function clients() {
  const key = process.env.AGENT_PRIVATE_KEY
  if (!key) throw new Error('AGENT_PRIVATE_KEY is not set')
  const rpc = process.env.RPC_URL || 'https://bsc-testnet-rpc.publicnode.com'
  const account = privateKeyToAccount(key)
  const publicClient = createPublicClient({ chain: bscTestnet, transport: httpTransport(rpc) })
  const walletClient = createWalletClient({ account, chain: bscTestnet, transport: httpTransport(rpc) })
  return { account, publicClient, walletClient, rpc }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'GET' && url.pathname === (manifest.healthcheck || '/health')) {
    let wallet = null
    try { wallet = clients().account.address } catch {}
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, agent: manifest.name, wallet }))
    return
  }
  if (req.method === 'POST' && url.pathname === (manifest.endpoint || '/a2a')) {
    let raw = ''
    for await (const chunk of req) raw += chunk
    let parsed = {}
    try { parsed = JSON.parse(raw) } catch {}
    try {
      const { account, walletClient, publicClient } = clients()
      const hash = await walletClient.writeContract({
        address: WBNB,
        abi: [{ type: 'function', name: 'deposit', inputs: [], outputs: [], stateMutability: 'payable' }],
        functionName: 'deposit',
        value: parseEther('0.001'),
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: parsed?.id ?? null,
        result: {
          status: receipt.status === 'success' ? 'completed' : 'failed',
          agentWallet: account.address,
          action: 'wrap-bnb',
          venue: 'wbnb-testnet',
          contract: WBNB,
          function: 'deposit',
          txHash: hash,
          block: Number(receipt.blockNumber),
          amount: '0.001 tBNB',
        },
      }))
    } catch (e) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed?.id ?? null, error: { code: -32603, message: String(e) } }))
    }
    return
  }
  res.statusCode = 404
  res.end('not found')
})

const port = Number(process.env.PORT || 3000)
server.listen(port, () => console.log('custom agent listening on :' + port))
`



interface Manifest { name: string; category: string; description: string; runtime: string; entrypoint: string; endpoint: string; wallet: 'agent' | 'vault' | 'session' | 'none'; payment: 'x402' | 'job' | 'vault'; deliverable: string; release: string; actions: { name: string; venue: string; contracts: string[]; functions: string[]; maxValueUsd: number }[]; env: string[]; healthcheck: string }

interface ValidateResult { success: boolean; ok?: boolean; valid?: boolean; manifest?: Manifest; errors?: string[]; error?: string }
interface BuildResult { success: boolean; ok?: boolean; buildId?: string; id?: string; status?: string; error?: string }

export function ManifestBuilderPage() {
  const account = useConnectedAccount()
  const [manifestText, setManifestText] = useState(DEFAULT_MANIFEST)
  const [code, setCode] = useState(DEFAULT_CODE)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [validateMsg, setValidateMsg] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [building, setBuilding] = useState(false)
  const [buildId, setBuildId] = useState<string | null>(null)
  const [tab, setTab] = useState<'manifest' | 'code'>('manifest')
  const [prompt, setPrompt] = useState('')
  const [composing, setComposing] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)
  const [generated, setGenerated] = useState(false)
  const [validated, setValidated] = useState(false)
  const [showEditors, setShowEditors] = useState(false)
  const [caps, setCaps] = useState<any>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  async function authHeaders(scope: string, subject = '') {
    const who = (await sessionAccount()) ?? account
    if (!who) throw new Error('connect a wallet')
    const ts = Date.now().toString()
    const message = `soukdio:${scope}:${who.toLowerCase()}:${subject}:${ts}`
    const sig = await signPersonalMessage(who, message)
    return { 'x-wallet-signature': sig, 'x-wallet-timestamp': ts }
  }

  useEffect(() => {
    fetch(`${API_BASE}/builder/custom/capabilities`)
      .then((r) => r.json())
      .then((b) => { if (b?.success) setCaps(b) })
      .catch(() => {})
  }, [])

  async function generateFromPrompt() {
    if (!prompt.trim()) return
    setComposing(true)
    setComposeError(null)
    try {
      const res = await fetch(`${API_BASE}/builder/custom/compose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: prompt.trim() }) })
      const body = await res.json()
      if (!body.success || !body.manifest || !body.code) {
        setComposeError(body.error ?? body.message ?? 'Could not generate an agent from that description.')
        return
      }
      setManifestText(JSON.stringify(body.manifest, null, 2))
      setCode(body.code)
      setManifest(body.manifest)
      setGenerated(true)
      setValidated(false)
      setShowEditors(true)
      setValidateMsg('Generated from prompt. Review the manifest and code. You can edit the name, category, or any field, then validate and build.')
    } catch {
      setComposeError('The builder did not answer. Try again.')
    } finally {
      setComposing(false)
    }
  }

  async function validate() {
    setValidating(true)
    setValidateMsg(null)
    let parsed: unknown
    try { parsed = JSON.parse(manifestText) } catch { setValidateMsg('Manifest is not valid JSON.'); setValidating(false); return }
    try {
      const res = await fetch(`${API_BASE}/builder/custom/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest: parsed }) })
      const body = (await res.json()) as ValidateResult
      if (!body.success || !body.manifest) { setValidateMsg(body.error ?? 'Manifest failed validation.'); return }
      setManifest(body.manifest)
      setValidated(true)
      setValidateMsg('Manifest valid.')
    } catch { setValidateMsg('Validation request failed.') }
    finally { setValidating(false) }
  }

  async function build() {
    if (!manifest) return
    setBuilding(true)
    try {
      const res = await fetch(`${API_BASE}/builder/custom/build`, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders('build', '')) }, body: JSON.stringify({ owner: account, manifest }) })
      const body = (await res.json()) as BuildResult
      if (!body.success || !(body.buildId || body.id)) { setValidateMsg(body.error ?? 'Build failed.'); return }
      setBuildId(body.buildId ?? body.id ?? null)
    } catch { setValidateMsg('Build request failed.') }
    finally { setBuilding(false) }
  }

  async function downloadAgent() {
    if (!manifest) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const who = (await sessionAccount()) ?? account
      if (!who) { setDownloadError('Connect a wallet first.'); return }
      const res = await fetch(`${API_BASE}/builder/custom/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders('export', buildId ?? '')) },
        body: JSON.stringify({ owner: who, manifest, buildId }),
      })
      const body = await res.json() as { success?: boolean; ok?: boolean; slug?: string; files?: { path: string; content: string }[]; error?: string }
      if (!body.success || !body.files) { setDownloadError(body.error ?? 'Export failed.'); return }
      const enc = new TextEncoder()
      const crcTable = new Uint32Array(256)
      for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); crcTable[i] = c }
      function crc32(data: Uint8Array): number { let crc = 0xFFFFFFFF; for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0 }
      const parts: Uint8Array[] = []
      const central: Uint8Array[] = []
      let offset = 0
      for (const f of body.files) {
        const data = enc.encode(f.content)
        const name = enc.encode(f.path)
        const crc = crc32(data)
        const lfh = new Uint8Array(30 + name.length)
        const lv = new DataView(lfh.buffer)
        lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 10, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0, true)
        lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true)
        lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true)
        lfh.set(name, 30)
        parts.push(lfh, data)
        const cde = new Uint8Array(46 + name.length)
        const cv = new DataView(cde.buffer)
        cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 10, true); cv.setUint16(6, 10, true); cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true)
        cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true)
        cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true)
        cv.setUint32(40, 0, true); cv.setUint32(42, offset, true)
        cde.set(name, 46)
        central.push(cde)
        offset += lfh.length + data.length
      }
      const cdSize = central.reduce((s, c) => s + c.length, 0)
      const eocd = new Uint8Array(22)
      const ev = new DataView(eocd.buffer)
      ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true)
      ev.setUint16(8, body.files.length, true); ev.setUint16(10, body.files.length, true)
      ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true)
      const blob = new Blob([...parts, ...central, eocd] as any, { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = (body.slug ?? manifest.name).replace(/[^a-zA-Z0-9-]/g, '-') + '.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch { setDownloadError('Export request failed.') }
    finally { setDownloading(false) }
  }

  return (
    <Stack gap={20} pad={[24, 24, 24, 24]}>
      <SectionHead title="Generate a manifest" note="ADVANCED" />
      <Txt size={13} lead={20} tone="slate" className="max-w-[68ch]">
        The primary lane: describe what the agent should do, or bring your own code. The builder
        generates the manifest and execution code, then gives you a runnable repo to download and
        deploy on any Node 20 host. The agent acts with its own wallet.
      </Txt>

      {caps && (
        <Stack gap={6} surface pad={[12, 14, 12, 14]}>
          <Txt size={12} lead={16} weight="semibold" tone="ink">Lane status</Txt>
          {[
            ['Download agent files', caps.lanes?.deployManual, caps.lanes?.deployManual?.enabled ? 'Works' : 'Unavailable'],
            ['Agent-funded', caps.lanes?.agentFunded, caps.lanes?.agentFunded?.enabled ? 'Works' : (caps.lanes?.agentFunded?.reason ?? 'Unavailable')],
            ['Hirer-funded', caps.lanes?.hirerFunded, 'Vault lane'],
            ['Vault SDK', caps.lanes?.vaultSdk, 'From npm'],
            ['Registration', caps.lanes?.registration, `Chain ${caps.chainId}`],
          ].map(([label, lane, chip]) => (
            <Row key={label as string} gap={8} align="center">
              <Txt size={12} lead={16} tone="ink" className="min-w-[120px]">{label as string}</Txt>
              <Txt size={11} lead={16} tone="muted">{(lane as any)?.reason ?? ''}</Txt>
              <div className="ml-auto">
                <Pill variant={(lane as any)?.enabled ? 'keep' : 'off'}>{chip as string}</Pill>
              </div>
            </Row>
          ))}
        </Stack>
      )}
      <Stack gap={10} surface pad={[16, 18, 16, 18]}>
        <Label>Describe the agent</Label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="e.g. wrap BNB into WBNB on BSC testnet, or send a daily report of my wallet balance"
          className="w-full rounded-[10px] border border-souk-hair bg-souk-surface1 px-3 py-2 text-[13px] text-souk-ink placeholder:text-souk-muted focus:outline-none focus:ring-2 focus:ring-souk-sky/40"
        />
        <Row gap={8} align="center">
          <Btn kind="primary" disabled={composing || !prompt.trim()} onClick={() => void generateFromPrompt()}>
            {composing ? 'Generating…' : 'Generate from prompt'}
          </Btn>
          <button type="button" onClick={() => setShowEditors(true)} className="inline-flex h-11 items-end pb-2 text-[13px] text-souk-sky underline underline-offset-2 hover:text-souk-ink disabled:opacity-40">
            Bring your own code
          </button>
          {composeError && <Txt size={12} lead={18} tone="peach">{composeError}</Txt>}
        </Row>
      </Stack>

      {showEditors && (
      <>
      <Row gap={8} align="center">
        <Btn kind={tab === 'manifest' ? 'primary' : 'off'} onClick={() => setTab('manifest')}>Manifest</Btn>
        <Btn kind={tab === 'code' ? 'primary' : 'off'} onClick={() => setTab('code')}>Code (server.mjs)</Btn>
      </Row>

      {tab === 'manifest' && (
        <Stack gap={10}>
          <Label>Manifest (JSON)</Label>
          <Txt size={11} lead={16} tone="muted">Tip: keep the agent name under 32 characters so the endpoint is easy to read.</Txt>
          <textarea
            value={manifestText}
            onChange={(e) => setManifestText(e.target.value)}
            rows={18}
            className="w-full rounded-[10px] border border-souk-hair bg-souk-surface1 px-3 py-2 font-mono text-[12px] text-souk-ink focus:outline-none focus:ring-2 focus:ring-souk-sky/40"
          />
        </Stack>
      )}
      {tab === 'code' && (
        <Stack gap={10}>
          <Label>Execution code (server.mjs)</Label>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={24}
            className="w-full rounded-[10px] border border-souk-hair bg-souk-surface1 px-3 py-2 font-mono text-[12px] text-souk-ink focus:outline-none focus:ring-2 focus:ring-souk-sky/40"
          />
        </Stack>
      )}
      </>
      )}

      {showEditors && (
      <Row gap={8} align="center">
        <Btn kind="primary" disabled={validating} onClick={() => void validate()} className={generated && !validated ? 'animate-scale-pulse' : ''}>
          {validating ? 'Validating…' : 'Validate manifest'}
        </Btn>
        <Btn kind="off" disabled={!manifest || building} onClick={() => void build()} title={generated && !validated ? 'Validate the manifest first' : ''}>
          {building ? 'Building…' : 'Build'}
        </Btn>
        {buildId && <Txt size={11} lead={16} mono tone="slate">build: {buildId}</Txt>}
      </Row>
      )}
      {validateMsg && <Txt size={12} lead={18} tone={validateMsg === 'Manifest valid.' ? 'ink' : 'peach'}>{validateMsg}</Txt>}

      {manifest && (
        <Stack gap={8} surface pad={[16, 18, 16, 18]}>
          <Row justify="between" align="center" gap={8}>
            <Txt size={16} lead={22} weight="semibold" tone="ink">{manifest.name}</Txt>
            <Pill variant="off">{manifest.category}</Pill>
          </Row>
          <Txt size={12} lead={18} tone="slate">{manifest.description}</Txt>
          <Txt size={11} lead={16} tone="muted">wallet: {manifest.wallet} · payment: {manifest.payment} · healthcheck: {manifest.healthcheck}</Txt>
          <Txt size={11} lead={16} tone="muted">actions: {manifest.actions.map((a) => a.name).join(', ')}</Txt>
        </Stack>
      )}

      {manifest && (
        <Stack gap={8} surface pad={[16, 18, 16, 18]} className="animate-fade-in">
          <Txt size={14} lead={20} weight="semibold" tone="ink">Pre-build review</Txt>
          <Txt size={11} lead={16} tone="muted">Check these before clicking build and deploying. The marketplace verifies declared actions against real on-chain activity.</Txt>
          <Txt size={11} lead={16} tone="peach">Generated code is a starter. Review actions, contracts, and caps before deploying.</Txt>
          <Stack gap={4}>
            {[
              { label: 'Manifest validates', ok: validated },
              { label: 'Code passes syntax check', ok: !!buildId },
              { label: 'Health check endpoint present', ok: !!(manifest?.healthcheck) },
              { label: 'A2A endpoint present', ok: !!(manifest?.endpoint) },
              { label: 'Wallet model declared', ok: !!(manifest?.wallet) },
              { label: 'Payment model declared', ok: !!(manifest?.payment) },
              { label: 'At least one action declared', ok: !!(manifest?.actions?.length) },
              { label: 'Contracts listed for each action', ok: (manifest?.actions ?? []).every((a) => a.contracts.length > 0) },
            ].map((item, i) => (
              <Row key={i} gap={8} align="center">
                <span className={item.ok ? 'text-emerald-400' : 'text-zinc-600'}>{item.ok ? '✓' : '○'}</span>
                <Txt size={12} lead={18} tone={item.ok ? 'ink' : 'muted'}>{item.label}</Txt>
              </Row>
            ))}
          </Stack>
        </Stack>
      )}

      {buildId && (
      <Stack gap={8} surface pad={[16, 18, 16, 18]}>
        <Txt size={14} lead={20} weight="semibold" tone="ink">Download the agent files</Txt>
        <Btn kind="off" disabled={!manifest || downloading} onClick={() => void downloadAgent()}>
          {downloading ? 'Preparing...' : 'Download agent files'}
        </Btn>
        {downloadError && <Txt size={11} lead={16} tone="peach">{downloadError}</Txt>}
      </Stack>
      )}

    </Stack>
  )
}

