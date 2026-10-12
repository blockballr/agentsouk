// The figma pass's primitives, as one import. A ported screen brings this in and states
// what it is showing; it never restates a surface, a chip, a hairline or a type size.

export { Txt } from './Txt';
export type { Weight } from './Txt';
export { Stack, Row, BG } from './Layout';
export type { BoxProps, BgName, Justify, Align } from './Layout';
export { Pill, Dot, Rule, Label } from './Chips';
export type { PillVariant, DotTone } from './Chips';
export { Btn, IconBtn, ProfileChip } from './Btn';
export type { BtnKind } from './Btn';
export { SectionHead, NoteBox, Kpi, FigureNote } from './Panels';
export type { KpiSpec, NoteRow } from './Panels';
export { DataTable } from './DataTable';
export type { CellSpec, TableRowSpec } from './DataTable';
export {
  LogoMark,
  AgentAvatar,
  initialsFor,
  IconSearch,
  IconBell,
  IconCart,
  IconMonitor,
  IconTrophy,
} from './Marks';
export { TONE, EDGE, HAIR, METAL_BAND, R } from './tokens';
export type { Tone, Pad } from './tokens';
