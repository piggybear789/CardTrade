'use client';

// components/account/ListingDraftList.tsx
//
// Saved listing drafts (0131) under My listings: what each one is, when it was last
// saved, and the two things to do with it — carry on, or throw it away.

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { deleteListingDraft, type ListingDraftSummary } from '@/lib/actions/listingDrafts';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/format';

export function ListingDraftList({ drafts }: { drafts: readonly ListingDraftSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteListingDraft(id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {drafts.map((draft) => (
        <li key={draft.id} className="flex flex-wrap items-center gap-x-group gap-y-snug px-group py-cozy">
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-foreground">{draft.title}</p>
            <p className="text-meta text-muted-foreground" suppressHydrationWarning>
              {[draft.game, `Saved ${formatRelativeTime(draft.updatedAt)}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-snug">
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(draft.id)} disabled={pending}>
              Delete
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/listings/new?draft=${draft.id}`}>Continue</Link>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
