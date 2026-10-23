'use client';

// components/references/ShareExperience.tsx
//
// Leave a reference (0155) as a three-step dialog (`components/ui/dialog`):
//
//   1. The deal    — where it happened and whether they bought, sold or traded.
//   2. Rating      — 1..5 stars and the member's own words.
//   3. Review      — the reference read back, optional proof screenshots, Publish.
//
// WHY STEPS. One tall form put six platform buttons, three deal buttons, stars, a text
// box and an upload in a single column, so the dialog read as a questionnaire and the
// Publish button sat below the fold on a phone. A reference also goes live the moment
// it is published, under the author's verified name, so the last step reads it back
// before it goes out. The draft itself is unchanged: every step edits the same
// `useReferenceComposer` state, so Back never loses anything.

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
import { StepProgress } from '@/components/ui/step-progress';
import {
  Composer,
  CopyReferenceLink,
  VerifyIdGate,
  useReferenceComposer,
  type ComposerViewer,
} from '@/components/references/ReferenceComposer';
import type { ReferenceTargetDescriptor } from '@/lib/actions/references';
import { cn } from '@/lib/utils';

const STEP_LABELS = ['The deal', 'Rating', 'Review'] as const;
type Step = 1 | 2 | 3;

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

  useEffect(() => {
    if (autoOpen && !viewer.isSelf) setOpen(true);
  }, [autoOpen, viewer.isSelf]);

  if (viewer.isSelf) return <CopyReferenceLink returnPath={returnPath} className={className} />;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      draft.reset();
      setStep(1);
    }
  };

  const next = () => {
    if (step === 1 && !draft.requirePlatform()) return;
    setStep((current) => (current < 3 ? ((current + 1) as Step) : current));
  };
  const back = () => setStep((current) => (current > 1 ? ((current - 1) as Step) : current));

  // The stepped flow is for someone who can publish, or who is drafting before signing
  // in. An unverified member gets the ID gate on its own: walking them through three
  // steps they cannot submit would be the wrong way round.
  const stepped = !draft.done && (!viewer.signedIn || viewer.identityVerified);

  const description = draft.done
    ? null
    : !stepped
      ? 'Share how the transaction went. Your rating helps other traders.'
      : step === 1
        ? `Where did you deal with ${target.handle}, and what did you do?`
        : step === 2
          ? 'How did it go? Your rating helps other traders.'
          : 'Check it over before it goes live.';

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
            {stepped ? (
              <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
                Step {step} of 3
              </span>
            ) : null}
          </div>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Reference published</DialogDescription>
          )}
        </DialogHeader>
        {/* Outside the header so it spans the fields' width, as in the deal composer. */}
        {stepped ? <StepProgress steps={STEP_LABELS} current={step} /> : null}

        <Composer.Provider draft={draft}>
          {draft.done ? (
            <Composer.Published onDone={() => handleOpenChange(false)} />
          ) : !stepped ? (
            <VerifyIdGate />
          ) : (
            <>
              {/* Keyed by step so each step mounts fresh (star hover state and the like). */}
              <div key={step} className="space-y-group">
                {step === 1 ? (
                  <>
                    <Composer.Platform />
                    <Composer.Role />
                  </>
                ) : step === 2 ? (
                  <>
                    <Composer.Outcome />
                    <Composer.Comment
                      id={viewer.signedIn ? 'share-experience-comment' : 'share-experience-preview'}
                      rows={4}
                    />
                  </>
                ) : (
                  <>
                    <Composer.Summary onEdit={(editStep) => setStep(editStep as Step)} />
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
                  <Button type="button" variant="ghost" disabled={draft.pending} onClick={back}>
                    Back
                  </Button>
                )}

                {step < 3 ? (
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
                    <Link href={`/sign-in?redirectTo=${encodeURIComponent(`${returnPath}?experience=1`)}`}>
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
