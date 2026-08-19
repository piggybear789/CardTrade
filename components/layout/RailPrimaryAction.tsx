// components/layout/RailPrimaryAction.tsx
//
// A section's primary CTA: obsidian fill, parchment label. Sized by its
// container — full width in the rail, and in SectionHeader's `mobileAction`
// slot below `md`. Lives in its own module so client triggers can reuse it
// without importing the server MarketplaceShell.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

const CREATE_GLYPH = <Plus aria-hidden="true" className="text-gold" />;

const ACTION_CLASS =
  'w-full border border-white/15 bg-obsidian text-parchment font-semibold shadow-sm hover:bg-obsidian/80 hover:border-white/25';

type RailPrimaryActionProps = {
  /**
   * Leading glyph, a plus by default because most sections' one action is to
   * create something. Pass `null` where the action only goes somewhere: a plus
   * on a link that opens a browse page promises a new record that never
   * appears.
   */
  glyph?: ReactNode;
  children: ReactNode;
} & (
  | { href: string; onClick?: never }
  | { onClick: () => void; href?: never }
);

export function RailPrimaryAction({
  href,
  onClick,
  glyph = CREATE_GLYPH,
  children,
}: RailPrimaryActionProps) {
  if (onClick) {
    return (
      <Button type="button" className={ACTION_CLASS} onClick={onClick}>
        {glyph}
        {children}
      </Button>
    );
  }

  return (
    <Button asChild className={ACTION_CLASS}>
      <Link href={href} transitionTypes={['nav-forward']}>
        {glyph}
        {children}
      </Link>
    </Button>
  );
}
