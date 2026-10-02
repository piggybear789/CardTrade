'use client';

// components/deals/DealLinkActions.tsx
//
// The stub of the deal ticket: the QR code, the link, and the ways to send it.
//
// THE FIRST ACTION FOLLOWS THE DEVICE. On a phone the link nearly always goes into
// the chat where the deal was agreed, so Share leads and opens the share sheet, with
// Copy beside it. From `md` up Copy leads and Share sits beside it instead. Each
// breakpoint shows exactly one "Copy link".
//
// SHARE IS ASSUMED UNTIL THE BROWSER SAYS OTHERWISE. Mainstream phone browsers and
// most desktop ones have a share sheet; Firefox does not. The server renders Share,
// and a browser without `navigator.share` drops it after hydration, leaving Copy the
// whole row. Assuming the opposite would move the buttons for nearly everyone.
//
// THE LINK IS SHOWN WHOLE AND WRAPS, never shortened in the text: a
// "BBgEbL…T21mxD" string that someone selects and pastes is a link that goes
// nowhere.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, Copy01Icon, Share08Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { DealLinkQr } from '@/components/deals/DealLinkQr';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Server HTML has no `window`, so the displayed link starts from the configured site
// and settles on the real origin (a preview deploy, localhost) once hydrated.
const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://noditto.app').replace(
  /\/+$/,
  '',
);

function subscribeNever() {
  return () => {};
}

export function DealLinkActions({
  path,
  shareText,
  className,
}: {
  /** Site-relative invite path, e.g. `/t/abc`. */
  path: string;
  /** The message the share sheet pre-fills beside the link. */
  shareText: string;
  className?: string;
}) {
  const origin = useSyncExternalStore(
    subscribeNever,
    () => window.location.origin,
    () => SITE_ORIGIN,
  );
  const canShare = useSyncExternalStore(
    subscribeNever,
    () => typeof navigator.share === 'function',
    () => true,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const shownLink = `${origin.replace(/^https?:\/\//, '')}${path}`;

  async function copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      return true;
    } catch {
      toast.error('Could not copy that link');
      return false;
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: 'NoDitto deal',
        text: shareText,
        url: `${window.location.origin}${path}`,
      });
    } catch (error) {
      // Closing the sheet is a choice, not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // A sheet that refuses the payload still leaves the member a link to send.
      if (await copy()) toast.success('Link copied');
    }
  }

  const copyContent = (
    <>
      <HugeiconsIcon icon={copied ? CheckIcon : Copy01Icon} aria-hidden />
      {copied ? 'Copied' : 'Copy link'}
    </>
  );

  return (
    // THE BUTTONS MOVE WITH THE WIDTH. Below `sm` they take a full-width row under the
    // code and the link, where two side by side still get a comfortable target; from
    // `sm` the stub is wide enough to keep them in the link's column, beside the code.
    <div
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-group gap-y-cozy',
        "[grid-template-areas:'qr_link'_'actions_actions'] sm:[grid-template-areas:'qr_link'_'qr_actions']",
        className,
      )}
    >
      <div className="[grid-area:qr]">
        <DealLinkQr path={path} />
      </div>

      <div className="grid min-w-0 gap-tight [grid-area:link]">
        <p className="text-meta font-medium text-muted-foreground">Scan it, or send the link</p>
        <p title={shownLink} className="select-all break-all text-body">
          {shownLink}
        </p>
      </div>

      <div
        className={cn(
          'grid gap-snug [grid-area:actions]',
          canShare ? 'grid-cols-2' : 'grid-cols-1',
        )}
      >
        {canShare ? (
          <Button type="button" size="lg" className="md:hidden" onClick={share}>
            <HugeiconsIcon icon={Share08Icon} aria-hidden />
            Share link
          </Button>
        ) : null}
        <Button
          type="button"
          size="lg"
          className={canShare ? 'max-md:hidden' : undefined}
          onClick={copy}
        >
          {copyContent}
        </Button>
        {canShare ? (
          <>
            <Button type="button" variant="outline" size="lg" className="md:hidden" onClick={copy}>
              {copyContent}
            </Button>
            <Button type="button" variant="outline" size="lg" className="max-md:hidden" onClick={share}>
              <HugeiconsIcon icon={Share08Icon} aria-hidden />
              Share
            </Button>
          </>
        ) : null}
      </div>

      <span role="status" className="sr-only">
        {copied ? 'Link copied' : ''}
      </span>
    </div>
  );
}
