'use client';

// components/deals/CopyDealLink.tsx
//
// Copies the shareable /t/… invite URL. Same interaction as CopyTradeLink:
// clipboard, brief "Copied" label. The host's link screen has its own block for
// sending a link (`DealLinkActions`); this is the single control for lists.

import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, LinkIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export function CopyDealLink({
  path,
  appearance = 'button',
}: {
  /** Site-relative path, e.g. `/t/abc`. */
  path: string;
  appearance?: 'button' | 'icon';
}) {
  const [copied, setCopied] = useState(false);

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

  return (
    <Button
      type="button"
      variant={appearance === 'icon' ? 'ghost' : 'outline'}
      size={appearance === 'icon' ? 'sm' : 'default'}
      className={appearance === 'icon' ? 'size-10 shrink-0 p-0 lg:size-8' : undefined}
      onClick={handleCopy}
    >
      {copied ? <HugeiconsIcon icon={CheckIcon} aria-hidden /> : <HugeiconsIcon icon={LinkIcon} aria-hidden />}
      {appearance === 'icon' ? (
        <span className="sr-only">{copied ? 'Copied' : 'Copy deal link'}</span>
      ) : copied ? (
        'Copied'
      ) : (
        'Copy deal link'
      )}
    </Button>
  );
}
