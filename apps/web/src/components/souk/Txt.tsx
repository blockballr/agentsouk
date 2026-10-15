// The design's txt: one place where a string gets its size, leading, weight, tone and
// whether it is mono or upper case. The screens name a tone and a weight rather than
// remembering that a data figure is JetBrains Mono at twelve.
//
// Sizes and leadings are enumerated as literal class strings. The design's scale is
// small and closed, and a class assembled from a variable never reaches the scanner, so
// a size the map has not earned falls back to style rather than disappearing.

import type { ReactNode, CSSProperties } from 'react';
import { type Tone, TONE } from './tokens';

export type Weight = 'regular' | 'bold' | 'semibold' | 'extrabold';

const WEIGHT: Record<Weight, string> = {
  regular: 'font-normal',
  bold: 'font-bold',
  semibold: 'font-semibold',
  extrabold: 'font-extrabold',
};

const SIZE: Record<number, string> = {
  10: 'text-[10px]',
  11: 'text-[11px]',
  12: 'text-[12px]',
  13: 'text-[13px]',
  14: 'text-[14px]',
  18: 'text-[18px]',
  20: 'text-[20px]',
  22: 'text-[22px]',
  26: 'text-[26px]',
  28: 'text-[28px]',
  30: 'text-[30px]',
};

const LEAD: Record<number, string> = {
  12: 'leading-[12px]',
  14: 'leading-[14px]',
  15: 'leading-[15px]',
  16: 'leading-[16px]',
  17: 'leading-[17px]',
  18: 'leading-[18px]',
  20: 'leading-[20px]',
  26: 'leading-[26px]',
  27: 'leading-[27px]',
  38: 'leading-[38px]',
};

export interface TxtProps {
  children: ReactNode;
  size?: number;
  lead?: number;
  tone?: Tone;
  weight?: Weight;
  // the design's data face
  mono?: boolean;
  // the identity face: the serif display the port carried back for headlines alone
  display?: boolean;
  upper?: boolean;
  className?: string;
}

export function Txt({
  children,
  size = 13,
  lead,
  tone = 'ink',
  weight = 'regular',
  mono,
  display,
  upper,
  className,
}: TxtProps) {
  const style: CSSProperties = {};
  const classes: string[] = [TONE[tone], WEIGHT[weight]];
  if (SIZE[size]) classes.push(SIZE[size]);
  else style.fontSize = size;
  if (lead !== undefined) {
    if (LEAD[lead]) classes.push(LEAD[lead]);
    else style.lineHeight = `${lead}px`;
  }
  if (mono) classes.push('font-mono');
  if (display) classes.push('font-serif');
  if (upper) classes.push('uppercase');
  if (className) classes.push(className);
  return (
    <span className={classes.join(' ')} style={style}>
      {children}
    </span>
  );
}
