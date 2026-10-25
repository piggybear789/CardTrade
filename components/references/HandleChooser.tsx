// components/references/HandleChooser.tsx
//
// What a bare `/references/john` shows when more than one person is john: one row per
// person, on their platform, and the visitor picks. Guessing would put one person's
// references in front of someone looking for another.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, ArrowRight01Icon, ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { PlatformChip } from '@/components/references/referenceLabels';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { referenceAddressKey, referenceHref } from '@/domain/references/address';
import { platformLabel } from '@/domain/references/reference';
import type { ReferenceHandleChoice } from '@/lib/references/graph';

export function HandleChooser({
  handle,
  choices,
  params = {},
}: {
  handle: string;
  choices: readonly ReferenceHandleChoice[];
  /** Carried onto the chosen page, e.g. `experience=1` from a reference request link. */
  params?: Record<string, string>;
}) {
  return (
    <section
      aria-labelledby="handle-chooser-heading"
      className="mx-auto w-full max-w-xl rounded-lg border border-border bg-card p-group shadow-market sm:p-6"
    >
      <div className="flex items-center gap-cozy">
        <Button asChild variant="ghost" size="icon" className="-ml-2 size-10 shrink-0 rounded-full md:size-9 [&_svg]:size-5">
          <Link href="/references" aria-label="Back to references">
            <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 id="handle-chooser-heading" className="break-all text-subhead font-semibold tracking-tight text-foreground">
            Which @{handle}?
          </h1>
          <p className="text-body text-muted-foreground">
            More than one person goes by @{handle}. Choose the platform you know them from.
          </p>
        </div>
      </div>

      <ul className="mt-group divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80">
        {choices.map((choice) => (
          <li key={referenceAddressKey(choice.address)}>
            <Link
              href={referenceHref(choice.address, params)}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Avatar avatarPath={choice.avatarPath} displayName={choice.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="break-all text-body font-semibold text-foreground">{choice.handle}</span>
                  {choice.platform ? <PlatformChip slug={choice.platform} className="size-5" /> : null}
                  {choice.identityVerified ? (
                    <HugeiconsIcon icon={ShieldCheckIcon} className="size-3.5 shrink-0 text-trust" aria-label="ID verified" />
                  ) : null}
                </span>
                <span className="mt-0.5 block text-meta text-muted-foreground">
                  {[
                    choice.platform ? `On ${platformLabel(choice.platform)}` : null,
                    choice.unclaimed ? 'Not claimed yet' : choice.name,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <HugeiconsIcon icon={ArrowRight01Icon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
