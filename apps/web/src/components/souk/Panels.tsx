// The three blocks that repeat across screens: a section head, a note box and the kpi
// that carries a figure on the metal band.
//
// The kpi is the only place a number sits on the brand surface rather than on a card,
// which is what makes it read as a headline rather than as a row.

import type { ReactNode } from 'react';
import { Row, Stack } from './Layout';
import { Txt, type Weight } from './Txt';
import { Label } from './Chips';
import { METAL_BAND } from './tokens';

// a section head: the title in ink, the mono note pushed to the far right, a hairline
// underneath. The note is why the row exists, so it takes the stretch.
export function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <Row justify="between" align="center" gap={9} pad={[0, 0, 9, 0]} className="border-b border-white/[0.16]">
      <Txt size={18} lead={27} weight="bold" tone="ink">
        {title}
      </Txt>
      {note ? (
        <Txt size={10} lead={14} mono upper tone="labels">
          {note}
        </Txt>
      ) : null}
    </Row>
  );
}

export interface NoteRow {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'slate' | 'data' | 'peach' | 'ink';
  width?: number;
}

// a hairline block with a bold title and label/value lines. No fill: it reads as a
// margin note in a card, not as another card nested inside one.
export function NoteBox({
  title,
  copy,
  rows,
  children,
}: {
  title: string;
  copy?: string;
  rows?: NoteRow[];
  children?: ReactNode;
}) {
  return (
    <Stack pad={[14, 16, 14, 16]} gap={10} radius={14} hair>
      <Txt size={13} lead={20} weight="bold" tone="ink">
        {title}
      </Txt>
      {copy ? (
        <Txt size={12} lead={18} tone="steel">
          {copy}
        </Txt>
      ) : null}
      {rows?.map((r) => (
        <Row key={r.label + r.value} justify="between" align="start">
          <Txt size={12} lead={18} tone="muted">
            {r.label}
          </Txt>
          <Txt
            size={11}
            lead={18}
            mono={r.mono}
            tone={r.tone ?? 'slate'}
            // a value wider than its label wraps, and the design hands it a width
            className={r.width ? 'max-w-full text-right' : undefined}
          >
            {r.value}
          </Txt>
        </Row>
      ))}
      {children}
    </Stack>
  );
}

export interface KpiSpec {
  value: string;
  label: string;
  // the figure is only coloured when the chain earned it; a zero stays white
  tone?: 'data' | 'white';
}

export function Kpi({ value, label, tone = 'data' }: KpiSpec) {
  return (
    <Stack
      pad={[12, 14, 12, 14]}
      gap={2}
      radius={8}
      className="border-souk-metal2"
      // the metal band is a gradient, which a utility cannot name
      style={{ backgroundImage: METAL_BAND }}
    >
      <Txt size={20} lead={26} weight="bold" mono tone={tone}>
        {value}
      </Txt>
      <Label weight="bold" tone="white">
        {label}
      </Label>
    </Stack>
  );
}

// a figure beside its provenance: the number in mono, the sentence that explains it
// in body copy. Used wherever a sweep time sits with the count it read.
export function FigureNote({
  figure,
  note,
  tone = 'data',
  weight = 'bold' as Weight,
}: {
  figure: ReactNode;
  note: string;
  tone?: 'data' | 'white' | 'ink';
  weight?: Weight;
}) {
  return (
    <Stack gap={4}>
      <Txt size={22} lead={28} weight={weight} mono tone={tone}>
        {figure}
      </Txt>
      <Txt size={12} lead={18} tone="steel">
        {note}
      </Txt>
    </Stack>
  );
}
