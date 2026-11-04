// a living backdrop for the home hero: four drifting layered bands under the
// headline, in the brand tints, so the market reads as moving stock rather
// than a static poster. css keyframes live in theme.css
const LAYERS = [
  { y: 0, name: 'hero-wave-1' },
  { y: 3, name: 'hero-wave-2' },
  { y: 6, name: 'hero-wave-3' },
  { y: 8, name: 'hero-wave-4' },
]

export function HeroWaves() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[44vh] max-h-[460px] w-screen -translate-x-1/2 overflow-hidden [mask-image:linear-gradient(to_bottom,black_25%,transparent)]"
    >
      <svg className="h-full w-full" viewBox="0 24 150 28" preserveAspectRatio="none">
        <defs>
          <path id="souk-tide" d="M-170 44c30 0 60-16 90-16s 60 16 90 16 60-16 90-16 60 16 90 16 v44h-358z" />
        </defs>
        {LAYERS.map((layer) => (
          <use key={layer.name} href="#souk-tide" x="48" y={layer.y} className={`hero-wave-layer ${layer.name}`} />
        ))}
      </svg>
    </div>
  )
}
