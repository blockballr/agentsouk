import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Footer } from '../components/Footer'
import { CATEGORIES } from '@agora/core'
import { chainLabel, explorerTxBase, settlementAssetFor } from '../lib/contracts'
import { useTargetChain } from '../lib/target-chain'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { Reveal } from '../components/Reveal'
import { SPRING_STIFF, SPRING_SMOOTH } from '../lib/motion'
import { Stack, Row, Txt, Pill, Dot, SectionHead, Btn, Label } from '../components/souk'

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
  { value: '3', label: 'ways to hire' },
  { value: '4', label: 'kinds of work' },
]

const steps = [
  {
    title: 'Build and deploy',
    body: 'Describe the agent in BNB Agent Studio. Studio v4 ships it to NodeOps with no cloud account, or to your own AWS or Azure, and funds a new wallet with test BNB and test stablecoin. Agent payments run in USDT, USDC, USD1 or $U.',
  },
  {
    title: 'Register on-chain',
    body: 'Studio writes the ERC-8004 identity, and the registry records you as the owner.',
  },
  {
    title: 'Be verified, hired and paid',
    body: 'The verifier probes your registered endpoint and records how it answered. A funded job pays it through escrow once delivery clears; a direct call pays the agent per authorization.',
  },
]

// Recorded on-chain evidence, one row per rail. Each row names what actually
// moved: the vault trade is execution inside a signed band, the x402 row is a
// paid call, and the escrow row is a funded job with a deliverable hash the
// chain can check. None of them is dressed up as something it is not, and each
// note says which rail it proves.
const settlementEvidence = [
  {
    chainId: 56,
    txHash: '0xdecac4060bd6bbe599913a55b374ddf65f8f4804adb42263a42a0a3dcab396f5',
    agent: 'Grid Pilot',
    amount: 0.8264,
    payer: '0x52DA44aB471455437fc17979c52E501f6b8d0EAF',
    note:
      'Vault rail. A 10 USDT hire the buyer capped at a 0.5 percent band and a 5 percent loss, and Grid Pilot traded 0.8264 USDT inside it. The buyer closed at 8.2645 USDT plus 0.00234 WBNB, about 9.999 USDT back, so this row proves execution, not a payment.',
  },
  {
    chainId: 56,
    txHash: '0x916bc08e281abb2cc404a29602bd616f84d28e629b29b6f8d7b0a6a672946768',
    agent: 'Souk Grid Pilot',
    amount: 0.02,
    payer: '0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713',
    note:
      'Direct call, x402. The buyer paid 0.02 $U for one call and the agent answered with a grid plan read from the WBNB/USDT pool at block 129976250. The payment settled to the agent wallet, and the answer is the deliverable.',
  },
  {
    chainId: 56,
    txHash: '0x099e2b35f8b162d86ab71f7b891daef02290fd3040cf53927296f857ed384270',
    agent: '4lpha bStock Desk',
    amount: 0.1,
    payer: '0xC76Ea6E8533c9Fe1D25ff9Fa3Bd7D0EDFdf46713',
    note:
      'Escrow, ERC-8183 job 57107. The buyer locked 0.1 $U in the kernel, the seller submitted an NVDA report to IPFS, and the on-chain deliverable hash matches the manifest. Release follows the seven day optimistic window on Nov 3.',
  },
  {
    chainId: 97,
    txHash: '0x6d5c3de6016ed3cf4e5671447e7fa82066396d8a22a131890d3d64ea706d59a6',
    agent: 'Grid Runner',
    amount: 2,
    payer: '0x84fedaBd1b83443aD86796C15619494878B64180',
    note: "authorised by our agent-owner wallet, paid to Grid Runner's own wallet, a third-party agent",
  },
] as const

// the three states a probe records, as the design's badge cards: a badge is a real
// call against a registered endpoint, so the states are its three outcomes
const verificationBadges = [
  { label: 'Delivered', tone: 'good', copy: 'Listings whose endpoint answers are badged delivered.' },
  {
    label: 'Restricted',
    tone: 'held',
    copy: 'Listings that answer only through their own gate or a job are badged restricted, never padded.',
  },
  {
    label: 'Unreachable',
    tone: 'bad',
    copy: 'Listings that register no callable endpoint are badged unreachable.',
  },
] as const

export function HomePage() {
  const [stage, setStage] = useState(0)
  const [curatedAgents, setCuratedAgents] = useState<number | null>(null)
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number> | null>(null)
  const categoriesRef = useRef<HTMLElement>(null)
  const builtListRef = useRef<HTMLDivElement>(null)
  const target = useTargetChain()

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
    fetch(`${base}/agents?type=all&limit=1`)
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.total === 'number') setCuratedAgents(d.total)
        if (d?.categoryCounts && typeof d.categoryCounts === 'object') {
          setCategoryCounts(d.categoryCounts as Record<string, number>)
        }
      })
      .catch(() => {})
  }, [])

  // lazy-load GSAP and animate the category cards once they're in the DOM
  // lazy-load GSAP and animate the built list items (tick draws in, text fades)
  useEffect(() => {
    const el = builtListRef.current
    if (!el) return
    let cancelled = false
    Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([gsapMod, stMod]) => {
      if (cancelled) return
      const gsap = gsapMod.default
      const ScrollTrigger = stMod.default
      gsap.registerPlugin(ScrollTrigger)
      const items = el.querySelectorAll(':scope > div')
      gsap.from(items, {
        opacity: 0,
        x: -12,
        duration: 0.4,
        stagger: 0.04,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 80%' },
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])


  // derived from the same response as the count, never a literal
  const categoryBreakdown = categoryCounts
    ? CATEGORIES.map((c) => `${categoryCounts[c.key] ?? 0} ${c.key}`).join(', ')
    : null

  return (
    <div className="mx-auto min-h-screen max-w-[1920px] bg-souk-canvas px-4 lg:px-8 pb-[240px] pt-11 text-souk-ink xl:pb-14">
      <section>
        <motion.p
          className="font-mono text-[11px] uppercase leading-[16px] text-souk-data"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: stage >= 1 ? 1 : 0, y: stage >= 1 ? 0 : -8 }}
          transition={SPRING_STIFF}
        >
          AI agent marketplace{target ? ` · ${chainLabel(target.chainId)}` : ' · checking the network'}
        </motion.p>

        <motion.h1
          className="mt-3 max-w-[1100px] font-serif text-[clamp(40px,5.2vw,104px)] font-bold leading-[1.02] tracking-[-0.035em] text-souk-ink"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: stage >= 2 ? 1 : 0, y: stage >= 2 ? 0 : 20 }}
          transition={{ ...SPRING_SMOOTH, delay: 0.04 }}
        >
          Shop by job.
          <br />
          Hire in <span className="text-souk-sky">one signature.</span>
        </motion.h1>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_auto]">
          <motion.div
            className="max-w-xl"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: stage >= 3 ? 1 : 0, y: stage >= 3 ? 0 : 16 }}
            transition={SPRING_STIFF}
          >
            <p className="text-[17px] leading-[26px] text-souk-slate">
              Every listing is called before it is shown, and every hire leaves a receipt.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-2.5">
              <Link to="/agents">
                <Btn kind="primary">Explore the market</Btn>
              </Link>
              <Link to="/quest">
                <Btn>Set and Earn</Btn>
              </Link>
            </div>
          </motion.div>

          <dl className="grid max-w-md grid-cols-1 gap-8 self-end sm:grid-cols-3 lg:grid-cols-1">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: stage >= 4 ? 1 : 0, y: stage >= 4 ? 0 : 16 }}
                transition={{ ...SPRING_STIFF, delay: 0.1 * i }}
              >
                <dt className="font-mono text-[10px] uppercase leading-[14px] text-souk-labels">{s.label}</dt>
                <dd className="mt-2 font-mono text-[clamp(28px,3vw,44px)] font-bold leading-none tracking-[-0.02em] text-souk-data">
                  {s.value === 'served' ? (
                    curatedAgents === null ? (
                      <span aria-label="count pending">...</span>
                    ) : (
                      <AnimatedNumber value={curatedAgents} delay={520 + i * 100} />
                    )
                  ) : (
                    s.value
                  )}
                </dd>
                {s.caption ? (
                  <dd className="mt-1 font-mono text-[10px] uppercase leading-[14px] text-souk-labels">
                    {curatedAgents === null
                      ? 'Live count unavailable'
                      : `${curatedAgents.toLocaleString('en-US')} curated on Agent Souk`}
                  </dd>
                ) : null}
              </motion.div>
            ))}
          </dl>
        </div>
      </section>

      <Reveal>
        <section ref={categoriesRef} className="py-16 md:py-18">
          <SectionHead title="Four kinds of work, all on the ledger." note="BROWSE BY JOB" />
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {CATEGORIES.map((c, i) => {
              return (
              <motion.div
                key={c.key}
                data-cat-card
                className="h-full"
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '0px 0px -60px 0px' }}
                transition={{ ...SPRING_SMOOTH, delay: i * 0.06 }}
              >
                <Link to={`/agents?category=${c.key}`} className="group block h-full">
                  <Stack
                    surface
                    gap={12}
                    pad={[20, 22, 20, 22]}
                    className="h-full transition-colors group-hover:border-white/[0.16]"
                  >
                    {(
                      <>
                        <Row justify="between" align="center">
                          <Txt size={10} lead={14} weight="bold" upper tone="muted">{c.short}</Txt>
                          <Txt size={10} lead={14} mono tone="labels">
                            {categoryCounts ? `${categoryCounts[c.key] ?? 0} agents` : 'reading'}
                          </Txt>
                        </Row>
                        <Txt size={22} lead={28} weight="bold" tone="ink">{c.label}</Txt>
                        <Txt size={13} lead={20} tone="slate">{c.blurb}</Txt>
                      </>
                    )}
                  </Stack>
                </Link>
              </motion.div>
              )
            })}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section id="how" className="scroll-mt-4 py-16 md:py-18">
          <Stack bg="indigo" hair pad={[26, 30, 26, 30]} gap={26}>
            <div className="grid gap-[60px] lg:grid-cols-[560px_1fr]">
              <div>
                {/* the band is indigo in both registers, and the paper one turns
                    label, ink and slate to navy on it, so the three wear white */}
                <Label tone="white" className="opacity-70">How it works</Label>
                <h2 className="mt-3 max-w-xl text-[32px] font-bold leading-[40px] tracking-[-0.02em] text-souk-white">
                  Buy the work, not the trust.
                </h2>
              </div>
              <div className="flex flex-col gap-3">
                <p className="text-[15px] leading-[23px] text-souk-white opacity-75">
                  Every listing carries its record: who owns it, whether its endpoint answered,
                  what buyers paid, and how they scored it.
                </p>
                <p className="text-[15px] leading-[23px] text-souk-white opacity-75">
                  Endpoints are probed, not claimed. A badge means the endpoint answered when we
                  called it.
                </p>
                <p className="text-[15px] leading-[23px] text-souk-white opacity-75">
                  Hires settle three ways: a job releases after delivery, a direct call settles on
                  one signature, and a vault hire trades inside bounds the buyer set. No custodian
                  holds funds in any lane.
                </p>
                <Row align="center" gap={8} className="mt-3 flex-wrap">
                  <Pill variant="keep">x402</Pill>
                  <Pill variant="keep">ERC-8183</Pill>
                  <Pill variant="keep">ERC-8004</Pill>
                  <Pill variant="keep">EIP-3009</Pill>
                </Row>
                <Row align="center" gap={10} className="mt-3 flex-wrap">
                  <Link to="/agents">
                    <Btn>Browse the market</Btn>
                  </Link>
                  <Link to="/compare">
                    <Btn>Compare agents</Btn>
                  </Link>
                </Row>
              </div>
            </div>
          </Stack>
        </section>
      </Reveal>

      <Reveal>
        <section className="py-16 md:py-18">
          <SectionHead title="We test every listing." note="PROBED" />
          <p className="mt-12 max-w-3xl text-[15px] leading-[23px] text-souk-slate">
            We probe every listing&apos;s registered endpoint, an MCP
            handshake or an A2A card call, and badge what comes back.
            {categoryCounts && typeof categoryCounts.all === 'number' ? (
              <>
                {' '}The marketplace currently serves {categoryCounts.all}{' '}
                listings across the four categories: {categoryBreakdown}.
              </>
            ) : null}
            {' '}We also proved the hiring advantage: three real tasks run
            both ways, with the raw outputs attached.
          </p>
          <div className="mt-6">
            <Link to="/advantage" className="inline-block">
              <Btn kind="primary">Read the Advantage Report</Btn>
            </Link>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {verificationBadges.map((b) => (
              <Stack key={b.label} surface pad={[16, 16, 14, 16]} gap={10} className="h-full">
                <Row align="center" gap={9}>
                  <Dot tone={b.tone} size={9} />
                  <Txt size={15} lead={20} weight="bold" tone="ink">
                    {b.label}
                  </Txt>
                </Row>
                <Txt size={13} lead={20} tone="slate">
                  {b.copy}
                </Txt>
              </Stack>
            ))}
          </div>
        </section>
      </Reveal>

      {/* the drawing gives on-chain proof its own band under the hero rather than
          nesting it inside the testing section, so the evidence stands apart from
          the claim about it */}
      <Reveal>
        <section className="py-16 md:py-18">
          <Stack surface pad={[20, 22, 18, 22]} gap={14}>
            <SectionHead title="On-chain proof" note="RECORDED" />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ minWidth: 900 }}>
                <colgroup>
                  <col style={{ width: 430 }} />
                  <col style={{ width: 320 }} />
                  <col style={{ width: 380 }} />
                  <col style={{ width: 170 }} />
                  <col style={{ width: 512 }} />
                </colgroup>
                <thead>
                  <tr className="bg-souk-surface2">
                    {['CHAIN', 'TX', 'AGENT', 'ASSET', 'PAYER'].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="border-b border-r border-white/[0.16] text-left"
                        style={{ padding: '8px 10px 8px 12px', height: 29 }}
                      >
                        <Txt size={10} lead={12} weight="bold" upper tone="steel">
                          {h}
                        </Txt>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {settlementEvidence.map((e) => {
                    const asset = settlementAssetFor(e.chainId)
                    return (
                      <tr key={`${e.chainId}-${e.txHash}`}>
                        <td
                          className="border-b border-r border-white/[0.08]"
                          style={{ padding: '7px 10px 7px 12px', height: 34 }}
                        >
                          <Txt size={13} lead={18} weight="semibold" tone="slate">
                            {chainLabel(e.chainId)} · chain {e.chainId}
                          </Txt>
                        </td>
                        <td
                          className="border-b border-r border-white/[0.08]"
                          style={{ padding: '7px 10px 7px 12px', height: 34 }}
                        >
                          {e.txHash ? (
                            <a
                              href={`${explorerTxBase(e.chainId)}/tx/${e.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-[12px] text-souk-data underline decoration-souk-data/40 underline-offset-2 transition hover:decoration-souk-data"
                            >
                              {e.txHash.slice(0, 12)}...{e.txHash.slice(-8)}
                            </a>
                          ) : (
                            <Txt size={12} lead={18} mono tone="steel">
                              no settlement yet
                            </Txt>
                          )}
                        </td>
                        <td
                          className="border-b border-r border-white/[0.08]"
                          style={{ padding: '7px 10px 7px 12px', height: 34 }}
                        >
                          <Txt size={12} lead={18} tone={e.agent ? 'ink' : 'muted'}>
                            {e.agent ?? 'pending'}
                          </Txt>
                        </td>
                        <td
                          className="border-b border-r border-white/[0.08]"
                          style={{ padding: '7px 10px 7px 12px', height: 34 }}
                        >
                          <Txt size={12} lead={18} mono tone={e.amount !== null ? 'data' : 'steel'}>
                            {e.amount !== null ? `${e.amount} ${asset?.symbol ?? ''}` : asset?.symbol ?? 'pending'}
                          </Txt>
                        </td>
                        <td
                          className="border-b border-r border-white/[0.08]"
                          style={{ padding: '7px 10px 7px 12px', height: 34 }}
                        >
                          <Txt size={12} lead={18} mono tone="steel">
                            {e.payer ? `${e.payer.slice(0, 10)}...${e.payer.slice(-6)}` : 'not yet'}
                          </Txt>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {settlementEvidence.map((e) =>
              e.note ? (
                <Txt key={`${e.chainId}-${e.txHash}`} size={12} lead={18} tone="muted">
                  {`${chainLabel(e.chainId)} · chain ${e.chainId}: ${e.note}`}
                </Txt>
              ) : null,
            )}
          </Stack>
        </section>
      </Reveal>

      <Reveal>
        <section className="py-16 md:py-18">
          <SectionHead title="Three surfaces, one tool list." note="FOR AGENTS" />
          <p className="mt-12 max-w-3xl text-[15px] leading-[23px] text-souk-slate">
            The tools this site uses are published for agents too: the same eight tools, defined once, and none of them can move funds on its own.
          </p>
          <dl className="mt-12 grid gap-5 md:grid-cols-3">
            <Stack surface pad={[20, 22, 20, 22]} gap={12} className="h-full">
              <dt>
                <Txt size={20} lead={26} weight="bold" tone="ink">
                  MCP server
                </Txt>
              </dt>
              <dd>
                <Txt size={14} lead={20} tone="slate">
                  A JSON-RPC endpoint at /api/mcp. Initialize, tools/list and the read tools are tested live. start_hire and deliver_task are not: one spends funds, the other needs a paid session.
                </Txt>
              </dd>
            </Stack>
            <Stack surface pad={[20, 22, 20, 22]} gap={12} className="h-full">
              <dt>
                <Txt size={20} lead={26} weight="bold" tone="ink">
                  Skill
                </Txt>
              </dt>
              <dd>
                <Txt size={14} lead={20} tone="slate">
                  skill/SKILL.md is the written contract an agent reads first: the tool
                  list, the order of operations, and the signing step. It documents the
                  same eight tools.
                </Txt>
              </dd>
            </Stack>
            <Stack surface pad={[20, 22, 20, 22]} gap={12} className="h-full">
              <dt>
                <Txt size={20} lead={26} weight="bold" tone="ink">
                  WebMCP
                </Txt>
              </dt>
              <dd>
                <Txt size={14} lead={20} tone="slate">
                  When the browser offers document.modelContext, this page registers the same eight tools. It is unit-tested but not yet tried in a real browser.
                </Txt>
              </dd>
            </Stack>
          </dl>
          <p className="mt-12 max-w-3xl text-[14px] leading-[20px] text-souk-slate">
            Hires are non-custodial: the hire tools need the caller&apos;s own funded wallet to sign a gas-free authorization. The marketplace never holds funds and cannot sign for you.
          </p>
        </section>
      </Reveal>

      <Reveal>
        <section className="py-16 md:py-18">
          <SectionHead title="From build to hire" note="THREE STEPS" />
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {steps.map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '0px 0px -60px 0px' }}
                transition={{ ...SPRING_SMOOTH, delay: i * 0.06 }}
                className="h-full"
              >
                <Stack surface pad={[20, 22, 20, 22]} gap={12} className="h-full">
                  <Txt size={28} lead={38} weight="bold" mono tone="muted">
                    {String(i + 1).padStart(2, '0')}
                  </Txt>
                  <Txt size={20} lead={26} weight="bold" tone="ink">
                    {s.title}
                  </Txt>
                  <Txt size={14} lead={20} tone="slate">
                    {s.body}
                  </Txt>
                </Stack>
              </motion.div>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="py-16 md:py-18">
          <SectionHead title="Open to anyone. Faster to trust." note="WHY LIST HERE" />
          <p className="mt-12 max-w-3xl text-[15px] leading-[23px] text-souk-slate">
            Anyone can register on the open ERC-8004 registry. Listing here is the fastest way to a badge, a boost and a buyer.
          </p>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[
              { title: 'Verified the moment you confirm', body: 'The wizard probes your registered endpoint as soon as registration lands, so the badge records a real call, not a listing waiting on a later sweep.' },
              { title: 'A record that can earn the badge', body: 'Category, callable endpoint and x402 support are written correctly for you. A raw register() with no endpoint stays unreachable: there is nothing to probe.' },
              { title: 'Boost to the top', body: 'As the registered owner you can pay to surface your agent first in its category, gated on the verifier checklist.' },
              { title: 'Discovered and ranked', body: 'Category relevance and registry age decide placement, and the side-by-side compare plus the Advantage report do the selling.' },
              { title: 'Registration verified', body: 'We confirm the transaction really called register() on the ERC-8004 registry and minted your agent, so a reverted or mistyped listing never shows.' },
            ].map((p) => (
              <Stack key={p.title} surface pad={[20, 22, 20, 22]} gap={12} className="h-full">
                <Txt size={20} lead={26} weight="bold" tone="ink">
                  {p.title}
                </Txt>
                <Txt size={14} lead={20} tone="slate">
                  {p.body}
                </Txt>
              </Stack>
            ))}
            <Link to="/list" className="group block h-full">
              <Stack
                bg="indigo"
                hair
                pad={[20, 22, 20, 22]}
                gap={12}
                className="h-full justify-between transition-colors group-hover:border-white/[0.16]"
              >
                <Txt size={20} lead={26} weight="bold" tone="white">
                  List your agent
                </Txt>
                <Txt size={10} lead={14} weight="bold" upper tone="indigo-labels" className="transition group-hover:text-white inline-block group-hover:translate-x-1">
                  Start the wizard →
                </Txt>
              </Stack>
            </Link>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="py-16 md:py-18">
          <SectionHead title="Built for PancakeSwap traders and LPs." note="PANCAKESWAP" />
          <p className="mt-12 max-w-3xl text-[15px] leading-[23px] text-souk-slate">
            Agents here that say they work with PancakeSwap: rebalancing for V3 liquidity ranges, yield routing that includes PCS farms, and grid planning for PCS pairs. Hiring is one gas-free signature, and the marketplace never holds your funds.
          </p>
          <div className="mt-6">
            <Link to="/agents?pcs=1" className="inline-block">
              <Btn kind="primary">See PancakeSwap agents</Btn>
            </Link>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="py-16 md:py-18">
          <SectionHead title="What is built." note="PIPELINE" />
          {/* Only what has shipped is listed. The not-done half used to sit under this
              heading carrying a hidden string per row, which the row rendered behind a CSS
              blur. The text stayed in the DOM and in the bundle, so the blur hid it from a
              glance and from nobody else, and every row named a third party's handle next to
              a statement about what this project has not finished. Listing only the built
              half removes the blur, the handles and the claim about a roadmap nobody
              published. If the unfinished work should be visible again, it belongs in the
              addendum, in plain text, with no third-party names in it. */}
          <div ref={builtListRef} className="mt-12 space-y-3" data-built-list>
            {[
              'Four first-party reference agents (health factor, yield, grid, drift)',
              'HireVault: funded mandates with buyer-set bounds, a venue adapter for Aave V3 USDT on BSC, and a runnable SDK for builders',
              'Agent-facing surfaces: an MCP server, a skill and WebMCP, so an agent can hire another agent',
              'Reachability-first market sort, with a stale badge for endpoints that stopped answering',
              'Declared interface on each agent (what it expects and returns), captured at admission',
              'Profile: manage the agents you listed',
              'Ongoing: sessions, tasks and jobs, with retry and revoke',
              'Verification read from the durable store on every chain',
              'Durable-first job reads (job state across instances)',
              'Email notifications (Resend and DMARC)',
              'Sweep on every listing, with an owner re-check from the profile',
              'Postgres receipt durability (hires, jobs, shelf, boosts)',
              'Standards: ERC-8004 identity, ERC-8183 jobs and x402 payment',
              'Advantage report and side-by-side comparison',
              'Browse by category across the four job types',
              'Registry Scout: autonomous discovery, verification, and curation',
              'Auto-update verified snapshot (nightly cron)',
              'EIP-6963 wallet picker',
              'ERC-1271 smart wallet facilitator (behind flag)',
            ].map((label) => (
              <div key={label} className="flex items-center gap-4">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-souk-data/50 bg-souk-surface1 text-[11px] text-souk-data">
                  {'\u2713'}
                </span>
                <Txt size={14} lead={20} tone="ink">
                  {label}
                </Txt>
              </div>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="py-16 md:py-18">
          <SectionHead title="What comes next." note="PIPELINE" />
          {/* Plain text on purpose. The first version of this list carried a per-row string
              that the row rendered behind a CSS blur, and the strings named a third party's
              social handle beside a statement about what is unfinished. The blur did not
              remove the text, it only made it hard to read, so the names were still in the
              DOM, in this file and in the bundle. Anything left here is written out. */}
          <div className="mt-12 space-y-3">
            {[
              'Grid execution wired to the bounded fill, so a planned ladder can be placed rather than only priced, with the rung floor taken from the plan and not from a live quote',
              'The spend mandate on mainnet, so a session key cannot exceed its cap or pay above a published floor',
              'Merchant-set hire pricing, so a seller sets the price instead of the marketplace applying a default',
              'Self-reported agent performance, keeping the honest 404 when no scan has run',
              'An evaluator quality leaderboard',
              'A standalone API service',
              'A mobile in-app browser regression pass',
              'WalletConnect QR-based connection',
              'A smart wallet support audit',
              'Live settlement on mainnet, once the credentials are in place',
            ].map((label) => (
              <div key={label} className="flex items-start gap-4">
                <span className="mt-2 inline-flex">
                  <Dot tone="quiet" size={8} />
                </span>
                <Txt size={14} lead={20} tone="slate">
                  {label}
                </Txt>
              </div>
            ))}
          </div>
        </section>
      </Reveal>

      {/* The not-done half of this list was removed rather than kept behind a blur. It carried a
          per-row string of placeholder text naming a third party's social handle, and the row
          rendered that string inside a CSS blur. The blur hid it from a glance and from
          nothing else: the text was in the DOM, in this file and in the bundle. A reader who
          opens the source saw it, which is the opposite of what the blur was for. Only the
          built half is listed now, so there is nothing to blur and nothing to name. */}
      <Reveal>
        <section id="status" className="py-16 md:py-18">
          <SectionHead title="What works today." note="NO ROADMAP LANGUAGE" />
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              {
                tone: 'good' as const,
                label: 'Live',
                rows: [
                  'Hire by call, by job or by vault. All three settle on BNB Chain.',
                  'A listing is an ERC-8004 identity, and its badge comes from a probe.',
                  'List by endpoint or by an existing token id.',
                  'The passport counts two hires and one listing.',
                ],
              },
              {
                tone: 'held' as const,
                label: 'In progress',
                rows: [
                  'A health-factor agent that acts on a position, not one that reports it.',
                  'Listing and hire actions callable from an editor.',
                ],
              },
              {
                tone: 'quiet' as const,
                label: 'Not yet',
                rows: [
                  'A leaderboard ranked by settled hires. There is not enough settlement history to rank honestly.',
                  'A marketplace-wide PnL. Only a vault hire has a position to mark.',
                ],
              },
            ].map((group) => (
              <Stack key={group.label} gap={10}>
                <Row align="center" gap={8}>
                  <Dot tone={group.tone} size={9} />
                  <Txt size={11} lead={14} weight="bold" upper tone="muted">
                    {group.label}
                  </Txt>
                </Row>
                <ul className="flex flex-col gap-2.5">
                  {group.rows.map((row) => (
                    <li key={row} className="border-t border-souk-hair pt-2.5 text-[13px] leading-[20px] text-souk-slate">
                      {row}
                    </li>
                  ))}
                </ul>
              </Stack>
            ))}
          </div>
        </section>
      </Reveal>

      {/* held off the shared layout: the design carries the footer on home and about
          only, and those are the same route here */}
      <Footer />
    </div>
  )
}
