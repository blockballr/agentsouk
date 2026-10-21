// The marketplace's own marks, and the 18px line icons the top bar uses.
//
// The logo mark is the default account picture: a wallet that has not set an avatar
// still has to read as the marketplace rather than as a missing image. The agent avatar
// is the listing's own face, squared at the field radius rather than a circle, because
// the shelf is where a buyer picks on sight.

import { Txt } from './Txt';
import { defaultAvatarFor } from '../../lib/default-avatar';

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

// the souk mark: four squares, the fourth in the data green. the brand's own
// lockup, so it stands wherever the wordmark's logo half is called for
export function SoukMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="shrink-0"
    >
      <rect x="8" y="8" width="22" height="22" rx="4" fill="currentColor" />
      <rect x="34" y="8" width="22" height="22" rx="4" fill="currentColor" />
      <rect x="8" y="34" width="22" height="22" rx="4" fill="currentColor" />
      <rect x="34" y="34" width="22" height="22" rx="4" fill="var(--color-souk-data)" />
    </svg>
  );
}

export function AgentAvatar({
  size = 40,
  name,
  imageUrl,
  chainId,
  tokenId,
}: {
  size?: number;
  name: string;
  imageUrl?: string | null;
  // the shelf's default face is keyed on the listing, so pass the identity
  // wherever it is known and an agent without a picture keeps its own mark
  chainId?: number | string;
  tokenId?: string | number;
}) {
  const radius = 8;
  const shared = { width: size, height: size, borderRadius: radius };
  const fallback =
    chainId !== undefined && tokenId !== undefined
      ? defaultAvatarFor(Number(chainId), String(tokenId))
      : null;
  const src = imageUrl ?? fallback;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden border border-souk-hair bg-souk-indigo"
      style={shared}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={(e) => {
            if (fallback && e.currentTarget.getAttribute('src') !== fallback) {
              e.currentTarget.src = fallback;
            }
          }}
        />
      ) : (
        <Txt
          size={Math.round(size * 0.34)}
          lead={Math.round(size * 0.46)}
          weight="bold"
          mono
          tone="white"
        >
          {initialsFor(name)}
        </Txt>
      )}
    </span>
  );
}

// 18px line icons at the product's own stroke, so the bar reads as one set. The
// stroke inherits, so the control's own tone decides it in either register.
const strokeProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
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

export function IconMonitor() {
  return (
    <svg width="18" height="18" {...strokeProps}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8.5 21h7M12 17v4" />
    </svg>
  );
}

// the docs mark: a page with a folded corner and two ruled lines, at the status
// bar's own small size rather than the control row's 18
export function IconDocs() {
  return (
    <svg width="13" height="13" {...strokeProps}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8.5 13h7M8.5 17h4.5" />
    </svg>
  );
}

// the disclosure's own mark: which way the folded section opens
export function IconChevron({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" className={className} {...strokeProps}>
      <path d="m4 8 6 6 6-6" />
    </svg>
  );
}

// the winner's mark, in the earned colour because it marks a result
export function IconTrophy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-souk-data">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}
