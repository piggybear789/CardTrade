// components/account/EmptyState.tsx
//
// Backwards-compatible account wrapper around the shared application empty
// state. Account sections keep their existing call sites while inheriting the
// same centering, spacing, and responsive action treatment as other routes.

import type { ReactNode } from 'react';
import { EmptyState as SharedEmptyState } from '@/components/ui/empty-state';

export function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  ctaHref,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <SharedEmptyState
      icon={icon}
      title={title}
      description={description}
      action={{ label: ctaLabel, href: ctaHref }}
      // A section empty state carries less weight than a full-page one, so it
      // uses the tighter padding. The hub already has browse / sell on phones.
      compact
      hideActionOnMobile
    />
  );
}
