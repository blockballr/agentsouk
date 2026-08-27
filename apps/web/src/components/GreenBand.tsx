// the closing signature: full-bleed green band below the footer
// slim enough to read as a sign-off, not a second page
export function GreenBand({ letter = 'A' }: { letter?: string }) {
  return (
    <section aria-hidden="true" className="w-full bg-highlighter-green">
      <div className="flex items-end px-6 py-10 md:h-[180px]">
        <span className="text-[64px] font-bold leading-none tracking-[-0.04em] text-bone-white md:text-[96px]">
          {letter}
        </span>
      </div>
    </section>
  )
}