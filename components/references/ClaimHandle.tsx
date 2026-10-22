'use client';

// components/references/ClaimHandle.tsx
//
// Claiming an unclaimed handle (0155) OR linking an additional handle (`mode="link"`)
// onto your own profile:
// - Discord, X, Facebook: OAuth2 Authorization Code + PKCE
// - Instagram: Instagram DM Bot (`ND-XXXXXX` code sent to @no.ditto via DM)
// - Manual: Submit a message + required proof screenshot(s) for staff review

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  ExternalLinkIcon,
  ImageAdd01Icon,
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
import { optionTileClass } from '@/components/ui/option-button';
import { PendingLabel } from '@/components/ui/pending-label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  checkInstagramDmClaim,
  startInstagramDmClaim,
  submitManualHandleClaim,
  type InstagramDmClaimSession,
  type MyHandleClaim,
} from '@/lib/actions/references';
import { REFERENCE_IMAGE_ACCEPT } from '@/lib/storage/referenceImagesShared';
import { uploadReferenceImage } from '@/lib/storage/uploadReferenceImage';

const MANUAL_PROOF_LIMIT = 3;

const CLAIM_PROVIDERS = [
  {
    slug: 'instagram',
    label: 'Instagram',
    badgeClass: 'bg-[#E1306C]/10 text-[#E1306C]',
  },
  {
    slug: 'discord',
    label: 'Discord',
    badgeClass: 'bg-[#5865F2]/10 text-[#5865F2]',
  },
  {
    slug: 'x',
    label: 'X',
    badgeClass: 'bg-foreground/[0.07] text-foreground',
  },
  {
    slug: 'facebook',
    label: 'Facebook',
    badgeClass: 'bg-[#1877F2]/10 text-[#1877F2]',
  },
  {
    slug: 'manual',
    label: 'Manual',
    badgeClass: 'bg-iris/12 text-iris-ink',
  },
] as const;

export function ClaimHandle({
  handle,
  signedIn = false,
  initialClaim,
  returnPath,
  mode = 'claim',
}: {
  handle: string;
  signedIn?: boolean;
  identityVerified?: boolean;
  initialClaim?: MyHandleClaim | null;
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
    }
  };

  const selectProvider = (platform: string) => {
    setDmNotice(null);

    if (platform === 'manual') {
      if (!signedIn) {
        const resumeUrl = `${returnPath}?claim=manual`;
        window.location.assign(`/sign-in?redirectTo=${encodeURIComponent(resumeUrl)}`);
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
        const resumeUrl = `${returnPath}?claim=instagram`;
        window.location.assign(`/sign-in?redirectTo=${encodeURIComponent(resumeUrl)}`);
        return;
      }
      setActiveProvider('instagram');
      startTransition(async () => {
        const res = await startInstagramDmClaim(cleanHandle);
        setActiveProvider(null);
        if (!res.ok) {
          setDmNotice(res.message);
          return;
        }
        if (res.data.status === 'APPROVED') {
          setDmVerified(true);
          router.refresh();
        }
        setDmSession(res.data);
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

  // Auto-open the Instagram DM or Manual claim step when returning from sign-in (`?claim=instagram` or `?claim=manual`)
  useEffect(() => {
    if (!signedIn || isLinkMode || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const claimParam = params.get('claim');
    if (claimParam === 'manual') {
      setOpen(true);
      setManualView(true);
      return;
    }
    if (claimParam !== 'instagram') return;
    setOpen(true);
    setActiveProvider('instagram');
    startTransition(async () => {
      const res = await startInstagramDmClaim(cleanHandle);
      setActiveProvider(null);
      if (res.ok) {
        setDmSession(res.data);
      } else {
        setDmNotice(res.message);
      }
    });
  }, [signedIn, isLinkMode, cleanHandle]);

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
    if (manualPaths.length === 0) {
      setDmNotice('Attach at least one image as proof of ownership.');
      return;
    }
    setDmNotice(null);
    startTransition(async () => {
      const res = await submitManualHandleClaim({
        handle: cleanHandle,
        message: manualMessage,
        paths: manualPaths,
      });
      if (!res.ok) {
        setDmNotice(res.message);
        return;
      }
      setManualSubmitted(true);
      router.refresh();
    });
  };

  const copyCode = async () => {
    if (!dmSession) return;
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

  // Auto-poll every 4s while the signed-in user has the Instagram DM screen open
  useEffect(() => {
    if (!open || !dmSession || !dmSession.signedIn || dmVerified) return;
    const timer = setInterval(async () => {
      const res = await checkInstagramDmClaim(cleanHandle);
      if (res.ok && res.data.verified) {
        setDmVerified(true);
        router.refresh();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [open, dmSession, dmVerified, cleanHandle, router]);

  // AFTER every hook, never before: returning early above them changed the number of
  // hooks React saw between renders, which it reports as a crash.
  if (mode === 'claim' && initialClaim?.status === 'APPROVED') return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {isLinkMode ? (
          <Button type="button" variant="outline">
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
                Send a note and screenshot proof showing you own {displayHandle} (e.g. your logged-in profile or account settings).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-group">
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
                    placeholder="@serialcollect"
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
                  placeholder="Which platform is this handle on, and what does your screenshot show?"
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
                size="sm"
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
              <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3.5 py-2.5">
                <code className="font-mono text-subhead font-semibold tracking-wider text-foreground">
                  {dmSession.code}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={copyCode}>
                  <HugeiconsIcon icon={Copy01Icon} aria-hidden />
                  {copied ? 'Copied' : 'Copy code'}
                </Button>
              </div>

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
                size="sm"
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
                  ? 'Unify references from another handle (e.g. @serial_collect on Instagram and @serialcollect on eBay) onto your profile.'
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
                  placeholder="@serial_collect"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            ) : null}

            <div className="grid grid-cols-5 gap-2">
              {CLAIM_PROVIDERS.map((p) => {
                const isConnecting = activeProvider === p.slug;
                return (
                  <button
                    key={p.slug}
                    type="button"
                    disabled={activeProvider !== null || pending}
                    onClick={() => selectProvider(p.slug)}
                    className={cn(
                      'flex aspect-square flex-col items-center justify-center gap-1.5 p-2',
                      optionTileClass(false),
                    )}
                  >
                    <span
                      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md ${p.badgeClass}`}
                    >
                      {p.slug === 'manual' ? (
                        <HugeiconsIcon icon={ImageAdd01Icon} className="size-4" aria-hidden />
                      ) : (
                        <SocialPlatformIcon slug={p.slug} className="size-4" />
                      )}
                    </span>
                    <span className="max-w-full truncate text-meta">
                      {isConnecting ? '…' : p.label}
                    </span>
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
