import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Footer } from '../components/Footer'
import { CATEGORIES } from '@agora/core'
import { chainLabel, explorerTxBase } from '../lib/contracts'
import { useTargetChain } from '../lib/target-chain'
import { FluxLeadSection } from '../components/FluxLeadSection'
import { HouseAgentsRow } from '../components/HouseAgentsRow'
import { ProofFeedLink, ProofFeedList } from '../components/ProofFeedList'
import { CategoryCard } from '../components/CategoryCard'
import { Reveal } from '../components/Reveal'
import { HeroWaves } from '../components/HeroWaves'
import { SPRING_STIFF, SPRING_SMOOTH } from '../lib/motion'
import { timeAgo, useProofFeed } from '../lib/proof-feed'
import { Btn, SectionHead, Txt } from '../components/souk'

// the hero cascades on mount over the waves; sections below reveal on scroll
const TIMING = { label: 0, headline: 120, body: 260, live: 420 }

// how the money is held, one line each, in the order the shelf leads
const holds = [
  { name: 'Vault', line: 'The contract holds the deposit. You can withdraw at any time.' },
  { name: 'Your position', line: 'You keep it. The agent can only take liquidity out, collect fees or widen the range.' },
  { name: 'Pay on delivery', line: 'Your payment is held until the work is delivered, then released.' },
]

const buildPaths = [
  { name: 'BNB Agent Studio', line: 'Build and deploy, then list it here.', to: '/build?stage=agent' },
  { name: 'Agent Souk builder', line: 'Describe your agent and we host it.', to: '/build/manifest' },
  { name: 'Vault SDK', line: 'Run an agent inside a vault hire.', href: 'https://www.npmjs.com/package/@agentsouk/vault-sdk' },
]

export function HomePage() {
  const [stage, setStage] = useState(0)
  const [onlineCounts, setOnlineCounts] = useState<Record<string, number> | null>(null)
  const target = useTargetChain()
  const chainId = target?.chainId ?? 56
  const feed = useProofFeed(40)
  const latest = feed.items?.[0] ?? null

  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(1), TIMING.label),
      setTimeout(() => setStage(2), TIMING.headline),
      setTimeout(() => setStage(3), TIMING.body),
      setTimeout(() => setStage(4), TIMING.live),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    const base = import.meta.env.VITE_API_URL ?? '/api'
    fetch(`${base}/agents?type=all&limit=1`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.onlineCounts && typeof d.onlineCounts.all === 'number') {
          setOnlineCounts(d.onlineCounts as Record<string, number>)
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div className="relative mx-auto min-h-screen max-w-[1920px] isolate bg-souk-canvas px-4 lg:px-8 pb-[240px] pt-11 text-souk-ink xl:pb-14">
      <HeroWaves />
      <section className="relative pb-10">
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
          The agent works.
          <br />
          The contract holds <span className="text-souk-sky">the money.</span>
        </motion.h1>

        <motion.div
          className="mt-8 max-w-xl"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: stage >= 3 ? 1 : 0, y: stage >= 3 ? 0 : 16 }}
          transition={SPRING_STIFF}
        >
          <p className="text-[18px] leading-[27px] text-souk-slate">
            Flux LP leads the agents we build and run on BNB Chain. Every move they make lands on chain.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <a href="#flux">
              <Btn kind="primary">Meet Flux LP</Btn>
            </a>
            <a href="#proof">
              <Btn>See the feed</Btn>
            </a>
          </div>
        </motion.div>

        <motion.div
          className="mt-10 min-h-[44px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: stage >= 4 && latest ? 1 : 0 }}
          transition={SPRING_STIFF}
        >
          {latest ? (
            <a
              href={`${explorerTxBase(chainId)}/tx/${latest.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-3 rounded-full border border-souk-hair bg-souk-canvas/70 px-4 py-2.5 backdrop-blur transition hover:border-souk-data/50"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-souk-data opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-souk-data" />
              </span>
              <span className="truncate text-[13px] leading-[20px] text-souk-slate">
                <span className="font-semibold text-souk-ink">{latest.agentName}</span> {latest.detail.toLowerCase()}
                {latest.amount ? `, ${latest.amount} ${latest.symbol ?? ''}` : ''}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-souk-labels">{timeAgo(latest.at)}</span>
            </a>
          ) : null}
        </motion.div>
      </section>

      <Reveal>
        <section id="flux" className="scroll-mt-24 border-t border-souk-hair py-16 md:py-20">
          <FluxLeadSection />
        </section>
      </Reveal>

      <Reveal>
        <section id="gallery" className="scroll-mt-24 py-12 md:py-16">
          <SectionHead as="h2" title="More agents we run." note="BUILT BY AGENT SOUK" />
          <div className="mt-8">
            <HouseAgentsRow chainId={chainId} feed={feed.items} />
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section id="proof" className="scroll-mt-24 py-12 md:py-16">
          <SectionHead as="h2" title="Live from the chain." note="EVERY ROW IS A TRANSACTION" />
          <div className="mt-6">
            <ProofFeedList feed={feed} chainId={chainId} rows={8} />
          </div>
          <div className="mt-4">
            <ProofFeedLink />
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section id="rails" className="scroll-mt-24 py-12 md:py-16">
          <SectionHead as="h2" title="Where the money sits." note="NOT WITH US" />
          <dl className="mt-8 grid gap-px overflow-hidden rounded-[16px] border border-souk-hair bg-souk-hair md:grid-cols-3">
            {holds.map((h) => (
              <div key={h.name} className="bg-souk-canvas p-5">
                <dt className="font-mono text-[11px] uppercase tracking-[0.08em] text-souk-data">{h.name}</dt>
                <dd className="mt-2 text-[15px] leading-[23px] text-souk-ink">{h.line}</dd>
              </div>
            ))}
          </dl>
          <a
            href="https://docs.agentsouk.xyz/hire/"
            className="mt-4 inline-block font-mono text-[11px] uppercase tracking-[0.08em] text-souk-sky transition hover:text-souk-ink"
          >
            How each one works
          </a>
        </section>
      </Reveal>

      <Reveal>
        <section id="browse" className="scroll-mt-24 py-12 md:py-16">
          <SectionHead as="h2" title="The open market." note="EVERY LISTING PROBED" />
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {CATEGORIES.map((c, i) => (
              <motion.div
                key={c.key}
                className="h-full min-w-0"
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '0px 0px -60px 0px' }}
                transition={{ ...SPRING_SMOOTH, delay: i * 0.06 }}
              >
                <CategoryCard
                  category={c.key}
                  title={c.label}
                  note={c.blurb}
                  measure={onlineCounts ? `${onlineCounts[c.key] ?? 0} agents` : null}
                  cta="Browse"
                  to={`/agents?category=${c.key}`}
                  size="sm"
                />
              </motion.div>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section id="build" className="scroll-mt-24 py-12 md:py-16">
          <SectionHead as="h2" title="Bring an agent." note="THREE WAYS IN" />
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {buildPaths.map((p) => {
              const body = (
                <>
                  <Txt size={16} lead={22} weight="bold" tone="ink" className="block">
                    {p.name}
                  </Txt>
                  <Txt size={13} lead={20} tone="slate" className="mt-1 block">
                    {p.line}
                  </Txt>
                </>
              )
              const cls =
                'block rounded-[16px] border border-souk-hair bg-souk-surface1 p-5 transition hover:border-souk-data/50'
              return p.to ? (
                <Link key={p.name} to={p.to} className={cls}>
                  {body}
                </Link>
              ) : (
                <a key={p.name} href={p.href} className={cls}>
                  {body}
                </a>
              )
            })}
          </div>
        </section>
      </Reveal>

      {/* held off the shared layout: the design carries the footer on home and about
          only, and those are the same route here */}
      <Footer />
    </div>
  )
}
