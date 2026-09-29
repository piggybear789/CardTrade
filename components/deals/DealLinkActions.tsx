'use client';

// components/deals/DealLinkActions.tsx
//
// Sending a deal link: share it, copy it, or show it as a QR code.
//
// THE FIRST ACTION FOLLOWS THE DEVICE. On a phone the link nearly always goes into
// the chat where the deal was agreed, so Share leads and opens the share sheet, with
// Copy and QR code paired under it. From `md` up Copy leads and Share pairs with QR
// code instead. Each breakpoint shows exactly one "Copy link".
//
// SHARE IS ASSUMED UNTIL THE BROWSER SAYS OTHERWISE. Mainstream phone browsers and
// most desktop ones have a share sheet; Firefox does not. The server renders Share,
// and a browser without `navigator.share` drops it after hydration, leaving QR code
// the whole row. Assuming the opposite would move the buttons for nearly everyone.
//
// THE LINK IS SHOWN WHOLE AND CLIPPED BY CSS, never shortened in the text: a
// "BBgEbL…T21mxD" string that someone selects and pastes is a link that goes
// nowhere.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, Copy01Icon, Share08Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { DealLinkQrButton } from '@/components/deals/DealLinkQrButton';
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
    <div className={cn('grid content-start gap-snug md:rounded-lg md:border md:p-group', className)}>
      <p className="text-meta font-medium text-muted-foreground max-md:hidden">Send it</p>
      <p
        title={shownLink}
        className="flex h-9 select-all items-center rounded-md border px-cozy max-md:hidden"
      >
        <span className="min-w-0 truncate font-mono text-body">{shownLink}</span>
      </p>

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

      <div className="grid grid-cols-2 gap-snug">
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
        <DealLinkQrButton path={path} className={canShare ? undefined : 'col-span-2'} />
      </div>

      {/* The phone's one line of link, under the buttons it belongs to. Tapping it
          copies, which is what a tap on a link-shaped line is expected to do. */}
      <button
        type="button"
        onClick={copy}
        title={shownLink}
        className="flex min-w-0 max-w-full items-center justify-center gap-tight justify-self-center rounded-md px-snug py-tight text-meta text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-iris md:hidden"
      >
        <span className="min-w-0 truncate font-mono">{shownLink}</span>
        <HugeiconsIcon icon={copied ? CheckIcon : Copy01Icon} className="size-3.5 shrink-0" aria-hidden />
      </button>

      <span role="status" className="sr-only">
        {copied ? 'Link copied' : ''}
      </span>
    </div>
  );
}
