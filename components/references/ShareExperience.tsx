'use client';

// components/references/ShareExperience.tsx
//
// Leave a reference (0155). Who is looking decides what the button does:
//
//   - The owner gets the share-link control (`CopyReferenceLink`), not a composer.
//   - Signed in but not ID-checked: the button starts the identity check straight away
//     and brings the member back here (`/api/identity/start`). A reference is only ever
//     published by a verified person, so there is no dialog to act on first.
//   - Everyone else gets a two-step dialog (`components/ui/dialog`):
//       1. The deal  — where it happened, and whether they bought, sold or traded.
//       2. Rating    — 1..5 stars, the member's own words, optional proof, Publish.
//     A visitor who is signed out drafts through both steps, then signs in to publish.
//
// WHY STEPS. One tall form put six platform buttons, three deal buttons, stars, a text
// box and an upload in a single column, so the dialog read as a questionnaire and the
// Publish button sat below the fold on a phone. Every step edits the same
// `useReferenceComposer` draft, so Back never loses anything.

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
  useReferenceComposer,
  type ComposerViewer,
} from '@/components/references/ReferenceComposer';
import { withQuery } from '@/domain/references/address';
import type { ReferenceTargetDescriptor } from '@/lib/actions/references';
import { identityStartHref } from '@/lib/identity/identityStart';
import { cn } from '@/lib/utils';

type Step = 1 | 2;

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
  const [step, setStep] = useState<Step>(1);
  const startVerificationHref = identityStartHref(returnPath);

  // Back from sign-in with a reference in progress. A verified member gets the dialog;
  // an unverified one goes straight to the check, rather than to a card to act on.
  //
  // Not when they are back FROM the check (`identity=complete`, e.g. the onboarding
  // wizard's reference path): `IdentityReturnRefresh` is reading the result from Stripe,
  // and starting the check again would loop. The dialog opens once the page re-renders
  // as verified.
  useEffect(() => {
    if (!autoOpen || viewer.isSelf) return;
    const backFromCheck = new URLSearchParams(window.location.search).get('identity') === 'complete';
    if (viewer.signedIn && !viewer.identityVerified && !backFromCheck) {
      window.location.assign(startVerificationHref);
      return;
    }
    setOpen(true);
  }, [autoOpen, viewer.isSelf, viewer.signedIn, viewer.identityVerified, startVerificationHref]);

  if (viewer.isSelf) return <CopyReferenceLink returnPath={returnPath} className={className} />;

  // Signed in but not ID-checked: the button starts the check and comes back here.
  if (viewer.signedIn && !viewer.identityVerified) {
    return (
      <Button asChild className={cn('shrink-0', className)}>
        <a href={startVerificationHref}>
          <HugeiconsIcon icon={PlusIcon} className="size-3.5" aria-hidden />
          {label}
        </a>
      </Button>
    );
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      draft.reset();
      setStep(1);
    }
  };

  const next = () => {
    if (!draft.requirePlatform()) return;
    setStep(2);
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
          <div className="flex items-center gap-snug">
            <DialogTitle className="min-w-0 flex-1 truncate">
              {draft.done ? 'Reference published' : `Reference ${target.handle}`}
            </DialogTitle>
            {draft.done ? null : (
              <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                Step {step} of 2
              </span>
            )}
          </div>
          {draft.done ? (
            <DialogDescription className="sr-only">Reference published</DialogDescription>
          ) : (
            <DialogDescription>
              {step === 1
                ? `Where did you deal with ${target.handle}, and what did you do?`
                : 'How did it go? Your rating helps other traders.'}
            </DialogDescription>
          )}
        </DialogHeader>

        <Composer.Provider draft={draft}>
          {draft.done ? (
            <Composer.Published onDone={() => handleOpenChange(false)} />
          ) : (
            <>
              {/* Keyed by step so each step mounts fresh (star hover state and the like). */}
              <div key={step} className="space-y-group">
                {step === 1 ? (
                  <>
                    <Composer.Platform />
                    <Composer.Role />
                  </>
                ) : (
                  <>
                    <Composer.Outcome />
                    <Composer.Comment
                      id={viewer.signedIn ? 'share-experience-comment' : 'share-experience-preview'}
                      rows={4}
                    />
                    {/* Signed out, uploads would not survive the trip through sign-in
                        (the saved draft holds text only), so they are offered after it. */}
                    {viewer.signedIn ? <Composer.ImageField /> : null}
                  </>
                )}
                <Composer.Error />
              </div>

              <DialogFooter className="sm:justify-between">
                {step === 1 ? (
                  <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                    Cancel
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" disabled={draft.pending} onClick={() => setStep(1)}>
                    Back
                  </Button>
                )}

                {step === 1 ? (
                  <Button type="button" onClick={next}>
                    Next
                  </Button>
                ) : viewer.signedIn ? (
                  <Composer.Publish />
                ) : (
                  <Button
                    asChild
                    onClick={(event) => {
                      if (!draft.saveDraftToSession()) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <Link href={`/sign-in?redirectTo=${encodeURIComponent(withQuery(returnPath, { experience: '1' }))}`}>
                      Sign in to publish
                    </Link>
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </Composer.Provider>
      </DialogContent>
    </Dialog>
  );
}
