import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import '../vault-art.css'

// One scene per vault category. Colours come from the token set so the drawing
// follows the register, and the motion is GSAP so it can be tuned per scene.

type SceneName = 'yield' | 'grid-trading' | 'rebalancing' | 'health-factor' | string

function YieldScene() {
  return (
    <>
      <line x1="18" y1="146" x2="242" y2="146" className="stroke" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="46" cy="126" r="2.5" className="stroke" fill="none" opacity=".25" />
      <circle cx="216" cy="54" r="2.5" className="stroke" fill="none" opacity=".25" />
      <g className="grow">
        <path d="M130 66V40" className="stroke" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <path d="M130 46c-4-12-15-14-22-11 1 9 10 15 22 11z" className="p-warm stroke" strokeWidth="2" />
        <path d="M130 46c4-12 15-14 22-11-1 9-10 15-22 11z" className="p-cool stroke" strokeWidth="2" />
      </g>
      <g className="bob">
        <circle cx="130" cy="84" r="18" className="p-cool stroke" strokeWidth="2.5" />
        <g className="blink">
          <circle cx="124" cy="81" r="2.3" className="eye" />
          <circle cx="137" cy="81" r="2.3" className="eye" />
        </g>
        <path d="M124 89c3 3 9 3 12 0" className="face-line" strokeWidth="2" strokeLinecap="round" fill="none" />
      </g>
      <path d="M104 110h52l-7 36h-38l-7-36z" className="p-warm stroke" strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="96" y="100" width="68" height="12" rx="3" className="p-soft stroke" strokeWidth="2.5" />
      <ellipse cx="130" cy="106" rx="26" ry="4" className="stroke" fill="none" opacity=".12" />
      <g className="tilt">
        <rect x="178" y="44" width="30" height="24" rx="5" className="p-cool stroke" strokeWidth="2.5" />
        <path d="M178 54l-14 8 2 7" className="stroke" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M166 68l-4 2" className="stroke" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M208 48c7 3 10 9 9 15" className="stroke" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      </g>
      <ellipse className="drop p-cool stroke" cx="160" cy="74" rx="3.2" ry="5.5" strokeWidth="1.8" />
      <ellipse className="drop d2 p-cool stroke" cx="150" cy="80" rx="3.2" ry="5.5" strokeWidth="1.8" />
      <ellipse className="drop d3 p-cool stroke" cx="168" cy="84" rx="3.2" ry="5.5" strokeWidth="1.8" />
    </>
  )
}

function GridScene() {
  return (
    <>
      <line x1="18" y1="146" x2="242" y2="146" className="stroke" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="228" cy="44" r="2.5" className="stroke" fill="none" opacity=".25" />
      <path d="M70 146V52M190 146V52" className="stroke" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M70 76h120M70 104h120M70 132h120" className="stroke" strokeWidth="2" fill="none" opacity=".4" />
      <path d="M70 146h120" className="stroke" strokeWidth="2.5" fill="none" />
      <path d="M96 132c-8-14-8-30 0-44" className="stroke" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" fill="none" />
      <g className="hop">
        <circle cx="112" cy="120" r="13" className="p-warm stroke" strokeWidth="2.5" />
        <circle cx="107" cy="118" r="1.8" className="eye" />
        <circle cx="117" cy="118" r="1.8" className="eye" />
        <path d="M107 124c2 2 6 2 8 0" className="face-line" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </g>
      <circle cx="158" cy="76" r="8" className="p-cool stroke ceiling" strokeWidth="2.5" opacity=".85" />
      <path d="M214 62l6-6M220 56l-1 7M220 56l-7 1" className="stroke" strokeWidth="2" strokeLinecap="round" fill="none" />
    </>
  )
}

function RebalanceScene() {
  return (
    <>
      <line x1="18" y1="146" x2="242" y2="146" className="stroke" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="48" cy="56" r="2.5" className="stroke" fill="none" opacity=".25" />
      <path d="M130 146l-18-34h36l-18 34z" className="p-soft stroke" strokeWidth="2.5" strokeLinejoin="round" />
      <g className="rock">
        <rect x="62" y="86" width="136" height="7" rx="3.5" className="p-warm stroke" strokeWidth="2.5" />
        <circle cx="78" cy="71" r="15" className="p-cool stroke" strokeWidth="2.5" />
        <circle cx="73" cy="69" r="1.9" className="eye" />
        <circle cx="83" cy="69" r="1.9" className="eye" />
        <path d="M73 75c3 2 7 2 10 0" className="face-line" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <circle cx="182" cy="75" r="11" className="p-cool stroke" strokeWidth="2.5" opacity=".85" />
      </g>
      <path d="M96 120c14 5 54 5 68 0" className="stroke" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" fill="none" />
      <path d="M130 40v14M123 47h14" className="stroke spark" strokeWidth="2" strokeLinecap="round" fill="none" />
    </>
  )
}

function HealthScene() {
  return (
    <>
      <line x1="18" y1="146" x2="242" y2="146" className="stroke" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="216" cy="50" r="2.5" className="stroke" fill="none" opacity=".25" />
      <g className="sway">
        <path d="M84 82c0-24 20-40 46-40s46 16 46 40" className="p-cool stroke" strokeWidth="2.5" />
        <path d="M130 42V28" className="stroke" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <g className="pulse">
          <path d="M130 66l11 7v10c0 8-7 12-11 14-4-2-11-6-11-14V73l11-7z" className="p-paper stroke" strokeWidth="2" />
          <path d="M125 80l3 4 7-8" className="stroke" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </g>
      </g>
      <path d="M130 82v34" className="stroke" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <g className="bob-slow">
        <rect x="102" y="116" width="56" height="9" rx="2.5" className="p-warm stroke" strokeWidth="2.5" />
        <rect x="108" y="106" width="44" height="9" rx="2.5" className="p-soft stroke" strokeWidth="2.5" />
      </g>
      <g className="bob">
        <circle cx="158" cy="112" r="9" className="p-cool stroke" strokeWidth="2.5" />
        <circle cx="155" cy="111" r="1.4" className="eye" />
        <circle cx="161" cy="111" r="1.4" className="eye" />
        <path d="M155 115c2 1.5 4 1.5 6 0" className="face-line" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </g>
      <ellipse className="rain p-cool stroke" cx="76" cy="96" rx="2.6" ry="5" strokeWidth="1.6" />
      <ellipse className="rain r2 p-cool stroke" cx="96" cy="88" rx="2.6" ry="5" strokeWidth="1.6" />
      <ellipse className="rain r3 p-cool stroke" cx="164" cy="88" rx="2.6" ry="5" strokeWidth="1.6" />
      <ellipse className="rain r4 p-cool stroke" cx="184" cy="96" rx="2.6" ry="5" strokeWidth="1.6" />
    </>
  )
}

function sceneFor(category: SceneName) {
  if (category === 'yield') return <YieldScene />
  if (category === 'grid-trading') return <GridScene />
  if (category === 'rebalancing') return <RebalanceScene />
  if (category === 'health-factor') return <HealthScene />
  return null
}

export function VaultArt({ category, size }: { category: SceneName; size?: 'sm' | 'md' }) {
  const ref = useRef<SVGSVGElement>(null)
  const scene = sceneFor(category)

  useEffect(() => {
    const svg = ref.current
    if (!svg || !scene) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(svg)
      const respawn = (items: Element[], distance: number, step: number, gap: number) => {
        items.forEach((drop, index) => {
          gsap
            .timeline({ repeat: -1, delay: index * step })
            .set(drop, { y: 0, opacity: 0 })
            .to(drop, { opacity: 1, duration: 0.18 })
            .to(drop, { y: distance, duration: 1.3, ease: 'none' }, 0)
            .to(drop, { opacity: 0, duration: 0.3 }, gap)
        })
      }

      if (category === 'yield') {
        gsap.to(q('.bob'), { y: -5, duration: 1.3, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        gsap.fromTo(
          q('.grow'),
          { scaleY: 0.55 },
          { scaleY: 1, duration: 1.5, ease: 'power2.out', svgOrigin: '130 66', repeat: -1, repeatDelay: 1.2 },
        )
        gsap
          .timeline({ repeat: -1, repeatDelay: 1.6 })
          .to(q('.tilt'), { rotation: -16, duration: 1.1, ease: 'sine.inOut', svgOrigin: '198 52' })
          .to(q('.tilt'), { rotation: 0, duration: 1.3, ease: 'sine.inOut' })
        gsap
          .timeline({ repeat: -1, repeatDelay: 2.6 })
          .to(q('.blink'), { scaleY: 0.1, duration: 0.08, svgOrigin: '130 84' })
          .to(q('.blink'), { scaleY: 1, duration: 0.08 })
        respawn(q('.drop'), 32, 0.5, 1.15)
      }

      if (category === 'grid-trading') {
        gsap
          .timeline({ repeat: -1, repeatDelay: 0.7 })
          .to(q('.hop'), { y: -28, duration: 0.32, ease: 'power2.out' })
          .to(q('.hop'), { y: -28, duration: 0.4 })
          .to(q('.hop'), { y: -56, duration: 0.32, ease: 'power2.out' })
          .to(q('.hop'), { y: -56, duration: 0.5 })
          .to(q('.hop'), { y: 0, duration: 0.5, ease: 'bounce.out' })
        gsap.to(q('.ceiling'), { scale: 1.15, opacity: 0.5, duration: 1.2, ease: 'sine.inOut', yoyo: true, repeat: -1, svgOrigin: '158 76' })
      }

      if (category === 'rebalancing') {
        gsap
          .timeline({ repeat: -1 })
          .fromTo(q('.rock'), { rotation: -9, svgOrigin: '130 92' }, { rotation: 4, duration: 1.3, ease: 'sine.inOut' })
          .to(q('.rock'), { rotation: -2, duration: 0.7, ease: 'sine.inOut' })
          .to(q('.rock'), { rotation: 0, duration: 0.6, ease: 'sine.inOut' })
          .to(q('.rock'), { rotation: -9, duration: 1.1, ease: 'sine.inOut' })
        gsap.to(q('.spark'), { opacity: 0.35, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: -1 })
      }

      if (category === 'health-factor') {
        gsap.to(q('.sway'), { rotation: 2.5, duration: 2.1, ease: 'sine.inOut', yoyo: true, repeat: -1, svgOrigin: '130 66' })
        gsap.to(q('.pulse'), { scale: 1.07, duration: 1.2, ease: 'sine.inOut', yoyo: true, repeat: -1, svgOrigin: '130 74' })
        gsap.to(q('.bob'), { y: -5, duration: 1.4, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        gsap.to(q('.bob-slow'), { y: -3, duration: 2.4, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        respawn(q('.rain'), 44, 0.3, 1.05)
      }
    }, svg)

    return () => ctx.revert()
  }, [category])

  if (!scene) return null
  return (
    <svg ref={ref} className={size === 'sm' ? 'vault-art sm' : 'vault-art'} viewBox="0 0 260 170" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      {scene}
    </svg>
  )
}
