// The two markers the design uses to carry state without a sentence: the pill, which
// tags a listing, and the dot, which sits beside a verdict.
//
// keep is the marked chip: the data colour earned, not spent on decoration. warn is the
// same squared chip in peach, reserved for the states that cost a lister something. off
// is the resting hairline. A pill is never made keep for emphasis; peach and green are
// the only two statuses worth a border.

import type { ReactNode } from 'react';
import { Txt, type TxtProps } from './Txt';
import type { Tone } from './tokens';

export type PillVariant = 'keep' | 'warn' | 'off';

const PILL: Record<PillVariant, { box: string; text: Tone }> = {
  keep: { box: 'border-souk-data/40 bg-souk-surface1', text: 'data' },
  warn: { box: 'border-souk-peach/45 bg-souk-surface1', text: 'peach' },
  off: { box: 'border-souk-hair bg-souk-surface1', text: 'steel' },
};

export function Pill({
  variant = 'off',
  children,
}: {
  variant?: PillVariant;
  children: ReactNode;
}) {
  const { box, text } = PILL[variant];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[6px] border ${box}`}
      style={{ padding: '4px 11px' }}
    >
      <Txt size={11} lead={16} weight="extrabold" upper tone={text}>
        {children}
      </Txt>
    </span>
  );
}

// the design's five dot tones. each is its own colour rather than a faded version
// of another, so a verdict reads at a glance instead of by opacity
export type DotTone = 'good' | 'held' | 'sky' | 'peach' | 'bad' | 'quiet';

const DOT: Record<DotTone, string> = {
  good: 'bg-souk-data',
  held: 'bg-souk-peach',
  sky: 'bg-souk-sky',
  peach: 'bg-souk-peach',
  bad: 'border-souk-steel',
  quiet: 'border-souk-steel/50',
};

export function Dot({ tone = 'good', size = 8 }: { tone?: DotTone; size?: number }) {
  const outline = tone === 'bad' || tone === 'quiet';
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${outline ? 'border' : ''} ${DOT[tone]}`}
      style={{ width: size, height: size, borderWidth: outline ? 1 : undefined }}
    />
  );
}

// the paper-thin rule: one pixel of the 16% rim, drawn at whatever width it is handed
export function Rule({ width = '100%', hair }: { width?: number | string; hair?: boolean }) {
  const style: { width: number | string; height?: number } = { width };
  if (typeof width === 'number') style.height = 1;
  return (
    <div
      className={hair ? 'border-t border-souk-hair' : 'border-t border-souk-edge'}
      style={style}
    />
  );
}

// a label above a value: the design's habit of naming a column in upper case steel
export function Label({
  children,
  tone = 'muted',
  weight = 'bold',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  weight?: TxtProps['weight'];
  className?: string;
}) {
  return (
    <Txt size={10} lead={14} weight={weight} upper tone={tone} className={className}>
      {children}
    </Txt>
  );
}
