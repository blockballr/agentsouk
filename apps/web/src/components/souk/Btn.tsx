// The design's button: 44 tall, radius 8, twenty of side padding, and four kinds.
//
// primary is the one action on a card, and it is the data colour, not a brand green.
// keep is a held commitment, the same colour at 40%. off is the resting hairline. warn
// is the destructive one, in the attention colour the design keeps for exactly this,
// the same peach the disconnect row wears. A screen carries at most one primary, which
// is what keeps the hierarchy readable.

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Txt } from './Txt';
import type { Tone } from './tokens';

export type BtnKind = 'primary' | 'keep' | 'off' | 'warn';

const FILL: Record<BtnKind, string> = {
  primary: 'bg-souk-data',
  keep: 'bg-souk-data/40',
  off: 'bg-souk-surface1',
  warn: 'bg-souk-surface1',
};

const RIM: Record<BtnKind, string> = {
  primary: 'border-transparent',
  keep: 'border-transparent',
  off: 'border-souk-hair',
  warn: 'border-souk-peach/40',
};

const TEXT: Record<BtnKind, Tone> = {
  primary: 'canvas',
  keep: 'ink',
  off: 'slate',
  warn: 'peach',
};

export function Btn({
  kind = 'off',
  children,
  disabled,
  className,
  style,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind }) {
  return (
    <button
      type="button"
      disabled={disabled}
      {...rest}
      className={[
        'inline-flex h-11 shrink-0 items-center justify-center rounded-[8px] border',
        FILL[kind],
        RIM[kind],
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        className ?? '',
      ].join(' ')}
      style={{ paddingLeft: 20, paddingRight: 20, ...style }}
    >
      <Txt size={14} lead={20} weight="semibold" tone={TEXT[kind]}>
        {children}
      </Txt>
    </button>
  );
}

// the 38 square icon button in the top bar, and the profile chip beside it
export function IconBtn({
  label,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...rest}
      className="inline-flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-souk-hair"
    >
      {children}
    </button>
  );
}

export function ProfileChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[38px] items-center rounded-[8px] border border-souk-hair pl-2.5 pr-3.5">
      {children}
    </span>
  );
}
