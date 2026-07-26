'use client';

// components/deals/ShareDealLink.tsx
//
// The creator's half of the new private-deal flow: a deal is created SOLO, then
// shared as a LINK. Whoever opens the link joins as the counterparty, so this is
// the one thing the creator has to do next — keep it copyable and obvious.
//
// The absolute URL is built on the client from `window.location.origin` so the
// same component produces a working link in dev and in production without any
// base-URL config.

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Link2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ShareDealLinkProps {
  /** The deal's `share_token` — the capability behind the join link. */
  shareToken: string;
  /** Optional deal title, used only to label the field for screen readers. */
  title?: string;
  className?: string;
}

/** The join path for a share token (relative; made absolute in the browser). */
function joinPath(shareToken: string): string {
  return `/deals/join/${shareToken}`;
}

/** A read-only share URL with a copy button. */
export function ShareDealLink({ shareToken, title, className }: ShareDealLinkProps) {
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const inputId = `share-link-${shareToken.slice(0, 8)}`;

  // `window` only exists after hydration; until then show the relative path.
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const url = `${origin}${joinPath(shareToken)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copied.');
    } catch {
      // Clipboard access can be blocked (insecure context, permissions):
      // select the text so the link can still be copied by hand.
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      input?.focus();
      input?.select();
      toast.error(
        'Could not copy automatically — the link is selected. Use your copy shortcut.',
      );
    }
  }

  return (
    <div className={className}>
      <Label htmlFor={inputId} className="flex items-center gap-2">
        <Link2 className="size-4 text-primary" aria-hidden />
        {title ? `Share link for “${title}”` : 'Share link'}
      </Label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          type="text"
          value={url}
          readOnly
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 font-mono text-xs sm:text-sm"
        />
        <Button
          type="button"
          variant="outline"
          onClick={handleCopy}
          className="shrink-0"
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <p className="sr-only" aria-live="polite">
        {copied ? 'Link copied to clipboard' : ''}
      </p>
    </div>
  );
}
