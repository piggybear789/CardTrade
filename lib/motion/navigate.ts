'use client';

import { addTransitionType, startTransition } from 'react';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

export type NavTransitionType = 'nav-forward' | 'nav-back';

/** Tag a programmatic navigation so page-level view transitions can pick a direction. */
export function navigateWithType(
  router: AppRouterInstance,
  href: string,
  type: NavTransitionType,
  method: 'push' | 'replace' = 'push',
) {
  startTransition(() => {
    addTransitionType(type);
    router[method](href);
  });
}
