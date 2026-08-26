'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { cn } from '@/lib/utils';

const COLLAPSE_AT = 200;

/**
 * Listing description — four lines until the buyer asks for the rest.
 * Same expand pattern as the Flutter detail screen.
 */
export function ExpandableDescription({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const body = text.trim();
  if (!body) return null;
  const needsExpand = body.length > COLLAPSE_AT;

  return (
    <div className={className}>
      <p
        className={cn(
          'whitespace-pre-line break-words text-body leading-relaxed text-foreground',
          needsExpand && !expanded && 'line-clamp-4',
        )}
      >
        {body}
      </p>
      {needsExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-1 inline-flex min-h-10 items-center gap-0.5 rounded-sm border border-transparent text-body font-medium text-gold focus:outline-none focus-visible:border-gold/40"
        >
          {expanded ? (
            <ChevronUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
          {expanded ? 'Show less' : 'Read more'}
        </button>
      ) : null}
    </div>
  );
}
