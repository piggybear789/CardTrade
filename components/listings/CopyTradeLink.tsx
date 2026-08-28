// components/listings/CopyTradeLink.tsx
//
// A client button that copies a shareable "propose trade" URL to the clipboard.
// Shown to the listing owner so they can send the link to a potential trading
// partner directly (e.g. via DMs, socials, or deal rooms). The link opens the
// trade proposal form pre-targeted at this item.

'use client';

import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, LinkIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface CopyTradeLinkProps {
  itemId: string;
  className?: string;
}

export function CopyTradeLink({ itemId, className }: CopyTradeLinkProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}/trades/new?counterpartItemId=${itemId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  }

  return (
    <Button
      variant="outline"
      className={className ?? 'w-full sm:w-auto'}
      onClick={handleCopy}
      aria-label={copied ? 'Trade link copied' : 'Copy trade link'}
    >
      {copied ? <HugeiconsIcon icon={CheckIcon} aria-hidden /> : <HugeiconsIcon icon={LinkIcon} aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
