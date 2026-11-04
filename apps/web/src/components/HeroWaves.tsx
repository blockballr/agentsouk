// a living backdrop for the home hero: four drifting wave layers under the
// headline, in the brand tints rather than a glow, so the market reads as
// moving stock rather than a static poster. css keyframes live in theme.css
const LAYERS = [
  { y: 0, name: 'hero-wave-1' },
  { y: 3, name: 'hero-wave-2' },
  { y: 5, name: 'hero-wave-3' },
  { y: 7, name: 'hero-wave-4' },
]

export function HeroWaves() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[44vh] max-h-[460px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_25%,transparent)]"
    >
      <svg className="h-full w-full" viewBox="0 24 150 28" preserveAspectRatio="none">
        <defs>
          <path id="hero-wave-path" d="M-160 44c30 0 58-18 88-18s 58 18 88 18 58-18 88-18 58 18 88 18 v44h-352z" />
        </defs>
        {LAYERS.map((layer) => (
          <use key={layer.name} href="#hero-wave-path" x="48" y={layer.y} className={`hero-wave-layer ${layer.name}`} />
        ))}
      </svg>
    </div>
  )
}
