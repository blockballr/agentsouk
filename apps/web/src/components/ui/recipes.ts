// the site's shared class recipes: every button and card is one of these, so a page changes
// its look only when a recipe changes, never element by element

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export type ButtonVariant = 'primary' | 'secondary' | 'quiet'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

const BUTTON_BASE =
  'micro inline-flex min-h-10 items-center justify-center gap-2 rounded-[5px] text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-press-black disabled:cursor-not-allowed disabled:opacity-60'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-highlighter-green text-on-highlighter hover:brightness-95',
  secondary: 'border hairline border-slate-verdant/50 text-press-black hover:border-press-black',
  quiet: 'text-newsprint-gray underline decoration-newsprint-gray/40 underline-offset-4 hover:text-press-black',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-2',
  md: 'px-4 py-3',
  lg: 'px-6 py-3',
  xl: 'px-6 py-4',
}

// the filled button carries a shadow that grows with it; outlined and quiet ones sit flat
const PRIMARY_SHADOW: Record<ButtonSize, string> = { sm: 'shadow-sm', md: 'shadow', lg: 'shadow-lg', xl: 'shadow-lg' }

export function button(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], variant === 'primary' && PRIMARY_SHADOW[size])
}

export type CardTone = 'plain' | 'strong' | 'accent'
export type CardPad = 'none' | 'sm' | 'md' | 'lg' | 'xl'

const CARD_TONE: Record<CardTone, string> = {
  plain: 'border-slate-verdant/40',
  strong: 'border-press-black/35',
  accent: 'border-highlighter-green/60 bg-highlighter-green/[0.07]',
}

const CARD_PAD: Record<CardPad, string> = {
  none: '',
  sm: 'p-5',
  md: 'p-6 sm:p-8',
  lg: 'p-8',
  xl: 'p-8 sm:p-10',
}

export function card(tone: CardTone = 'plain', pad: CardPad = 'lg'): string {
  return cx('rounded-[14px] border hairline', CARD_TONE[tone], CARD_PAD[pad])
}

// the small uppercase label that heads every panel and slot
export const LABEL = 'micro text-newsprint-gray'
