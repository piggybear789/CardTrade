'use client';

// components/deals/DealLinkActions.tsx
//
// How the deal link is sent: the link, Copy, Share, and a QR code for a meetup.
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
// THE LINK IS NEVER SHORTENED IN ITS VALUE: a "BBgEbL…T21mxD" string that someone
// selects and pastes is a link that goes nowhere. It sits whole in a read-only field,
// which selects all of it on focus.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/ui/icon';
import { CheckIcon, CopyIcon, ExportIcon, LockIcon, QrCodeIcon } from '@/components/ui/icons';
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
  variant = 'stacked',
}: {
  /** Site-relative invite path, e.g. `/t/abc`. */
  path: string;
  /** The message the share sheet pre-fills beside the link. */
  shareText: string;
  className?: string;
  /**
   * `stacked`: field over a row of labelled buttons. `bar`: one compact row.
   * `field`: one address field with the buttons inside it, for the composer's header.
   */
  variant?: 'stacked' | 'bar' | 'field';
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
      <Icon icon={copied ? CheckIcon : CopyIcon} aria-hidden />
      {copied ? 'Copied' : 'Copy link'}
    </>
  );

  if (variant === 'field') {
    // THE BUTTONS INSIDE THE FIELD (Dribbble's and Navan's share field): one 44px
    // object, the link and what to do with it, the same height as the empty field the
    // composer shows before the link exists.
    return (
      <div
        // NO PRESSED OR FOCUSED LOOK ON THE FIELD. It is read-only and selecting the
        // link is the only thing a click does, so the dark focus edge it wore read as
        // the field being edited. The buttons inside keep their keyboard ring.
        className={cn(
          'flex h-11 min-w-0 items-center gap-tight rounded-xl border border-border bg-card pl-cozy pr-1.5 shadow-[0_1px_2px_hsl(var(--obsidian)/0.05)]',
          className,
        )}
      >
        <Icon icon={LockIcon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          readOnly
          aria-label="Deal link"
          value={shownLink}
          onFocus={(event) => event.currentTarget.select()}
          className="h-full min-w-0 flex-1 cursor-text truncate bg-transparent text-body text-foreground outline-none focus:outline-none focus-visible:outline-none"
        />
        {/* `active:translate-y-0`: no press-down on these, which jolted the field. */}
        <Button type="button" size="sm" className="h-8 shrink-0 active:translate-y-0 md:h-8" onClick={copy}>
          {copyContent}
        </Button>
        {canShare ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 active:translate-y-0 active:bg-transparent md:size-8"
            aria-label="Share link"
            onClick={share}
          >
            <Icon icon={ExportIcon} aria-hidden />
          </Button>
        ) : null}
        <DealLinkQr
          path={path}
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 active:translate-y-0 active:bg-transparent md:size-8"
              aria-label="Show QR code"
            >
              <Icon icon={QrCodeIcon} aria-hidden />
            </Button>
          }
        />
        <span role="status" className="sr-only">
          {copied ? 'Link copied' : ''}
        </span>
      </div>
    );
  }

  if (variant === 'bar') {
    // ONE ROW: the link, then Copy, Share and the QR code as icon buttons beside it
    // (Dribbble's and Navan's share field). For the composer's floating link bar,
    // where a second row of full-width buttons would cover the preview it floats on.
    return (
      <div className={cn('flex min-w-0 items-center gap-tight', className)}>
        <input
          readOnly
          aria-label="Deal link"
          value={shownLink}
          onFocus={(event) => event.currentTarget.select()}
          className="h-9 min-w-0 flex-1 truncate rounded-md border border-input bg-muted/40 px-cozy text-body text-foreground focus-visible:border-ring focus-visible:outline-none"
        />
        <Button type="button" size="sm" className="h-9 shrink-0" onClick={copy}>
          {copyContent}
        </Button>
        {canShare ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0 md:size-9"
            aria-label="Share link"
            onClick={share}
          >
            <Icon icon={ExportIcon} aria-hidden />
          </Button>
        ) : null}
        <DealLinkQr
          path={path}
          trigger={
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 shrink-0 md:size-9"
              aria-label="Show QR code"
            >
              <Icon icon={QrCodeIcon} aria-hidden />
            </Button>
          }
        />
        <span role="status" className="sr-only">
          {copied ? 'Link copied' : ''}
        </span>
      </div>
    );
  }

  return (
    // THE LINK AS A FIELD, THE ACTIONS UNDER IT (Mercury, Navan and Fresha's "link
    // ready" screens on Mobbin): the link reads as one thing to copy, the buttons share
    // one row, and the QR code is a button that opens the large one rather than a
    // small square drawn in once its encoder loads. Every part is a fixed height, so
    // nothing moves while the page hydrates.
    <div className={cn('grid gap-cozy', className)}>
      <div className="grid gap-snug">
        <p className="text-meta font-medium text-muted-foreground" id="deal-link-label">
          Deal link
        </p>
        {/* ONE LINE, the whole link in the field: a scroll inside it rather than an
            ellipsis, so selecting it copies all of it. Clicking selects it. */}
        <input
          readOnly
          aria-labelledby="deal-link-label"
          value={shownLink}
          onFocus={(event) => event.currentTarget.select()}
          className="h-10 w-full truncate rounded-md border border-input bg-muted/40 px-cozy text-body text-foreground focus-visible:border-ring focus-visible:outline-none md:h-9"
        />
      </div>

      <div className="flex gap-snug">
        <div className={cn('grid min-w-0 flex-1 gap-snug', canShare ? 'grid-cols-2' : 'grid-cols-1')}>
        {canShare ? (
          <Button type="button" size="lg" className="md:hidden" onClick={share}>
            <Icon icon={ExportIcon} aria-hidden />
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
              <Icon icon={ExportIcon} aria-hidden />
              Share
            </Button>
          </>
        ) : null}
        </div>
        <DealLinkQr
          path={path}
          trigger={
            <Button type="button" variant="outline" size="lg" className="shrink-0 px-cozy" aria-label="Show QR code">
              <Icon icon={QrCodeIcon} aria-hidden />
              <span className="max-sm:sr-only">QR code</span>
            </Button>
          }
        />
      </div>

      <span role="status" className="sr-only">
        {copied ? 'Link copied' : ''}
      </span>
    </div>
  );
}
