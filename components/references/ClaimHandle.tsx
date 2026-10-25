'use client';

// components/references/ClaimHandle.tsx
//
// Claiming an unclaimed handle (0155) OR linking an additional handle (`mode="link"`)
// onto your own profile:
// - Discord, X: OAuth2 Authorization Code + PKCE
// - No Facebook: Facebook Login returns a display name, never a username, so it cannot
//   prove a handle. Facebook handles are claimed through Manual.
// - Instagram: Instagram DM Bot (`ND-XXXXXX` code sent to @no.ditto via DM). No ID check:
//   the DM comes from the account itself, which is the proof.
// - Manual: Submit a message + required proof screenshot(s) for staff review. Needs a
//   verified ID, because a screenshot can be faked: an unverified member is taken
//   straight into the ID check (`/api/identity/start`) and brought back to this step.

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  ExternalLinkIcon,
  ImageAdd01Icon,
  LoaderCircleIcon,
  PlusIcon,
} from '@hugeicons/core-free-icons';

import { SocialPlatformIcon } from '@/components/profile/SocialPlatformIcon';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OptionButton } from '@/components/ui/option-button';
import { PendingLabel } from '@/components/ui/pending-label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { withQuery } from '@/domain/references/address';
import { CLAIM_PLATFORMS, platformLabel, type ClaimPlatform } from '@/domain/references/reference';
import {
  checkInstagramDmClaim,
  startInstagramDmClaim,
  submitManualHandleClaim,
  type InstagramDmClaimSession,
} from '@/lib/actions/references';
import { refreshIdentityCheck } from '@/lib/actions/identity';
import { identityStartHref } from '@/lib/identity/identityStart';
import { REFERENCE_IMAGE_ACCEPT } from '@/lib/storage/referenceImagesShared';
import { uploadReferenceImage } from '@/lib/storage/uploadReferenceImage';

const MANUAL_PROOF_LIMIT = 3;

// Each way to prove a handle, with the one line that says what happens next. The hint
// is what makes this a choice rather than a row of logos: Instagram is a DM, not a
// sign-in, and Manual is a staff review, not instant.
const CLAIM_PROVIDERS = [
  {
    slug: 'instagram',
    label: 'Instagram',
    hint: 'Send a one-time code by DM',
    iconClass: 'text-[#E1306C]',
  },
  {
    slug: 'discord',
    label: 'Discord',
    hint: 'Sign in with Discord',
    iconClass: 'text-[#5865F2]',
  },
  {
    slug: 'x',
    label: 'X',
    hint: 'Sign in with X',
    iconClass: 'text-foreground',
  },
  {
    slug: 'manual',
    label: 'Manual',
    hint: 'Upload screenshots for our team to review',
    iconClass: 'text-muted-foreground',
  },
] as const;

/**
 * The ways to prove a handle ON A KNOWN PLATFORM: that platform's own route, if it has
 * one, and Manual. An Instagram DM proves an Instagram username, never a Discord one.
 */
function providersFor(platform: ClaimPlatform | null) {
  if (!platform) return CLAIM_PROVIDERS;
  return CLAIM_PROVIDERS.filter((p) => p.slug === platform || p.slug === 'manual');
}

export function ClaimHandle({
  handle,
  platform = null,
  signedIn = false,
  identityVerified = false,
  returnPath,
  mode = 'claim',
}: {
  handle: string;
  /** The platform the page's handle is on, when it says. Ignored when linking another handle. */
  platform?: ClaimPlatform | null;
  signedIn?: boolean;
  /** Whether the viewer passed the ID check. A manual claim needs it. */
  identityVerified?: boolean;
  returnPath: string;
  /** `claim` for an unclaimed handle page; `link` for linking another handle onto your own profile. */
  mode?: 'claim' | 'link';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customHandle, setCustomHandle] = useState('');
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [dmSession, setDmSession] = useState<InstagramDmClaimSession | null>(null);
  const [manualView, setManualView] = useState(false);
  const [manualMessage, setManualMessage] = useState('');
  const [manualPaths, setManualPaths] = useState<string[]>([]);
  const [manualNames, setManualNames] = useState<string[]>([]);
  const [uploadingManual, setUploadingManual] = useState(false);
  const [manualSubmitted, setManualSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dmNotice, setDmNotice] = useState<string | null>(null);
  const [dmVerified, setDmVerified] = useState(false);
  const [pending, startTransition] = useTransition();
  const manualFileRef = useRef<HTMLInputElement | null>(null);

  const isLinkMode = mode === 'link';
  const cleanHandle = (isLinkMode ? customHandle : handle).trim().replace(/^@/, '');
  const displayHandle = cleanHandle ? `@${cleanHandle}` : handle;
  // The page's handle is on a known platform; a handle typed in to link is on whichever
  // the member picks.
  const fixedPlatform = isLinkMode ? null : platform;
  const [chosenPlatform, setChosenPlatform] = useState<ClaimPlatform | null>(null);
  const manualPlatform = fixedPlatform ?? chosenPlatform;
  const providers = providersFor(fixedPlatform);
  // Where sign-in and the ID check bring a manual claim back to: this page, manual step.
  const manualResumePath = withQuery(returnPath, { claim: 'manual' });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setActiveProvider(null);
      setDmSession(null);
      setManualView(false);
      setManualMessage('');
      setManualPaths([]);
      setManualNames([]);
      setManualSubmitted(false);
      setDmNotice(null);
      setCopied(false);
      setDmVerified(false);
      setChosenPlatform(null);
    }
  };

  const selectProvider = (platform: string) => {
    setDmNotice(null);

    if (platform === 'manual') {
      if (!signedIn) {
        window.location.assign(`/sign-in?redirectTo=${encodeURIComponent(manualResumePath)}`);
        return;
      }
      // Not ID-checked yet: start the check now and come back to the manual step,
      // rather than showing a form the server would refuse.
      if (!identityVerified) {
        setActiveProvider('manual');
        window.location.assign(identityStartHref(manualResumePath));
        return;
      }
      setManualView(true);
      return;
    }

    if (platform === 'instagram') {
      if (!cleanHandle) {
        setDmNotice('Enter your Instagram @handle first.');
        return;
      }
      if (!signedIn) {
        const resumeUrl = withQuery(returnPath, { claim: 'instagram' });
        window.location.assign(`/sign-in?redirectTo=${encodeURIComponent(resumeUrl)}`);
        return;
      }
      setActiveProvider('instagram');
      startTransition(async () => {
        // `finally`, so a thrown action (a network drop, or a tab left open across a
        // deploy) cannot leave every option disabled.
        try {
          const res = await startInstagramDmClaim(cleanHandle);
          if (!res.ok) {
            setDmNotice(res.message);
            return;
          }
          if (res.data.status === 'APPROVED') {
            setDmVerified(true);
            router.refresh();
          }
          setDmSession(res.data);
        } catch {
          setDmNotice("Couldn't start the Instagram check. Refresh the page and try again.");
        } finally {
          setActiveProvider(null);
        }
      });
      return;
    }

    setActiveProvider(platform);
    const params = new URLSearchParams({
      handle: cleanHandle || '*',
      next: returnPath,
    });
    window.location.assign(`/api/oauth/claim/${platform}?${params.toString()}`);
  };

  // A sign-in claim that failed comes back as `?claimError=<reason>`. Nothing read it,
  // so a refused or unconfigured provider looked like a click that did nothing. Shown
  // once (a fixed toast id, since the page can mount more than one ClaimHandle), then
  // dropped from the URL so a refresh does not repeat it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const reason = url.searchParams.get('claimError');
    if (!reason) return;
    toast.error(reason, { id: 'claim-error' });
    url.searchParams.delete('claimError');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // Resume a claim after a round trip: back from sign-in (`?claim=instagram` or
  // `?claim=manual`), or back from the ID check (`?claim=manual&identity=complete`).
  //
  // An unverified member back from SIGN-IN with a manual claim goes straight into the ID
  // check. Back FROM the check, the form opens even if this render still says
  // unverified: `IdentityReturnRefresh` is reading the result from Stripe right now, and
  // sending them to the check again would loop. The submit re-checks either way.
  //
  // Once per mount (`resumed`), so the re-render that the read-back triggers does not
  // run it again.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !signedIn || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const claimParam = params.get('claim');
    if (claimParam === 'manual') {
      resumed.current = true;
      if (!identityVerified && params.get('identity') !== 'complete') {
        window.location.assign(identityStartHref(manualResumePath));
        return;
      }
      setOpen(true);
      setManualView(true);
      return;
    }
    // The DM step needs this page's own handle, which a link dialog does not have.
    if (claimParam !== 'instagram' || isLinkMode) return;
    resumed.current = true;
    setOpen(true);
    setActiveProvider('instagram');
    startTransition(async () => {
      try {
        const res = await startInstagramDmClaim(cleanHandle);
        if (res.ok) {
          setDmSession(res.data);
        } else {
          setDmNotice(res.message);
        }
      } catch {
        setDmNotice("Couldn't start the Instagram check. Refresh the page and try again.");
      } finally {
        setActiveProvider(null);
      }
    });
  }, [signedIn, isLinkMode, cleanHandle, identityVerified, manualResumePath]);

  const attachManualFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingManual(true);
    setDmNotice(null);
    const paths = [...manualPaths];
    const names = [...manualNames];
    for (const file of Array.from(files).slice(0, MANUAL_PROOF_LIMIT - paths.length)) {
      const res = await uploadReferenceImage('claim', file);
      if (!res.ok) {
        setDmNotice(res.message);
        break;
      }
      paths.push(res.path);
      names.push(file.name);
    }
    setManualPaths(paths);
    setManualNames(names);
    setUploadingManual(false);
  };

  const removeManualFile = (idx: number) => {
    setManualPaths((prev) => prev.filter((_, i) => i !== idx));
    setManualNames((prev) => prev.filter((_, i) => i !== idx));
  };

  const submitManual = () => {
    if (!cleanHandle) {
      setDmNotice('Enter the @handle you want to link.');
      return;
    }
    if (!manualPlatform) {
      setDmNotice('Choose the platform this handle is on.');
      return;
    }
    if (manualPaths.length === 0) {
      setDmNotice('Attach at least one image as proof of ownership.');
      return;
    }
    setDmNotice(null);
    const input = { platform: manualPlatform, handle: cleanHandle, message: manualMessage, paths: manualPaths };
    startTransition(async () => {
      // `catch`: a thrown action inside a transition reaches the error boundary and
      // would replace the page, screenshots and all.
      try {
        let res = await submitManualHandleClaim(input);
        // Refused as unverified straight after the ID check: Stripe's answer may not
        // have reached us yet. Ask Stripe directly, then try once more, so the member
        // does not lose the screenshots they just attached.
        if (!res.ok && res.error === 'identity-unverified') {
          const read = await refreshIdentityCheck();
          if (read.ok && read.data.status === 'VERIFIED') {
            res = await submitManualHandleClaim(input);
          } else if (read.ok && read.data.progress === 'PROCESSING') {
            setDmNotice('Stripe is still checking your ID. Try again in a minute.');
            return;
          }
        }
        if (!res.ok) {
          setDmNotice(res.message);
          return;
        }
        setManualSubmitted(true);
        router.refresh();
      } catch {
        setDmNotice("Couldn't submit your proof. Refresh the page and try again.");
      }
    });
  };

  const copyCode = async () => {
    if (!dmSession?.code) return;
    try {
      await navigator.clipboard.writeText(dmSession.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const checkDmNow = () => {
    if (!dmSession) return;
    setDmNotice(null);
    startTransition(async () => {
      const res = await checkInstagramDmClaim(cleanHandle);
      if (!res.ok) {
        setDmNotice(res.message);
        return;
      }
      if (res.data.verified) {
        setDmVerified(true);
        router.refresh();
      } else {
        setDmNotice(
          `We haven't spotted a DM from ${displayHandle} with ${dmSession.code} yet. Make sure you send it from ${displayHandle}.`,
        );
      }
    });
  };

  // Auto-check while the signed-in user has the Instagram DM screen open.
  //
  // ONE CHECK AT A TIME, never setInterval. Next runs a page's Server Actions one after
  // another, and this check reads the bot's whole inbox, which can take longer than the
  // interval. A 4s setInterval therefore queued checks faster than they finished, and
  // every click after it (Back, a provider, "I've sent the DM") waited behind the
  // backlog, so the dialog looked frozen with nothing clickable. The next check is now
  // scheduled only after the previous one returns, and skipped while the tab is hidden.
  useEffect(() => {
    if (!open || !dmSession || !dmSession.signedIn || dmVerified) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        try {
          const res = await checkInstagramDmClaim(cleanHandle);
          if (cancelled) return;
          if (res.ok && res.data.verified) {
            setDmVerified(true);
            router.refresh();
            return;
          }
        } catch {
          // A failed check is retried on the next tick; the member can also press
          // "I've sent the DM".
        }
      }
      if (!cancelled) timer = setTimeout(tick, 4000);
    };
    timer = setTimeout(tick, 4000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, dmSession, dmVerified, cleanHandle, router]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {isLinkMode ? (
          // FILLED: on their own page this is the owner's main action, and as an
          // outline it sat at the same weight as "Share reference link" beside it.
          <Button type="button">
            <HugeiconsIcon icon={PlusIcon} aria-hidden />
            Link another handle
          </Button>
        ) : (
          <Button type="button" variant="outline">
            Claim this account
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        {dmVerified ? (
          <div className="space-y-group py-2 text-center">
            <div className="mx-auto grid size-11 place-items-center rounded-full bg-trust/10 text-trust">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-5" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="text-body font-semibold text-foreground">{displayHandle} is now linked</p>
              <p className="text-meta text-muted-foreground">
                All references for {displayHandle} are now unified on your profile.
              </p>
            </div>
            <Button type="button" onClick={() => handleOpenChange(false)} className="w-full">
              Done
            </Button>
          </div>
        ) : manualSubmitted ? (
          <div className="space-y-group py-2 text-center">
            <div className="mx-auto grid size-11 place-items-center rounded-full bg-trust/10 text-trust">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-5" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="text-body font-semibold text-foreground">Proof submitted for {displayHandle}</p>
              <p className="text-meta text-muted-foreground">
                We&rsquo;ll review your proof and link {displayHandle} to your profile shortly.
              </p>
            </div>
            <Button type="button" onClick={() => handleOpenChange(false)} className="w-full">
              Done
            </Button>
          </div>
        ) : manualView ? (
          <>
            <DialogHeader>
              <DialogTitle>Manual verification for {displayHandle}</DialogTitle>
              <DialogDescription>
                Send a note and screenshot proof showing you own {displayHandle}
                {fixedPlatform ? ` on ${platformLabel(fixedPlatform)}` : ''} (e.g. your logged-in profile or account settings).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-group">
              {fixedPlatform ? null : (
                <div className="space-y-snug">
                  <Label>Platform</Label>
                  <div role="radiogroup" aria-label="Platform" className="grid grid-cols-2 gap-snug sm:grid-cols-4">
                    {CLAIM_PLATFORMS.map((slug) => (
                      <OptionButton
                        key={slug}
                        selected={chosenPlatform === slug}
                        onClick={() => {
                          setChosenPlatform(slug);
                          setDmNotice(null);
                        }}
                      >
                        <SocialPlatformIcon slug={slug} className="size-3.5" />
                        <span className="truncate">{platformLabel(slug)}</span>
                      </OptionButton>
                    ))}
                  </div>
                </div>
              )}

              {isLinkMode ? (
                <div className="space-y-snug">
                  <Label htmlFor="manual-handle-input">Handle</Label>
                  <Input
                    id="manual-handle-input"
                    value={customHandle}
                    onChange={(event) => {
                      setCustomHandle(event.target.value);
                      setDmNotice(null);
                    }}
                    placeholder="@yourhandle"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              ) : null}

              <div className="space-y-snug">
                <Label htmlFor="manual-claim-message">Message</Label>
                <Textarea
                  id="manual-claim-message"
                  value={manualMessage}
                  onChange={(event) => setManualMessage(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="What does your screenshot show?"
                  className="resize-none"
                />
              </div>

              <div className="space-y-snug">
                <Label>Proof images (required)</Label>
                <input
                  ref={manualFileRef}
                  type="file"
                  accept={REFERENCE_IMAGE_ACCEPT}
                  multiple
                  onChange={(event) => {
                    void attachManualFiles(event.target.files);
                    event.target.value = '';
                  }}
                  className="sr-only"
                />
                <div className="flex flex-wrap items-center gap-snug">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingManual || manualNames.length >= MANUAL_PROOF_LIMIT}
                    onClick={() => manualFileRef.current?.click()}
                  >
                    <HugeiconsIcon icon={ImageAdd01Icon} aria-hidden />
                    {uploadingManual
                      ? 'Uploading…'
                      : manualNames.length > 0
                        ? `Add image (${manualNames.length}/${MANUAL_PROOF_LIMIT})`
                        : 'Add image'}
                  </Button>

                  {manualNames.map((name, idx) => (
                    <span
                      key={`${name}-${idx}`}
                      className="inline-flex max-w-[160px] items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-meta text-foreground"
                    >
                      <span className="truncate">{name}</span>
                      <button
                        type="button"
                        onClick={() => removeManualFile(idx)}
                        aria-label={`Remove ${name}`}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} className="size-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {dmNotice ? (
                <p role="alert" className="text-meta text-destructive">
                  {dmNotice}
                </p>
              ) : null}
            </div>

            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setManualView(false);
                  setDmNotice(null);
                }}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
                Back
              </Button>
              <Button
                type="button"
                disabled={pending || uploadingManual || manualPaths.length === 0}
                onClick={submitManual}
              >
                <PendingLabel pending={pending} pendingLabel="Submitting…">
                  Submit proof
                </PendingLabel>
              </Button>
            </DialogFooter>
          </>
        ) : dmSession ? (
          <>
            <DialogHeader>
              <DialogTitle>Verify {displayHandle} via Instagram DM</DialogTitle>
              <DialogDescription>
                Send this one-time code from <span className="font-medium text-foreground">{displayHandle}</span> to{' '}
                <span className="font-medium text-foreground">@{dmSession.botHandle}</span> on Instagram. Works with personal and professional accounts.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-cozy">
              {/* The code is issued per member, so a visitor gets one only after signing in. */}
              {dmSession.code ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3.5 py-2.5">
                  <code className="font-mono text-subhead font-semibold tracking-wider text-foreground">
                    {dmSession.code}
                  </code>
                  <Button type="button" variant="outline" size="sm" onClick={copyCode}>
                    <HugeiconsIcon icon={Copy01Icon} aria-hidden />
                    {copied ? 'Copied' : 'Copy code'}
                  </Button>
                </div>
              ) : (
                <p className="rounded-md border border-input bg-muted/40 px-3.5 py-2.5 text-body text-muted-foreground">
                  Sign in to get your one-time code. It&rsquo;s unique to your account.
                </p>
              )}

              <Button asChild variant="outline" className="w-full justify-between">
                <a
                  href={`https://ig.me/m/${encodeURIComponent(dmSession.botHandle)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="inline-flex items-center gap-2.5">
                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-[#E1306C]/10 text-[#E1306C]">
                      <SocialPlatformIcon slug="instagram" className="size-3.5" />
                    </span>
                    DM @{dmSession.botHandle} on Instagram
                  </span>
                  <HugeiconsIcon icon={ExternalLinkIcon} className="size-4 text-muted-foreground" aria-hidden />
                </a>
              </Button>

              {dmNotice ? (
                <p role="status" className="text-meta text-muted-foreground">
                  {dmNotice}
                </p>
              ) : null}
            </div>

            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDmSession(null);
                  setDmNotice(null);
                }}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
                Back
              </Button>

              {dmSession.signedIn ? (
                <Button type="button" disabled={pending} onClick={checkDmNow}>
                  <PendingLabel pending={pending} pendingLabel="Checking DM…">
                    I&rsquo;ve sent the DM
                  </PendingLabel>
                </Button>
              ) : (
                <Button asChild>
                  <Link href={`/sign-in?redirectTo=${encodeURIComponent(returnPath)}`}>
                    Sign in to verify DM
                  </Link>
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{isLinkMode ? 'Link another handle' : `Claim ${handle}`}</DialogTitle>
              <DialogDescription>
                {isLinkMode
                  ? 'Bring the references from another handle you own onto your profile.'
                  : `Verify ownership of ${handle} to link its references to your profile.`}
              </DialogDescription>
            </DialogHeader>

            {isLinkMode ? (
              <div className="space-y-snug">
                <Label htmlFor="link-handle-input">Handle</Label>
                <Input
                  id="link-handle-input"
                  value={customHandle}
                  onChange={(event) => {
                    setCustomHandle(event.target.value);
                    setDmNotice(null);
                  }}
                  placeholder="@yourhandle"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            ) : null}

            {/* BORDERLESS ROWS, NOT BOXED TILES. Five outlined squares read as a form
                grid; a short stack of softly filled rows, each saying what it will do,
                reads as the sign-in choice it is. The fill carries the hit area, so no
                row needs an edge of its own. */}
            <div className="flex flex-col gap-1.5">
              {providers.map((p) => {
                const isConnecting = activeProvider === p.slug;
                return (
                  <button
                    key={p.slug}
                    type="button"
                    disabled={activeProvider !== null || pending}
                    onClick={() => selectProvider(p.slug)}
                    aria-busy={isConnecting || undefined}
                    className={cn(
                      'group flex min-h-12 w-full items-center gap-cozy rounded-lg bg-muted/60 px-cozy py-2.5 text-left transition-colors',
                      'hover:bg-muted',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      'disabled:pointer-events-none',
                      // Only the rows NOT being opened fade, so the chosen one stays legible.
                      activeProvider !== null && !isConnecting && 'opacity-50',
                    )}
                  >
                    <span className={cn('inline-flex size-5 shrink-0 items-center justify-center', p.iconClass)}>
                      {p.slug === 'manual' ? (
                        <HugeiconsIcon icon={ImageAdd01Icon} className="size-5" aria-hidden />
                      ) : (
                        <SocialPlatformIcon slug={p.slug} className="size-5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-foreground">{p.label}</span>
                      <span className="block truncate text-meta text-muted-foreground">{p.hint}</span>
                    </span>
                    {isConnecting ? (
                      <HugeiconsIcon
                        icon={LoaderCircleIcon}
                        className="size-4 shrink-0 animate-spin text-muted-foreground"
                        aria-hidden
                      />
                    ) : (
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {dmNotice ? (
              <p role="alert" className="text-meta text-destructive">
                {dmNotice}
              </p>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
