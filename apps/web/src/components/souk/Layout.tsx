// The design's two frames. vf is a vertical stack, hf is a horizontal one, and both
// carry the same geometry vocabulary: gap, pad, radius and either the card surface or a
// hairline. Every ported screen composes these rather than restating a flex container.
//
// Numeric layout goes in style, not class: a class built by string interpolation is
// invisible to tailwind's scanner, so gap-[20px] would silently vanish from the bundle.
// Colours and borders stay in classes, where the scanner can see them.

import type { ReactNode, CSSProperties } from 'react';
import { EDGE, HAIR, type Pad, padStyle } from './tokens';

export type BgName = 'surface1' | 'surface2' | 'canvas' | 'indigo';

export const BG: Record<BgName, string> = {
  surface1: 'bg-souk-surface1',
  surface2: 'bg-souk-surface2',
  canvas: 'bg-souk-canvas',
  indigo: 'bg-souk-indigo',
};

export type Justify = 'start' | 'center' | 'between' | 'end';
export type Align = 'start' | 'center' | 'end' | 'baseline' | 'stretch';

const JUSTIFY: Record<Justify, string> = {
  start: 'justify-start',
  center: 'justify-center',
  between: 'justify-between',
  end: 'justify-end',
};

const ALIGN: Record<Align, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  baseline: 'items-baseline',
  stretch: 'items-stretch',
};

export interface BoxProps {
  gap?: number;
  pad?: Pad;
  radius?: number;
  // a gradient or anything else a utility cannot name, merged under the geometry
  style?: CSSProperties;
  // the card finish: surface one, its own rim, clipped at the surface radius
  surface?: boolean;
  // the 16% rule, drawn on whichever sides the design asks for
  hair?: boolean;
  bg?: BgName;
  className?: string;
  children?: ReactNode;
}

// one border colour is ever set, so the two never fight each other in the stylesheet
function frameClass(props: BoxProps): string {
  const { surface, hair, bg, className } = props;
  const parts: string[] = [];
  if (surface) {
    parts.push('border', 'bg-souk-surface1', EDGE, 'overflow-hidden', 'rounded-[20px]');
  } else {
    if (bg) parts.push(BG[bg]);
    parts.push('border', hair ? HAIR : 'border-transparent');
  }
  if (className) parts.push(className);
  return parts.join(' ');
}

function frameStyle(props: BoxProps): CSSProperties {
  const style: CSSProperties = { ...(props.style ?? {}) };
  if (props.gap !== undefined) style.gap = props.gap;
  if (props.radius !== undefined) style.borderRadius = props.radius;
  return { ...style, ...padStyle(props.pad) };
}

// one band of a page. The rhythm is padding only: a section carries 64px of air on
// mobile and 72px from 768px up, and no margin sits between two sections, so the
// distance between bands is always twice its own padding rather than a gap someone
// has to tune. A section holds one thing, which is what keeps a screen from
// reading as one crowded stack.
export function Section({
  children,
  id,
  className,
  pad,
}: {
  children?: ReactNode;
  id?: string;
  className?: string;
  // the resting rhythm; a screen asks for its hero's own padding by overriding it
  pad?: string;
}) {
  return (
    <section id={id} className={`${pad ?? 'py-16 md:py-18'}${className ? ` ${className}` : ''}`}>
      {children}
    </section>
  );
}

export function Stack({ children, ...props }: BoxProps) {
  return (
    <div className={`flex flex-col ${frameClass(props)}`} style={frameStyle(props)}>
      {children}
    </div>
  );
}

export function Row({
  justify = 'start',
  align = 'start',
  grow,
  children,
  ...props
}: BoxProps & { justify?: Justify; align?: Align; grow?: boolean }) {
  return (
    <div
      className={`flex flex-row ${JUSTIFY[justify]} ${ALIGN[align]} ${grow ? 'flex-1' : ''} ${frameClass(props)}`}
      style={frameStyle(props)}
    >
      {children}
    </div>
  );
}
