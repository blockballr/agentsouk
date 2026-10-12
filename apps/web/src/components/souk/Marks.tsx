// The marketplace's own marks, and the 18px line icons the top bar uses.
//
// The logo mark is the default account picture: a wallet that has not set an avatar
// still has to read as the marketplace rather than as a missing image. The agent avatar
// is the listing's own face, squared at the field radius rather than a circle, because
// the shelf is where a buyer picks on sight.

import { Txt } from './Txt';
import { METAL_BAND } from './tokens';

export function initialsFor(name: string): string {
  const parts = String(name || 'Agent')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // letters only: a name opening on a digit gets a readable initial rather than a
  // number that reads as a broken avatar
  const first = /[A-Za-z]/.exec(parts[0] || 'Agent');
  const second = parts[1] ? /[A-Za-z]/.exec(parts[1]) : null;
  return `${(first ? first[0] : 'A') + (second ? second[0] : '')}`.toUpperCase();
}

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/[0.16]"
      style={{ width: size, height: size, backgroundImage: METAL_BAND }}
    >
      <Txt size={Math.round(size * 0.4)} lead={Math.round(size * 0.52)} weight="bold" mono tone="ink">
        AS
      </Txt>
    </span>
  );
}

export function AgentAvatar({
  size = 40,
  name,
  imageUrl,
}: {
  size?: number;
  name: string;
  imageUrl?: string | null;
}) {
  const radius = 8;
  const shared = { width: size, height: size, borderRadius: radius };
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/[0.16] bg-souk-indigo"
      style={shared}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" width={size} height={size} className="h-full w-full object-cover" />
      ) : (
        <Txt
          size={Math.round(size * 0.34)}
          lead={Math.round(size * 0.46)}
          weight="bold"
          mono
          tone="ink"
        >
          {initialsFor(name)}
        </Txt>
      )}
    </span>
  );
}

// 18px line icons at the product's own stroke, so the bar reads as one set
const strokeProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: '#8d93a3',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function IconSearch() {
  return (
    <svg width="18" height="18" {...strokeProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21" />
    </svg>
  );
}

export function IconBell() {
  return (
    <svg width="18" height="18" {...strokeProps}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function IconCart() {
  return (
    <svg width="18" height="18" {...strokeProps}>
      <path d="M2 3h2.6l2.4 12.3a2 2 0 0 0 2 1.6h8.3a2 2 0 0 0 2-1.6L21 7H6" />
      <circle cx="9.5" cy="20" r="1.4" />
      <circle cx="17.5" cy="20" r="1.4" />
    </svg>
  );
}

export function IconMonitor() {
  return (
    <svg width="18" height="18" {...strokeProps}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8.5 21h7M12 17v4" />
    </svg>
  );
}

// the winner's mark, in the earned colour because it marks a result
export function IconTrophy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#44b48b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}
