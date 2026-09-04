// components/layout/RailPrimaryAction.tsx
//
// A section's primary CTA. Sized by its container — full width in the rail, and
// in SectionHeader's `mobileAction` slot below `md`. Lives in its own module so
// client triggers can reuse it without importing the server MarketplaceShell.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { PlusIcon } from '@hugeicons/core-free-icons';

import { Button, type ButtonProps } from '@/components/ui/button';

const CREATE_GLYPH = <HugeiconsIcon icon={PlusIcon} aria-hidden="true" />;

// Obsidian, not the violet primary. A section CTA sits in the rail beside a
// column of lilac chrome — the iris rail markers, the accent current-section
// fill, the violet category pills — and a violet fill in that company is one
// more purple rectangle rather than the one thing to press. Black is the only
// value in the palette nothing else in the rail is using.
//
// `variant`, not a `bg-` class: the fill, the border and both interaction
// states have to move together, and `contrast` is where that set already
// lives. See the `Button` cva.
const ACTION_VARIANT = 'contrast' as const;
const ACTION_CLASS = 'w-full';

type RailPrimaryActionProps = {
  /**
   * Leading glyph, a plus by default because most sections' one action is to
   * create something. Pass `null` where the action only goes somewhere: a plus
   * on a link that opens a browse page promises a new record that never
   * appears.
   */
  glyph?: ReactNode;
  /**
   * Per-call-site size, because "the section's primary action" is not one
   * weight across the app. On a section you arrive at to DO something, the
   * default is right — the rail CTA is one of several equals. On the catalog it
   * is the only thing in the rail competing with a full grid of cards, and the
   * default 28px pill loses.
   *
   * Set it on the instance, never on `ACTION_CLASS`: this component is also
   * handed to SectionHeader's `mobileAction` by six other sections, so a change
   * to the default is a change to their phone layouts too.
   */
  size?: ButtonProps['size'];
  children: ReactNode;
} & (
  | { href: string; onClick?: never }
  | { onClick: () => void; href?: never }
);

export function RailPrimaryAction({
  href,
  onClick,
  glyph = CREATE_GLYPH,
  size,
  children,
}: RailPrimaryActionProps) {
  if (onClick) {
    return (
      <Button
        type="button"
        variant={ACTION_VARIANT}
        size={size}
        className={ACTION_CLASS}
        onClick={onClick}
      >
        {glyph}
        {children}
      </Button>
    );
  }

  return (
    <Button asChild variant={ACTION_VARIANT} size={size} className={ACTION_CLASS}>
      <Link href={href} transitionTypes={['nav-forward']}>
        {glyph}
        {children}
      </Link>
    </Button>
  );
}
