// components/ui/status-glyph.tsx
//
// FILLED, COLOURED MARKS FOR ICONS THAT CARRY MEANING.
//
// The icon set (`components/ui/icons.ts`, Phosphor) draws outline glyphs for this job.
// That is right for navigation, actions and decoration, and every SaaS reference we
// studied (Linear, Vercel, Stripe, Attio, Clerk, Mercury; Mobbin, 2026-11-21) draws those
// the same way. It is wrong for the small icons that ARE the information: verified, good,
// so-so, bad, warning. At 14-18px a 1.5px teal stroke reads as a faint doodle beside its
// text, and "verified" looked like any other decoration. Those apps draw that class of
// icon as a solid disc or seal in the state's colour with a white mark knocked out of it
// (Vercel's ready check, Klaviyo's "Published", the blue verified seal), so the colour is
// a shape rather than a hairline.
//
// THE RULE: an icon that states a fact about a person, a contract or a check uses a
// glyph from here. Every other icon stays a grey outline `<Icon>`.
//
// Hand-drawn on a 20px grid so the knockout stays crisp at 14px. Decorative by default
// (`aria-hidden`): the caller owns the label, exactly as with `<Icon>`.

import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

export type StatusGlyphKind = 'success' | 'neutral' | 'warning' | 'danger' | 'verified' | 'trusted';

/**
 * Each kind's colour. The FILL is a marker and owes 3:1 against the page; the white
 * knockout owes the same against the fill. Every tone here clears both (the amber
 * `action-edge`, the lightest, is about 3.5:1 each way). `trusted` keeps the iris-ink the
 * Trusted Seller badge has always worn, so the mark stays NoDitto's violet and never
 * reads as a second "verified".
 */
const TONE: Record<StatusGlyphKind, string> = {
  success: 'text-trust',
  verified: 'text-trust',
  neutral: 'text-action-edge',
  warning: 'text-action-edge',
  danger: 'text-destructive',
  trusted: 'text-iris-ink',
};

const KNOCKOUT = {
  fill: 'none',
  stroke: '#fff',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const CHECK = 'M6.4 10.3 8.75 12.6 13.6 7.6';
const SHIELD =
  'M10 1.6 3.4 3.95a.9.9 0 0 0-.6.85v4.3c0 4.1 2.8 7.6 6.9 9.25a.9.9 0 0 0 .6 0c4.1-1.65 6.9-5.15 6.9-9.25V4.8a.9.9 0 0 0-.6-.85z';

/** A twelve-lobed seal, rounded by its own stroke. Computed once, identically on server and client. */
const SEAL = (() => {
  const points: string[] = [];
  for (let i = 0; i < 24; i++) {
    const radius = i % 2 === 0 ? 8.9 : 7.5;
    const angle = (Math.PI * 2 * i) / 24 - Math.PI / 2;
    points.push(`${(10 + radius * Math.cos(angle)).toFixed(2)} ${(10 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
})();

function Mark({ kind }: { kind: StatusGlyphKind }) {
  switch (kind) {
    case 'success':
      return (
        <>
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d={CHECK} {...KNOCKOUT} />
        </>
      );
    case 'neutral':
      return (
        <>
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d="M6.5 10h7" {...KNOCKOUT} />
        </>
      );
    case 'warning':
    case 'danger':
      return (
        <>
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d="M10 5.9v4.7" {...KNOCKOUT} />
          <circle cx="10" cy="13.85" r="1.1" fill="#fff" />
        </>
      );
    case 'verified':
      return (
        <>
          <path d={SHIELD} fill="currentColor" />
          <path d="M6.9 10.1 9.05 12.25 13.2 8" {...KNOCKOUT} strokeWidth={1.7} />
        </>
      );
    case 'trusted':
      return (
        <>
          <path d={SEAL} fill="currentColor" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
          <path d={CHECK} {...KNOCKOUT} strokeWidth={1.7} />
        </>
      );
  }
}

export interface StatusGlyphProps {
  kind: StatusGlyphKind;
  /** Size with `size-*` (default `size-4`). A `text-*` colour here overrides the kind's own. */
  className?: string;
  style?: CSSProperties;
}

/** A filled status mark: a solid shape in the state's colour with a white symbol knocked out. */
export function StatusGlyph({ kind, className, style }: StatusGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      className={cn('size-4 shrink-0', TONE[kind], className)}
      style={style}
    >
      <Mark kind={kind} />
    </svg>
  );
}
