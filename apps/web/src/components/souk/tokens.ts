// The figma pass, ported. The design file declares its palette once and every screen
// reads from it, so the React layer does the same: one tone map, one hairline pair, one
// metal band. Nothing screen-specific lives here.

export type Tone =
  | 'ink'
  | 'slate'
  | 'steel'
  | 'muted'
  | 'data'
  | 'labels'
  | 'sky'
  | 'peach'
  | 'white'
  | 'canvas';

export const TONE: Record<Tone, string> = {
  ink: 'text-souk-ink',
  slate: 'text-souk-slate',
  steel: 'text-souk-steel',
  muted: 'text-souk-muted',
  data: 'text-souk-data',
  labels: 'text-souk-labels',
  sky: 'text-souk-sky',
  peach: 'text-souk-peach',
  white: 'text-souk-white',
  canvas: 'text-souk-canvas',
};

// the design draws two edges: a card's own 8% rim and the 16% hairline between rows.
// they are colours, not a fixed white, so the light register can redraw them.
export const EDGE = 'border-souk-edge';
export const HAIR = 'border-souk-hair';

// left pad, as the design states it: [top, right, bottom, left]
export type Pad = [number, number, number, number];

export function padStyle(pad?: Pad): React.CSSProperties {
  if (!pad) return {};
  return {
    paddingTop: pad[0],
    paddingRight: pad[1],
    paddingBottom: pad[2],
    paddingLeft: pad[3],
  };
}

// the indigo band and its darker ramp, the one place a figure sits on the brand surface
export const METAL_BAND =
  'linear-gradient(180deg, #1d2a5e 0%, #111a4a 45%, #0a1030 100%)';

// radii, stated once so a bar stays 3 while a chip stays 6
export const R = {
  surface: 20,
  note: 14,
  field: 8,
  chip: 6,
  bar: 3,
} as const;
