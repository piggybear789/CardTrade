// components/profile/SocialPlatformIcon.tsx
//
// Brand glyphs keyed by the domain registry slug. Our icon set ships no brand
// marks, so these are inline paths — one source for both the editor and the
// public display.

import { HugeiconsIcon } from '@hugeicons/react';
import { ExternalLinkIcon, GlobeIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

export function SocialPlatformIcon({
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  const base = cn('shrink-0', className);

  switch (slug) {
    case 'website':
      return <HugeiconsIcon icon={GlobeIcon} className={base} aria-hidden />;
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={base} aria-hidden>
          <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
          <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
        </svg>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={base} aria-hidden>
          <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
          <path d="m10 15 5-3-5-3z" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={base} aria-hidden>
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.88-2.88 2.89 2.89 0 0 1 2.88-2.88c.28 0 .56.04.82.1v-3.5a6.37 6.37 0 0 0-.82-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.8a8.26 8.26 0 0 0 4.76 1.5V6.84a4.83 4.83 0 0 1-1-.15z" />
        </svg>
      );
    case 'x':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={base} aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={base} aria-hidden>
          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
        </svg>
      );
    case 'discord':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={base} aria-hidden>
          <path d="M20.32 4.57A19.79 19.79 0 0 0 15.43 3c-.2.36-.43.85-.6 1.24a18.3 18.3 0 0 0-5.66 0c-.16-.39-.4-.88-.6-1.24a19.74 19.74 0 0 0-4.9 1.57C.9 9.09.07 13.47.49 17.79a19.9 19.9 0 0 0 6 3.04c.48-.66.91-1.36 1.28-2.1-.7-.26-1.38-.59-2.01-.97.17-.13.33-.26.49-.4a14.2 14.2 0 0 0 12.12 0c.16.14.32.27.49.4-.64.38-1.31.71-2.02.97.37.74.8 1.44 1.29 2.1a19.87 19.87 0 0 0 6-3.04c.5-5.02-.83-9.36-3.81-13.22ZM8.3 15.14c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.21 0 2.18 1.09 2.16 2.4 0 1.33-.95 2.41-2.16 2.41Zm7.4 0c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.21 0 2.18 1.09 2.16 2.4 0 1.33-.95 2.41-2.16 2.41Z" />
        </svg>
      );
    case 'ebay':
      return (
        <svg viewBox="0 0 24 24" className={base} aria-hidden>
          <text
            x="12"
            y="15.5"
            textAnchor="middle"
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="800"
            fontSize="9.5"
            letterSpacing="-0.4"
          >
            <tspan fill="#E53238">e</tspan>
            <tspan fill="#0064D2">b</tspan>
            <tspan fill="#F5AF02">a</tspan>
            <tspan fill="#86B817">y</tspan>
          </text>
        </svg>
      );
    case 'whatnot':
      return (
        <svg viewBox="0 0 115.16 115.16" className={base} aria-hidden>
          <path
            d="M115.14,57.57c0,44.51-13.06,57.57-57.57,57.57S0,102.08,0,57.57,13.06,0,57.57,0s57.57,13.06,57.57,57.57"
            fill="#FFE505"
          />
          <path
            d="M57.58 0C13.06 0 0 13.06 0 57.58s13.06 57.58 57.58 57.58 57.58-13.06 57.58-57.58S102.1 0 57.58 0ZM89.5 65l-3.35 5.24C79.19 81.12 75.4 84.21 70.81 84.21c-4.85 0-7.49-2.38-13.97-12.87l-3.79-6.13c-.79-1.32-2.2-.75-1.85.75l.66 2.69c2.34 9.47-1.15 15.56-7.01 15.56-4.54 0-8.15-2.51-16-14.41l-3.26-4.94c-4.98-7.54-6.83-11.46-6.83-16.57 0-6.43 4.67-11.68 11.85-11.68 5.51 0 9.03 2.47 12.12 8.5l.79 1.54c.62 1.15 1.67 1.06 2.07 0l.57-1.5c2.2-5.77 5.77-8.55 11.37-8.55s9.34 2.78 11.5 8.55l.57 1.54c.4 1.01 1.54 1.1 2.07 0l.79-1.59c3.04-6.08 6.48-8.5 11.99-8.5 7.18 0 11.9 5.24 11.9 11.68 0 5.11-1.98 9.03-6.87 16.7Z"
            fill="#292527"
          />
        </svg>
      );
    case 'noditto':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/brand/noditto-mark.png" alt="" className={cn(base, 'object-contain')} />
      );
    default:
      return <HugeiconsIcon icon={ExternalLinkIcon} className={base} aria-hidden />;
  }
}
