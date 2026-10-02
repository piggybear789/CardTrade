'use client';

// components/deals/CopyDealLink.tsx
//
// Copies the shareable /t/… invite URL. Same interaction as CopyTradeLink:
// clipboard, toast, brief "Copied" label. `ticket` is the host share document:
// labeled field, then a full-width copy action — never a side-stretched pair.

import { useEffect, useState, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, LinkIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PendingLabel } from '@/components/ui/pending-label';
import { SITE_URL } from '@/lib/seo/site';

export function CopyDealLink({
  path,
  appearance = 'button',
  children,
}: {
  /** Site-relative path, e.g. `/t/abc`. */
  path: string;
  appearance?: 'button' | 'icon' | 'ticket';
  /** `ticket` only: a secondary action rendered beside the copy button. */
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  // FIRST PAINT IS THE FULL LINK. This used to start as the bare `/t/…` path and swap
  // to the absolute URL in a mount effect, so the field visibly rewrote itself after
  // the page arrived. The configured public origin is right in production; the effect
  // still corrects it where the app is served from somewhere else (local, preview).
  const [url, setUrl] = useState(`${SITE_URL}${path}`);

  useEffect(() => {
    setUrl(`${window.location.origin}${path}`);
  }, [path]);

  async function handleCopy() {
    const full = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy that link');
    }
  }

  if (appearance === 'ticket') {
    return (
      <div className="grid gap-snug">
        <Input
          aria-label="Deal link"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="text-body"
        />
        <div className="grid grid-cols-2 gap-snug">
          <Button type="button" variant="secondary" onClick={handleCopy}>
            <CopyLabel copied={copied} />
          </Button>
          {children}
        </div>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant={appearance === 'icon' ? 'ghost' : 'outline'}
      size={appearance === 'icon' ? 'sm' : 'default'}
      className={appearance === 'icon' ? 'size-10 shrink-0 p-0 lg:size-8' : undefined}
      onClick={handleCopy}
    >
      {appearance === 'icon' ? (
        <>
          {copied ? <HugeiconsIcon icon={CheckIcon} aria-hidden /> : <HugeiconsIcon icon={LinkIcon} aria-hidden />}
          <span className="sr-only">{copied ? 'Copied' : 'Copy deal link'}</span>
        </>
      ) : (
        <CopyLabel copied={copied} />
      )}
    </Button>
  );
}

/**
 * Width-stable "Copy deal link" / "Copied". The button is sized by its text, and the
 * two-second "Copied" state was ~60px narrower, so the ticket's grid cell and the
 * outline button both jumped on every copy.
 */
function CopyLabel({ copied }: { copied: boolean }) {
  return (
    <PendingLabel
      pending={copied}
      spinner={false}
      pendingLabel={
        <>
          <HugeiconsIcon icon={CheckIcon} aria-hidden />
          Copied
        </>
      }
    >
      <HugeiconsIcon icon={LinkIcon} aria-hidden />
      Copy deal link
    </PendingLabel>
  );
}
