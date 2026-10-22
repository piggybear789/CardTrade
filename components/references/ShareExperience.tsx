'use client';

// components/references/ShareExperience.tsx
//
// Leave a reference (0155) using the standard shadcn Dialog (`components/ui/dialog`):
// 1..5 star rating + Description (`Textarea`) + Image (`Button`).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { PlusIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Composer,
  CopyReferenceLink,
  VerifyIdGate,
  useReferenceComposer,
  type ComposerViewer,
} from '@/components/references/ReferenceComposer';
import type { ReferenceTargetDescriptor } from '@/lib/actions/references';
import { cn } from '@/lib/utils';

export function ShareExperience({
  target,
  viewer,
  returnPath,
  autoOpen = false,
  label = 'Leave a reference',
  className,
}: {
  target: ReferenceTargetDescriptor;
  viewer: ComposerViewer;
  /** Where sign-in / verification should bring the member back to. */
  returnPath: string;
  /** Open the composer on mount (arrived from a reference request link). */
  autoOpen?: boolean;
  /** Trigger button label. */
  label?: string;
  className?: string;
}) {
  const draft = useReferenceComposer(target);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (autoOpen && !viewer.isSelf) setOpen(true);
  }, [autoOpen, viewer.isSelf]);

  if (viewer.isSelf) return <CopyReferenceLink returnPath={returnPath} className={className} />;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) draft.reset();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" className={cn('shrink-0', className)}>
          <HugeiconsIcon icon={PlusIcon} className="size-3.5" aria-hidden />
          {label}
        </Button>
      </DialogTrigger>

      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {draft.done ? 'Reference published' : `Reference ${target.handle}`}
          </DialogTitle>
          {!draft.done ? (
            <DialogDescription>
              Share how the transaction went. Your rating helps other traders.
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <Composer.Provider draft={draft}>
          {draft.done ? (
            <Composer.Published onDone={() => handleOpenChange(false)} />
          ) : !viewer.signedIn ? (
            <>
              <div className="space-y-group">
                <Composer.Platform />
                <Composer.Role />
                <Composer.Outcome />
                <Composer.Comment id="share-experience-preview" rows={4} />
                <Composer.ImageField />
                <Composer.Error />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  asChild
                  onClick={(event) => {
                    if (!draft.saveDraftToSession()) {
                      event.preventDefault();
                    }
                  }}
                >
                  <Link href={`/sign-in?redirectTo=${encodeURIComponent(`${returnPath}?experience=1`)}`}>
                    Sign in to publish
                  </Link>
                </Button>
              </DialogFooter>
            </>
          ) : !viewer.identityVerified ? (
            <VerifyIdGate />
          ) : (
            <>
              <div className="space-y-group">
                <Composer.Platform />
                <Composer.Role />
                <Composer.Outcome />
                <Composer.Comment id="share-experience-comment" rows={4} />
                <Composer.ImageField />
                <Composer.Error />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={draft.pending}
                  onClick={() => handleOpenChange(false)}
                >
                  Cancel
                </Button>
                <Composer.Publish />
              </DialogFooter>
            </>
          )}
        </Composer.Provider>
      </DialogContent>
    </Dialog>
  );
}
