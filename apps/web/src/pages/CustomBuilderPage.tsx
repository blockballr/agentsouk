import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useConnectedAccount } from '../lib/use-connected-account'
import { connectWallet, sessionAccount } from '../lib/wallet-session'
import { getProvider, changeWallet, signPersonalMessage } from '../lib/wallet'
import { withSendTimeout, waitForTransactionReceipt } from '../lib/register'
import { Stack, Row, Txt, Btn, Pill, NoteBox, SectionHead, Label, Rule } from '../components/souk'
import { PeelCard } from './BuildPage'

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
interface DeployResult { success: boolean; ok?: boolean; id?: string; agentId?: string; projectId?: string; status?: string; endpoint?: string; error?: string; files?: { path: string; content: string }[]; hint?: string }
interface StatusResult { success: boolean; ok?: boolean; status?: string; items?: unknown[]; error?: string }
interface RegisterResult { success: boolean; ok?: boolean; prepared?: boolean; registration?: unknown; txHash?: string; confirmed?: boolean; error?: string }
interface AgentResult { success: boolean; ok?: boolean; id?: string; endpoint?: string; walletAddress?: string | null; badge?: 'new' | 'established' | 'unknown'; online?: boolean; deployment?: { ok: boolean; url?: string | null } | null; listingState?: string; error?: string }
interface HirerExecResult { success: boolean; ok?: boolean; txHash?: string; receiptId?: string; error?: string }

export function CustomBuilderPage() {
  const account = useConnectedAccount()
  const [manifestText, setManifestText] = useState(DEFAULT_MANIFEST)
  const [code, setCode] = useState(DEFAULT_CODE)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [validateMsg, setValidateMsg] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [building, setBuilding] = useState(false)
  const [buildId, setBuildId] = useState<string | null>(null)
  const [deployed, setDeployed] = useState<DeployResult | null>(null)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [manualEndpoint, setManualEndpoint] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState<RegisterResult | null>(null)
  const [agentState, setAgentState] = useState<AgentResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<'manifest' | 'code'>('manifest')
  const [hireId, setHireId] = useState('')
  const [hirerResult, setHirerResult] = useState<HirerExecResult | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [avatarSeed, setAvatarSeed] = useState<string | null>(null)
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
      setValidateMsg('Generated from prompt. Review the manifest and code. You can edit the name, category, or any field, then validate and deploy.')
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
      setAvatarSeed(Math.random().toString(36).slice(2))
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
        body: JSON.stringify({ owner: who, manifest, buildId, image: imageUrl.trim() || undefined }),
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

  async function register() {
    if (!deployed?.endpoint) return
    // always get the current wallet from session, not stale React state
    let who = (await sessionAccount()) ?? account
    if (!who) { try { who = (await changeWallet()) ?? (await connectWallet()) } catch { setDeployError('Connect a wallet to register.'); return } }
    setRegistering(true)
    setDeployError(null)
    try {
      // 1. prepare
      const prepRes = await fetch(`${API_BASE}/builder/custom/register`, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders('register', deployed?.id ?? '')) }, body: JSON.stringify({ owner: who, id: deployed.id || undefined, manifest, buildId, image: imageUrl.trim() || undefined }) })
      const prep = (await prepRes.json()) as RegisterResult & { id?: string; registration?: { registryAddress?: string; registerCalldata?: string; chainId?: number } }
      if (!prep.success || !prep.registration?.registryAddress || !prep.registration?.registerCalldata) {
        setDeployError(prep.error ?? 'Registration prep failed.')
        return
      }
      setRegistered(prep)
      // use the returned agent id for state lookup
      if (prep.id && !deployed?.id) {
        setDeployed((prev) => prev ? { ...prev, id: prep.id! } : prev)
      }

      // 2. sign and send
      const provider = await getProvider()
      const walletAddr = (await sessionAccount()) ?? (await changeWallet()) ?? (await connectWallet())
      const hash = await withSendTimeout(
        provider.request({
          method: 'eth_sendTransaction',
          params: [{ from: walletAddr, to: prep.registration.registryAddress, data: prep.registration.registerCalldata }],
        }) as Promise<string>,
      )
      setRegistered((prev) => prev ? { ...prev, txHash: hash } as RegisterResult : prev)

      // 3. wait for receipt
      const receipt = await waitForTransactionReceipt(
        () => provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }).then((r) => r as { status?: string } | null),
        { timeoutMs: 90000, intervalMs: 2500 },
      )
      if (!receipt) {
        setDeployError('Transaction sent but no receipt yet. Check your wallet.')
        return
      }
      if (receipt.status !== '0x1') {
        setDeployError('Transaction reverted. Nothing was registered.')
        return
      }
      // extract token ID from receipt (ERC-721 Transfer topic[3])
      let tokenId: string | null = null
      const registryAddr = prep.registration.registryAddress?.toLowerCase()
      for (const log of (receipt.logs ?? [])) {
        if (log.address?.toLowerCase() !== registryAddr) continue
        if (log.topics?.[0]?.toLowerCase() !== '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') continue
        if (!/^0x0{64}$/i.test(log.topics[1] ?? '')) continue
        if (log.topics[3]) { tokenId = BigInt(log.topics[3]).toString(); break }
      }
      // confirm on backend
      const confirmRes = await fetch(`${API_BASE}/builder/custom/confirm`, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeaders('confirm', prep.id ?? deployed?.id ?? '')) }, body: JSON.stringify({ owner: who, id: prep.id ?? deployed?.id, txHash: hash, tokenId }) })
      const confirmBody = await confirmRes.json()
      if (!confirmBody.success) { setDeployError(confirmBody.error ?? 'Confirmation failed.'); return }
      setDeployError(null)
      setRegistered((prev) => prev ? { ...prev, confirmed: true, txHash: hash } as RegisterResult : prev)
      // fetch agent state
      const agentId = confirmBody.id ?? prep.id ?? deployed?.id
      if (agentId) {
        const ar = await fetch(`${API_BASE}/builder/custom/agent/${agentId}`)
        const ab = (await ar.json()) as AgentResult
        if (ab.success) setAgentState(ab)
      }
    } catch (e) {
      const err = e as Error & { code?: number }
      const detail = err.code === 4001
        ? 'You cancelled the transaction, so nothing was registered.'
        : err.message?.includes('did not answer')
          ? err.message
          : 'Registration could not be sent. Nothing was registered.'
      setDeployError(detail)
    } finally {
      setRegistering(false)
    }
  }

  async function checkStatus() {
    if (!deployed?.id) return
    setBusy('status')
    try {
      const res = await fetch(`${API_BASE}/builder/custom/status?id=${deployed.id}`)
      const body = (await res.json()) as StatusResult
      if (body.success) setAgentState((prev) => ({ ...(prev ?? {}), ...body } as AgentResult))
    } catch { /* ignore */ }
    finally { setBusy(null) }
  }

  return (
    <Stack gap={20} pad={[24, 24, 24, 24]}>
      <SectionHead title="Custom agent builder" note="DEPLOY REAL EXECUTION CODE" />
      <Txt size={13} lead={20} tone="slate" className="max-w-[68ch]">
        The primary lane: describe what the agent should do, or bring your own code. The builder
        generates the manifest and execution code, then gives you a runnable repo to deploy on any Node 20 host.  Download the agent files, deploy on Railway, Render, Fly.io, Docker, or your own box, then paste the public URL The agent acts with its own wallet. Registration happens at the end, on BNB Smart Chain.
      </Txt>

      {caps && (
        <Stack gap={6} surface pad={[12, 14, 12, 14]}>
          <Txt size={12} lead={16} weight="semibold" tone="ink">Lane status</Txt>
          {[
            ['Download agent files', caps.lanes?.deployManual, caps.lanes?.deployManual?.enabled ? 'Works' : 'Unavailable'],
            ['Agent-funded', caps.lanes?.agentFunded, caps.lanes?.agentFunded?.enabled ? 'Works' : (caps.lanes?.agentFunded?.reason ?? 'Unavailable')],
            ['Hirer-funded', caps.lanes?.hirerFunded, 'Vault lane'],
            ['Vault SDK', caps.lanes?.vaultSdk, 'Bundled in export'],
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
      <Stack gap={6} surface pad={[12, 14, 12, 14]}>
        <Txt size={12} lead={16} weight="semibold" tone="ink">Vault lane and SDK</Txt>
        <Txt size={12} lead={18} tone="slate">
          Set payment to "vault" and wallet to "vault" in the manifest, with category rebalancing. A vault build ships one vault-execution card (x402Support false), the compiled @agentsouk/vault-sdk, a strategy.mjs you replace with your own edge, and a runner that dry-runs until VAULT_EXECUTE=1. Job and x402 builds keep the runtime they already have. The capability panel's "Vault SDK: In export" means the SDK is bundled into the downloaded repo so it runs without an unpublished dependency.
        </Txt>
      </Stack>
      <Stack gap={10} surface pad={[16, 18, 16, 18]}>
        <Label>Describe the agent</Label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="e.g. wrap BNB into WBNB on BSC testnet, or send a daily report of my wallet balance"
          className="w-full rounded-[10px] border border-souk-hair bg-souk-surface1 px-3 py-2 text-[13px] text-souk-ink placeholder:text-souk-muted focus:outline-none focus:ring-2 focus:ring-souk-sky/40"
        />
        {deployed && !registered?.confirmed && (
          <NoteBox title="Finish this agent first">
            <Txt size={12} lead={18} tone="slate">
              You have an unregistered deployment. Register it before generating a new agent.
            </Txt>
          </NoteBox>
        )}
        <Row gap={8} align="center">
          <Btn kind="primary" disabled={composing || !prompt.trim() || (!!deployed && !registered?.confirmed)} onClick={() => void generateFromPrompt()}>
            {composing ? 'Generating…' : 'Generate from prompt'}
          </Btn>
          <button type="button" onClick={() => { if (!deployed || registered?.confirmed) setShowEditors(true) }} className="inline-flex h-11 items-end pb-2 text-[13px] text-souk-sky underline underline-offset-2 hover:text-souk-ink disabled:opacity-40" disabled={!!deployed && !registered?.confirmed}>
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
              { label: 'Image URL is valid https (or blank)', ok: !imageUrl.trim() || imageUrl.trim().startsWith('https://') },
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
      <>
      <Rule />
      <Stack gap={8}>
        <SectionHead title="Deploy" note="YOUR OWN HOST" />
        <Stack gap={6}>
        <Label>Agent image URL (optional)</Label>
        <Row gap={12} align="center">
          {avatarSeed ? (
            <img
              src={imageUrl.trim() || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(avatarSeed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&backgroundType=gradientLinear`}
              alt="agent avatar"
              className="h-12 w-12 rounded-none border border-souk-hair"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-none border border-souk-hair bg-souk-surface2 text-souk-muted text-lg">
              ?
            </div>
          )}
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://... (public https image for the listing)"
            className="flex-1 rounded-[10px] border border-souk-hair bg-souk-surface1 px-3 py-2 text-[13px] text-souk-ink placeholder:text-souk-muted focus:outline-none focus:ring-2 focus:ring-souk-sky/40"
          />
        </Row>
        <Txt size={11} lead={16} tone="muted">
          {imageUrl.trim() ? 'Using your image.' : 'Leave blank to use the default avatar shown. You can edit your listing (description, image, examples) anytime from your agent profile after registration.'}
        </Txt>
      </Stack>

      {true && (
          <div id="manual" className="scroll-mt-4">
          <Stack gap={8} surface pad={[16, 18, 16, 18]}>
            <Txt size={14} lead={20} weight="semibold" tone="ink">Deploy anywhere</Txt>
            <Txt size={11} lead={16} tone="muted">
              Download the agent files, deploy them on any Node 20 host, then paste the public URL here.
              The export includes a Dockerfile, a README with Railway, Render, Fly.io and Docker recipes,
              and an actions.mjs stub you implement to execute on chain.
            </Txt>
            <Btn kind="off" disabled={!manifest || downloading} onClick={() => void downloadAgent()}>
              {downloading ? 'Preparing...' : 'Download agent files'}
            </Btn>
            {downloadError && <Txt size={11} lead={16} tone="peach">{downloadError}</Txt>}
            <Label>Paste your public endpoint URL</Label>
            <input
              value={manualEndpoint}
              onChange={(e) => setManualEndpoint(e.target.value)}
              placeholder="https://your-agent.example.com"
              className="w-full rounded-[10px] border border-souk-hair bg-souk-surface1 px-3 py-2 text-[13px] text-souk-ink placeholder:text-souk-muted focus:outline-none focus:ring-2 focus:ring-souk-sky/40"
            />
            <Btn kind="primary" disabled={!manualEndpoint.trim() || !manifest} onClick={async () => {
              const ep = manualEndpoint.trim()
              if (!ep || !manifest) return
              try {
                const who = (await sessionAccount()) ?? account
                if (!who) { setDeployError('Connect a wallet first.'); return }
                const auth = await authHeaders('attach', deployed?.id ?? '')
                const res = await fetch(`${API_BASE}/builder/custom/attach`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', ...auth },
                  body: JSON.stringify({ owner: who, id: deployed?.id || undefined, manifest, endpoint: ep, image: imageUrl.trim() || undefined }),
                })
                const body = await res.json() as { success?: boolean; ok?: boolean; id?: string; endpoint?: string; error?: string }
                if (!body.success || !body.id) { setDeployError(body.error ?? 'Attach failed.'); return }
                setDeployed({ success: true, ok: true, id: body.id, status: 'deployed', endpoint: body.endpoint ?? ep })
                setDeployError(null)
                const ar = await fetch(`${API_BASE}/builder/custom/agent/${body.id}`)
                const ab = await ar.json() as AgentResult
                if (ab.success) setAgentState(ab)
                try {
                  const controller = new AbortController()
                  const timer = setTimeout(() => controller.abort(), 5000)
                  const healthRes = await fetch(ep.replace(/\/+$/, '') + (manifest.healthcheck || '/health'), { mode: 'cors', signal: controller.signal })
                  clearTimeout(timer)
                  if (healthRes.ok) {
                    const health = await healthRes.json()
                    if (health.agent) setValidateMsg(`Endpoint verified: ${health.agent} (wallet: ${health.wallet ?? 'none'})`)
                  }
                } catch {
                  setValidateMsg('Could not reach the endpoint from the browser (CORS or network). Proceeding anyway.')
                }
              } catch { setDeployError('Attach request failed.') }
            }}>
              Save this endpoint
            </Btn>
            {deployed?.endpoint && (
              <Txt size={11} lead={16} tone="muted">Saved endpoint: {deployed.endpoint}</Txt>
            )}
            <Txt size={10} lead={14} tone="muted">
              CreateOS is retired permanently. Use the download and attach path above.
            </Txt>
          </Stack>
          </div>
        )}
        {deployError && <Txt size={12} lead={18} tone="peach">{deployError}</Txt>}
        {deployed && (
          <Stack gap={6} surface pad={[16, 18, 16, 18]}>
            <Txt size={16} lead={22} weight="semibold" tone="ink">Deployed</Txt>
            <Txt size={11} lead={16} mono tone="ink">id: {deployed.id}</Txt>
            <Txt size={11} lead={16} mono tone="ink">status: {deployed.status}</Txt>
            <Txt size={11} lead={16} mono tone="ink">endpoint: {deployed.endpoint}</Txt>
            {agentState?.badge && (
              <Pill variant={agentState.badge === 'established' ? 'keep' : 'off'}>
                {agentState.badge === 'established' ? '✓ Established' : agentState.badge === 'unknown' ? '? Unknown' : 'New'}
              </Pill>
            )}
            <Pill variant={agentState?.online ? 'keep' : 'off'}>
              {agentState?.online ? 'Online' : 'Offline'}
            </Pill>
            {agentState?.walletAddress && (
              <Txt size={11} lead={16} mono tone="muted">wallet: {agentState.walletAddress}</Txt>
            )}
            <Row gap={8} align="center">
              <Btn kind="off" disabled={busy === 'status'} onClick={() => void checkStatus()}>
                {busy === 'status' ? 'Checking…' : 'Check status'}
              </Btn>
              <Btn kind="primary" disabled={registering} onClick={() => void register()}>
                {registering ? 'Preparing…' : 'Prepare registration'}
              </Btn>
            </Row>

            <Stack gap={6} className="mt-2">
              <Txt size={13} lead={18} weight="semibold" tone="ink">Hirer-funded execution (C6)</Txt>
              <Txt size={11} lead={16} tone="muted">
                Execute a bounded action on a hirer's capital through the vault. Requires a vault hire ID and an allowlisted action.
              </Txt>
              {manifest && manifest.actions.length > 0 && (
                <Txt size={11} lead={16} mono tone="muted">
                  action: {manifest.actions[0].name} | venue: {manifest.actions[0].venue} | cap: USD {manifest.actions[0].maxValueUsd}
                </Txt>
              )}
              <input
                value={hireId}
                onChange={(e) => setHireId(e.target.value)}
                placeholder="Vault hire ID (uint256)"
                className="w-full rounded-[10px] border border-souk-hair bg-souk-surface1 px-3 py-2 text-[13px] text-souk-ink placeholder:text-souk-muted focus:outline-none focus:ring-2 focus:ring-souk-sky/40"
              />
              <Btn kind="off" disabled={busy === 'hirer' || !hireId.trim()} onClick={async () => {
                if (!deployed?.id || !manifest || !hireId.trim()) return
                let who = account
                if (!who) { try { who = (await sessionAccount()) ?? (await changeWallet()) ?? (await connectWallet()) } catch { setDeployError('Connect a wallet.'); return } }
                setBusy('hirer')
                setHirerResult(null)
                try {
                  const ts = Date.now().toString()
                  const message = `soukdio:hirer-execute:${who.toLowerCase()}:${deployed.id}:${ts}`
                  const sig = await signPersonalMessage(who, message)
                  const res = await fetch(`${API_BASE}/builder/custom/hirer-execute`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wallet-signature': sig, 'x-wallet-timestamp': ts }, body: JSON.stringify({ owner: who, agentId: deployed.id, hireId: hireId.trim(), action: manifest.actions[0], params: { actionType: 'swap' } }) })
                  const body = (await res.json()) as HirerExecResult
                  setHirerResult(body)
                  if (!body.success) setDeployError(body.error ?? 'Execution failed.')
                } catch { setDeployError('Execution request failed.') }
                finally { setBusy(null) }
              }}>
                {busy === 'hirer' ? 'Executing…' : 'Execute hirer-funded action'}
              </Btn>
              {hirerResult && (
                <Txt size={11} lead={16} mono tone={hirerResult.success ? 'ink' : 'peach'}>
                  {hirerResult.success ? `tx: ${hirerResult.txHash} (receipt: ${hirerResult.receiptId})` : hirerResult.error}
                </Txt>
              )}
            </Stack>
            <Row gap={8} align="center">
              <Btn kind="off" disabled={busy === 'rotate'} onClick={async () => {
                if (!deployed?.id) return
                let who = account
                if (!who) { try { who = (await sessionAccount()) ?? (await changeWallet()) ?? (await connectWallet()) } catch { setDeployError('Connect a wallet.'); return } }
                setBusy('rotate')
                try {
                  const ts1 = Date.now().toString()
                  const sig1 = await signPersonalMessage(who, `soukdio:rotate-key:${who.toLowerCase()}:${deployed.id}:${ts1}`)
                  const res = await fetch(`${API_BASE}/builder/custom/rotate-key`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wallet-signature': sig1, 'x-wallet-timestamp': ts1 }, body: JSON.stringify({ owner: who, id: deployed.id }) })
                  const body = await res.json()
                  if (!body.success) { setDeployError(body.error ?? 'Rotation failed.'); return }
                  setDeployError(null)
                  setValidateMsg(`Key rotated. New wallet: ${body.newWallet}`)
                } catch { setDeployError('Rotation request failed.') }
                finally { setBusy(null) }
              }}>
                {busy === 'rotate' ? 'Rotating…' : 'Rotate key'}
              </Btn>
              <Btn kind="warn" disabled={busy === 'revoke'} onClick={async () => {
                if (!deployed?.id) return
                let who = account
                if (!who) { try { who = (await sessionAccount()) ?? (await changeWallet()) ?? (await connectWallet()) } catch { setDeployError('Connect a wallet.'); return } }
                setBusy('revoke')
                try {
                  const ts2 = Date.now().toString()
                  const sig2 = await signPersonalMessage(who, `soukdio:revoke:${who.toLowerCase()}:${deployed.id}:${ts2}`)
                  const res = await fetch(`${API_BASE}/builder/custom/revoke`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wallet-signature': sig2, 'x-wallet-timestamp': ts2 }, body: JSON.stringify({ owner: who, id: deployed.id }) })
                  const body = await res.json()
                  if (!body.success) { setDeployError(body.error ?? 'Revoke failed.'); return }
                  setDeployed(null)
                  setDeployError(null)
                  setValidateMsg('Agent revoked. Deployment deleted.')
                } catch { setDeployError('Revoke request failed.') }
                finally { setBusy(null) }
              }}>
                {busy === 'revoke' ? 'Revoking…' : 'Revoke'}
              </Btn>
            </Row>
          </Stack>
        )}
        {registered && (
          <NoteBox title={registered.confirmed ? 'Registered on chain' : registered.txHash ? 'Transaction sent' : 'Registration prepared'}>
            <Txt size={12} lead={18} tone="slate">
              {registered.confirmed
                ? 'The agent is registered on chain. The marketplace will check the endpoint and activity proof before listing.'
                : registered.txHash
                  ? 'Transaction sent. Waiting for confirmation...'
                  : 'Wallet connected. Review and approve the transaction in your wallet.'}
            </Txt>
            {registered.txHash && (
              <Txt size={11} lead={16} mono tone="ink">tx: {registered.txHash}</Txt>
            )}
            {!registered.txHash && (
              <div className="max-h-48 overflow-auto rounded-[8px] border border-souk-hair bg-souk-surface1 p-2">
                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-souk-ink">{JSON.stringify(registered.registration, null, 2)}</pre>
              </div>
            )}
            {registered.confirmed && (
              <Row gap={8} align="center">
                <Link to="/agents">
                  <Btn kind="primary">Go to agent profile</Btn>
                </Link>
                <Btn kind="off" onClick={() => { setDeployed(null); setRegistered(null); setAgentState(null); setBuildId(null); setManifest(null); setManifestText(''); setCode(''); setShowEditors(false); setGenerated(false); setValidated(false); setPrompt(''); setAvatarSeed(null); setImageUrl(''); setManualEndpoint(''); setDeployError(null) }}>
                  Build another
                </Btn>
              </Row>
            )}
          </NoteBox>
        )}
        {agentState && (
          <Stack gap={4}>
            <Txt size={11} lead={16} tone="muted">listing state: {agentState.listingState ?? 'unknown'}</Txt>
            <Txt size={11} lead={16} mono tone="ink">endpoint: {agentState.endpoint}</Txt>
            <Txt size={11} lead={16} mono tone="ink">metadata: {API_BASE}/builder/custom/agent/{deployed?.id}/metadata</Txt>
          </Stack>
        )}


      </Stack>
      </>
      )}

      <Rule />

      <Stack gap={4}>
        <Txt size={18} lead={26} weight="bold" tone="ink">All registration routes</Txt>
        <Txt size={12} lead={18} tone="slate" className="max-w-[68ch]">
          Every route below ends at the same ERC-8004 registration on BNB Smart Chain.
          Pick the one that fits what you already have.
        </Txt>
      </Stack>
      <div className="grid gap-4 md:grid-cols-2">
        <PeelCard peel="Already built" title="List an agent you already run" body="If it already answers behind an HTTPS endpoint, listing is one registration transaction. We check the endpoint and the card on chain." to="/list#register-here" button="List your agent" />
        <PeelCard peel="Other stack" title="Build with another stack" body="BNB Agent Studio, the bnb CLI, or your own stack. The listing guide walks the build and the registration together." to="/list#create" button="See the build routes" />
      </div>

    </Stack>
  )
}

