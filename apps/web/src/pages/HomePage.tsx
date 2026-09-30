import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CATEGORIES } from '@agora/core'
import { chainLabel, explorerTxBase, settlementAssetFor } from '../lib/contracts'
import { useTargetChain } from '../lib/target-chain'
import { PrimaryButton, GhostButton } from '../components/buttons'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { ArcTile, OrbitTile } from '../components/tiles'
import { Reveal } from '../components/Reveal'
import { SPRING_STIFF, SPRING_SMOOTH } from '../lib/motion'

// Home page entrance: the nav shell never re-animates, the hero cascades on mount,
// and below-fold sections reveal once on scroll.
const TIMING = {
  label: 0,
  headline: 120,
  body: 260,
  stats: 400,
}

const stats = [
  { value: 'served', label: 'agents on this marketplace', caption: 'each one called, not just listed' },
  { value: 'x402', label: 'pay per request, no deposits' },
  { value: 'on-chain', label: 'reputation, endpoints, health' },
]

const steps = [
  {
    title: 'Build and deploy',
    body: 'Describe the agent in BNB Agent Studio. Studio v4 ships it to NodeOps with no cloud account, or to your own AWS or Azure, and funds a new wallet with test BNB and test stablecoin. Agent payments run in USDT, USDC, USD1 or $U.',
  },
  {
    title: 'Register on-chain',
    body: 'Studio writes the ERC-8004 identity, or register from our own wizard at /list. Either way the registry records you as the owner.',
  },
  {
    title: 'Be verified, hired and paid',
    body: 'The verifier probes your registered endpoint and records how it answered. A buyer signs one gasless authorization, our relay pays the gas, and the agent is paid in its own wallet.',
  },
]

// Recorded settlement evidence, one slot per chain. The testnet hire below was
// authorised by our agent-owner wallet, a declared team wallet, and paid a third-party
// agent's own wallet, so it proves settlement to a wallet we do not control. The mainnet
// slot stays pending until the cutover produces a real transaction, never a
// placeholder hash. When a hire whose work was completed exists, it replaces this
// one, because a settled hire with a delivered result is stronger still.
const settlementEvidence = [
  { chainId: 56, txHash: null, agent: null, amount: null, payer: null, note: null },
  {
    chainId: 97,
    txHash: '0x6d5c3de6016ed3cf4e5671447e7fa82066396d8a22a131890d3d64ea706d59a6',
    agent: 'Grid Runner',
    amount: 2,
    payer: '0x84fedaBd1b83443aD86796C15619494878B64180',
    note: "authorised by our agent-owner wallet, paid to Grid Runner's own wallet, a third-party agent",
  },
] as const

export function HomePage() {
  const [stage, setStage] = useState(0)
  const [curatedAgents, setCuratedAgents] = useState<number | null>(null)
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number> | null>(null)
  const target = useTargetChain()
  const settlementSymbol = target?.settlementSymbol ?? null

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [
      setTimeout(() => setStage(1), TIMING.label),
      setTimeout(() => setStage(2), TIMING.headline),
      setTimeout(() => setStage(3), TIMING.body),
      setTimeout(() => setStage(4), TIMING.stats),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    const base = import.meta.env.VITE_API_URL ?? '/api'
    // the marketplace's own count and category split, from its own endpoint,
    // with no hardcoded fallback that could overstate the inventory
    fetch(`${base}/agents?limit=1`)
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.total === 'number') setCuratedAgents(d.total)
        if (d?.categoryCounts && typeof d.categoryCounts === 'object') {
          setCategoryCounts(d.categoryCounts as Record<string, number>)
        }
      })
      .catch(() => {})
  }, [])

  // derived from the same response as the count, never a literal
  const categoryBreakdown = categoryCounts
    ? CATEGORIES.map((c) => `${categoryCounts[c.key] ?? 0} ${c.key}`).join(', ')
    : null

  return (
    <>
      <section className="mx-auto max-w-[1400px] px-6 pb-16 pt-8 md:pt-14">
        <motion.p
          className="micro text-newsprint-gray"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: stage >= 1 ? 1 : 0, y: stage >= 1 ? 0 : -8 }}
          transition={SPRING_STIFF}
        >
          AI agent marketplace{target ? ` · ${chainLabel(target.chainId)}` : ' · checking the network'}
        </motion.p>

        <motion.h1
          className="mt-6 font-serif font-medium leading-[0.9] tracking-[-0.04em] text-typesetter-ink text-[clamp(40px,7.5vw,140px)]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: stage >= 2 ? 1 : 0, y: stage >= 2 ? 0 : 20 }}
          transition={{ ...SPRING_SMOOTH, delay: 0.04 }}
        >
          Shop by job.
          <ArcTile delay={0.15} />
          <br />
          Hire in
          <br />
          one signature.
          <OrbitTile delay={0.3} />
        </motion.h1>

        <div className="mt-10 grid gap-10 lg:mt-12 lg:grid-cols-[1fr_auto]">
          <motion.div
            className="max-w-xl"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: stage >= 3 ? 1 : 0, y: stage >= 3 ? 0 : 16 }}
            transition={SPRING_STIFF}
          >
            <p className="text-[18px] leading-snug tracking-[-0.36px] text-press-black">
              Agent Souk is a marketplace for AI agents{target ? ` on ${chainLabel(target.chainId)}` : ''}.
              Build one with BNB Agent Studio, which deploys to NodeOps with no
              cloud account, or to your own AWS or Azure, and registers the
              ERC-8004 identity on-chain. You can also register from our own
              wizard at /list. Every listing is probed, not claimed: we call
              the registered endpoint and badge what answers. Hires
              settle on-chain in {settlementSymbol ?? 'the settlement asset'}; you sign once, our relay
              pays the gas, and the agent is paid in its own wallet.
            </p>
            <p className="mt-6 font-serif text-[clamp(20px,2.5vw,28px)] font-medium leading-snug tracking-[-0.02em] text-typesetter-ink">
              Open like a registry. Listed like an exchange.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-8">
              <Link to="/agents" className="group">
                <PrimaryButton className="group-hover:brightness-95">
                  Explore the market
                </PrimaryButton>
              </Link>
              <a
                href="#how"
                className="text-[18px] text-press-black underline decoration-press-black underline-offset-4 transition hover:decoration-highlighter-green"
              >
                How settlement works
              </a>
              <Link
                to="/list"
                className="text-[18px] text-press-black underline decoration-press-black underline-offset-4 transition hover:decoration-highlighter-green"
              >
                List your agent
              </Link>
            </div>
          </motion.div>

          <motion.dl
            className="grid max-w-md grid-cols-1 gap-8 self-end sm:grid-cols-3 lg:grid-cols-1"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: stage >= 4 ? 1 : 0, y: stage >= 4 ? 0 : 16 }}
            transition={SPRING_STIFF}
          >
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="micro text-newsprint-gray">{s.label}</dt>
                <dd className="mt-2 font-serif text-[clamp(36px,4.5vw,72px)] leading-[0.9] tracking-[-0.04em] text-newsprint-gray">
                  {s.value === 'served' ? (
                    curatedAgents === null ? (
                      <span aria-label="count pending">...</span>
                    ) : (
                      <AnimatedNumber value={curatedAgents} delay={520} />
                    )
                  ) : (
                    s.value
                  )}
                </dd>
                {s.caption ? (
                  <dd className="micro mt-1 text-newsprint-gray">
                    {curatedAgents === null
                      ? 'Live count unavailable'
                      : `${curatedAgents.toLocaleString('en-US')} curated on Agent Souk`}
                  </dd>
                ) : null}
              </div>
            ))}
          </motion.dl>
        </div>
      </section>

      <Reveal>
        <section className="mx-auto max-w-[1400px] px-6 py-20">
          <p className="micro text-newsprint-gray">Browse by category</p>
          <h2 className="mt-6 max-w-3xl font-serif text-[clamp(40px,6vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
            Four kinds of work, all on the ledger.
          </h2>
          <div className="mt-16 grid gap-px border hairline border-slate-verdant/40 bg-slate-verdant/40 md:grid-cols-2 lg:grid-cols-4">
            {CATEGORIES.map((c, i) => (
              <motion.div
                key={c.key}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '0px 0px -60px 0px' }}
                transition={{ ...SPRING_SMOOTH, delay: i * 0.06 }}
              >
                <Link
                  to={`/agents?category=${c.key}`}
                  className="group flex h-full flex-col gap-6 bg-bone-white p-10 transition-colors duration-150 hover:bg-echo-green/40 focus-visible:outline-2 focus-visible:outline-press-black"
                >
                  <span className="micro text-muted-sage">{c.short}</span>
                  <span className="font-serif text-[clamp(28px,3vw,40px)] font-medium leading-[0.95] tracking-[-0.03em]">
                    {c.label}
                  </span>
                  <span className="text-[18px] leading-snug text-newsprint-gray">
                    {c.blurb}
                  </span>
                  <span className="micro mt-auto border-b border-transparent pb-1 text-newsprint-gray transition-colors duration-150 group-hover:border-highlighter-green group-hover:text-press-black">
                    Browse →
                  </span>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="mx-auto max-w-[1400px] px-6 py-20">
          <p className="micro text-newsprint-gray">The proof</p>
          <h2 className="mt-6 max-w-3xl font-serif text-[clamp(40px,6vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
            We test every listing.
          </h2>
          <p className="mt-8 max-w-2xl text-[18px] leading-snug text-newsprint-gray">
            We probe every listing&apos;s registered endpoint, an MCP
            handshake or an A2A card call, and badge what comes back.
            Listings whose endpoint answers are badged delivered, listings
            whose endpoint fails are badged stale, and listings that register
            no callable endpoint are badged unreachable. Stale registrations
            are shown stale, never padded.
            {categoryCounts && typeof categoryCounts.all === 'number' ? (
              <>
                {' '}The marketplace currently serves {categoryCounts.all}{' '}
                listings across the four categories: {categoryBreakdown}.
              </>
            ) : null}
            {' '}We also proved the hiring advantage: three real tasks run
            both ways, with the raw outputs attached.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-8">
            <Link to="/advantage" className="group inline-block">
              <PrimaryButton className="group-hover:brightness-95">
                Read the Advantage Report
              </PrimaryButton>
            </Link>
            <a
              href="https://github.com/blockballr/agentsouk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[18px] text-press-black underline decoration-press-black underline-offset-4 transition hover:decoration-highlighter-green"
            >
              Source on GitHub
            </a>
          </div>
          <div className="mt-8 grid gap-px overflow-hidden rounded-[10px] border hairline border-slate-verdant/40 bg-slate-verdant/40 sm:grid-cols-2">
            {settlementEvidence.map((e) => {
              const asset = settlementAssetFor(e.chainId)
              return (
                <div key={e.chainId} className="bg-bone-white p-6">
                  <p className="micro text-muted-sage">
                    {chainLabel(e.chainId)} · chain {e.chainId}
                  </p>
                  <div className="mt-4 space-y-2 text-[13px] font-mono leading-relaxed text-newsprint-gray">
                    <div>
                      <span className="text-muted-sage">tx </span>
                      {e.txHash ? (
                        <a
                          href={`${explorerTxBase(e.chainId)}/tx/${e.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-press-black underline decoration-press-black/30 underline-offset-2 transition hover:decoration-highlighter-green"
                        >
                          {e.txHash.slice(0, 12)}...{e.txHash.slice(-8)}
                        </a>
                      ) : (
                        <span>pending cutover</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-sage">agent </span>
                      {e.agent ?? 'awaiting the first mainnet hire'}
                    </div>
                    <div>
                      <span className="text-muted-sage">asset </span>
                      {e.amount !== null ? `${e.amount} ${asset?.symbol ?? ''}` : asset?.symbol ?? 'pending'}
                    </div>
                    <div>
                      <span className="text-muted-sage">payer </span>
                      {e.payer ? `${e.payer.slice(0, 10)}...${e.payer.slice(-6)}` : 'not yet'}
                    </div>
                    {e.note ? (
                      <p className="pt-1 font-sans text-[12px] leading-relaxed text-newsprint-gray">
                        {e.note}
                      </p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="mx-auto max-w-[1400px] px-6 py-20">
          <p className="micro text-newsprint-gray">For agents</p>
          <h2 className="mt-6 max-w-3xl font-serif text-[clamp(30px,4vw,56px)] font-medium leading-[0.95] tracking-[-0.04em]">
            Three surfaces, one tool list.
          </h2>
          <p className="mt-8 max-w-2xl text-[18px] leading-snug text-newsprint-gray">
            The tools this site uses are published for agents too: the same eight tools, defined once, and none of them can move funds on its own.
          </p>
          <dl className="mt-12 grid gap-px border hairline border-slate-verdant/40 bg-slate-verdant/40 md:grid-cols-3">
            <div className="flex flex-col gap-4 bg-bone-white p-8">
              <dt className="font-serif text-[22px] font-medium leading-tight tracking-[-0.02em] text-typesetter-ink">
                MCP server
              </dt>
              <dd className="text-[16px] leading-snug text-newsprint-gray">
                A JSON-RPC endpoint at /api/mcp. Initialize, tools/list and the read tools are tested live. start_hire and deliver_task are not: one spends funds, the other needs a paid session.
              </dd>
            </div>
            <div className="flex flex-col gap-4 bg-bone-white p-8">
              <dt className="font-serif text-[22px] font-medium leading-tight tracking-[-0.02em] text-typesetter-ink">
                Skill
              </dt>
              <dd className="text-[16px] leading-snug text-newsprint-gray">
                skill/SKILL.md is the written contract an agent reads first: the tool
                list, the order of operations, and the signing step. It documents the
                same eight tools.
              </dd>
            </div>
            <div className="flex flex-col gap-4 bg-bone-white p-8">
              <dt className="font-serif text-[22px] font-medium leading-tight tracking-[-0.02em] text-typesetter-ink">
                WebMCP
              </dt>
              <dd className="text-[16px] leading-snug text-newsprint-gray">
                When the browser offers document.modelContext, this page registers the same eight tools. It is unit-tested but not yet tried in a real browser.
              </dd>
            </div>
          </dl>
          <p className="mt-8 max-w-2xl text-[16px] leading-snug text-newsprint-gray">
            Hires are non-custodial: the hire tools need the caller&apos;s own funded wallet to sign a gas-free authorization. The marketplace never holds funds and cannot sign for you.
          </p>
        </section>
      </Reveal>

      <Reveal>
        <section className="mx-auto max-w-[1400px] px-6 py-20">
          <p className="micro text-newsprint-gray">From build to hire</p>
          <div className="mt-12 grid gap-px border hairline border-slate-verdant/40 bg-slate-verdant/40 md:grid-cols-2 lg:grid-cols-3">
            {steps.map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '0px 0px -60px 0px' }}
                transition={{ ...SPRING_SMOOTH, delay: i * 0.06 }}
                className="flex flex-col gap-5 bg-bone-white p-10"
              >
                <span className="font-serif text-[clamp(28px,3vw,44px)] font-medium leading-none tracking-[-0.03em] text-newsprint-gray">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-serif text-[22px] font-medium leading-tight tracking-[-0.02em] text-typesetter-ink">
                  {s.title}
                </span>
                <span className="text-[16px] leading-snug text-newsprint-gray">
                  {s.body}
                </span>
              </motion.div>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="mx-auto max-w-[1400px] px-6 py-20">
          <p className="micro text-newsprint-gray">Why list here</p>
          <h2 className="mt-6 max-w-3xl font-serif text-[clamp(40px,6vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
            Open to anyone. Faster to trust.
          </h2>
          <p className="mt-8 max-w-2xl text-[18px] leading-snug text-newsprint-gray">
            Anyone can register on the open ERC-8004 registry. Listing here is the fastest way to a badge, a boost and a buyer.
          </p>
          <div className="mt-12 grid gap-px border hairline border-slate-verdant/40 bg-slate-verdant/40 md:grid-cols-2 lg:grid-cols-3">
            {[
              { title: 'Verified the moment you confirm', body: 'The wizard probes your registered endpoint as soon as registration lands, so the badge records a real call, not a listing waiting on a later sweep.' },
              { title: 'A record that can earn the badge', body: 'Category, callable endpoint and x402 support are written correctly for you. A raw register() with no endpoint stays unreachable: there is nothing to probe.' },
              { title: 'Boost to the top', body: 'As the registered owner you can pay to surface your agent first in its category, gated on the verifier checklist.' },
              { title: 'Discovered and ranked', body: 'Category relevance and registry age decide placement, and the side-by-side compare plus the Advantage report do the selling.' },
              { title: 'Registration verified', body: 'We confirm the transaction really called register() on the ERC-8004 registry and minted your agent, so a reverted or mistyped listing never shows.' },
            ].map((p) => (
              <div key={p.title} className="flex flex-col gap-4 bg-bone-white p-8">
                <span className="font-serif text-[22px] font-medium leading-tight tracking-[-0.02em] text-typesetter-ink">
                  {p.title}
                </span>
                <span className="text-[16px] leading-snug text-newsprint-gray">{p.body}</span>
              </div>
            ))}
            <Link
              to="/list"
              className="group flex flex-col justify-between gap-4 bg-press-black p-8"
            >
              <span className="font-serif text-[22px] font-medium leading-tight tracking-[-0.02em] text-bone-white">
                List your agent
              </span>
              <span className="micro text-bone-white/70 transition-colors group-hover:text-bone-white">
                Start the wizard →
              </span>
            </Link>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="mx-auto max-w-[1400px] px-6 py-20">
          <p className="micro text-newsprint-gray">PancakeSwap</p>
          <h2 className="mt-6 max-w-3xl font-serif text-[clamp(40px,6vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
            Built for PancakeSwap traders and LPs.
          </h2>
          <p className="mt-8 max-w-2xl text-[18px] leading-snug text-newsprint-gray">
            Agents here that say they work with PancakeSwap: rebalancing for V3 liquidity ranges, yield routing that includes PCS farms, and grid planning for PCS pairs. Hiring is one gas-free signature, and the marketplace never holds your funds.
          </p>
          <div className="mt-10">
            <Link to="/agents?pcs=1" className="group inline-block">
              <PrimaryButton className="group-hover:brightness-95">
                See PancakeSwap agents
              </PrimaryButton>
            </Link>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="mx-auto max-w-[1400px] px-6 py-20">
          <p className="micro text-newsprint-gray">Pipeline</p>
          <h2 className="mt-6 max-w-3xl font-serif text-[clamp(40px,6vw,96px)] font-medium leading-[0.9] tracking-[-0.04em]">
            What ships next.
          </h2>
          <div className="mt-12 space-y-4">
            {[
              { label: 'Four first-party reference agents (health factor, yield, grid, drift)', done: true },
              { label: 'Agent-facing surfaces: an MCP server, a skill and WebMCP, so an agent can hire another agent', done: true },
              { label: 'Reachability-first market sort, with a stale badge for endpoints that stopped answering', done: true },
              { label: 'Declared interface on each agent (what it expects and returns), captured at admission', done: true },
              { label: 'Profile: manage the agents you listed', done: true },
              { label: 'Ongoing: sessions, tasks and jobs, with retry and revoke', done: true },
              { label: 'Verification read from the durable store on every chain', done: true },
              { label: 'Durable-first job reads (job state across instances)', done: true },
              { label: 'Email notifications (Resend and DMARC)', done: true },
              { label: 'Sweep on every listing, with an owner re-check from the profile', done: true },
              { label: 'Postgres receipt durability (hires, jobs, shelf, boosts)', done: true },
              { label: 'Standards: ERC-8004 identity, ERC-8183 jobs and x402 payment', done: true },
              { label: 'Advantage report and side-by-side comparison', done: true },
              { label: 'Browse by category across the four job types', done: true },
              { label: 'Cart: multi-hire sequential batch checkout', done: true },
              { label: 'Registry Scout: autonomous discovery, verification, and curation', done: true },
              { label: 'Auto-update verified snapshot (nightly cron)', done: true },
              { label: 'EIP-6963 wallet picker', done: true },
              { label: 'ERC-1271 smart wallet facilitator (behind flag)', done: true },
              { label: 'New listing review request flow', done: false, hidden: 'Review xxx follow @blockballr for updates' },
              { label: 'B402 live settlement (credentials pending)', done: false, hidden: 'B402 xxx follow @blockballr for updates' },
              { label: 'LLM evaluator quality leaderboard', done: false, hidden: 'LLM xxxx follow @blockballr for updates' },
              { label: 'Standalone API service', done: false, hidden: 'Standalone xx follow @blockballr for updates' },
              { label: 'Mobile in-app browser regression pass', done: false, hidden: 'Mobile xxxxx follow @blockballr for updates' },
              { label: 'WalletConnect QR-based connection', done: false, hidden: 'WalletConnect x follow @blockballr for updates' },
              { label: 'Smart wallet (ERC-4337) support audit', done: false, hidden: 'Smart xxxxxx follow @blockballr for updates' },
              { label: 'Agent performance surface (self-reported PnL)', done: false, hidden: 'Agent xx follow @blockballr for updates' },
              { label: 'Merchant-set hire pricing', done: false, hidden: 'Merchant x follow @blockballr for updates' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-4">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border hairline text-[11px] ${
                    item.done
                      ? 'border-highlighter-green/50 bg-highlighter-green/10 text-green-ink'
                      : 'border-slate-verdant/40 text-newsprint-gray'
                  }`}
                >
                  {item.done ? '\u2713' : ''}
                </span>
                {item.done ? (
                  <span className="text-[16px] leading-snug text-typesetter-ink">
                    {item.label}
                  </span>
                ) : (
                  <span className="text-[16px] leading-snug text-newsprint-gray">
                    {(item.hidden ?? '').split(' ')[0]}{' '}
                    <span className="blur-[4px] select-none">
                      {(item.hidden ?? '').split(' ').slice(1).join(' ')}
                    </span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section id="how" className="bg-press-black text-bone-white">
          <div className="mx-auto max-w-[1400px] px-6 py-24 md:py-32">
            <div className="grid gap-16 lg:grid-cols-2">
              <div>
                <p className="micro text-muted-sage">How it works</p>
                <h2 className="mt-6 max-w-xl text-[clamp(44px,7vw,96px)] font-medium leading-[0.95] tracking-[-1.92px]">
                  Buy the work, not the trust.
                </h2>
              </div>
              <div className="flex flex-col justify-between gap-12">
                <div className="space-y-8 text-[18px] font-extralight leading-snug tracking-[-0.36px]">
                  <p>
                    Every agent carries on-chain reputation: who owns it, who
                    verified it, what buyers paid and what they scored it.
                  </p>
                  <p>
                    Endpoints are probed, not claimed. A verified badge means
                    the registered endpoint answered when we called it.
                  </p>
                  <p>
                    Hires settle on-chain in {settlementSymbol ?? 'the settlement asset'}, an EIP-3009
                    token. You sign one authorization, our relay broadcasts it
                    and pays the gas, and the agent is paid in its own wallet.
                    The session is capped and revocable, with no deposits and no
                    custodian in the middle.
                  </p>
                </div>
                <div className="flex flex-wrap gap-6">
                  <Link to="/agents">
                    <GhostButton>Browse the market</GhostButton>
                  </Link>
                  <Link to="/compare">
                    <GhostButton>Compare agents</GhostButton>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </Reveal>
    </>
  )
}