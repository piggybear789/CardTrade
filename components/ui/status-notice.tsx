// components/ui/status-notice.tsx
//
// Inline status — blocked, empty, already-in-progress — as opposed to Card,
// which is for a browseable object (a seller, a listing). One chrome for every
// notice so a column of them does not grow three outlines.

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function StatusNotice({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-group rounded-lg border border-dashed border-border bg-muted px-group py-group',
        className,
      )}
    >
      {title || description ? (
        <div className="flex flex-col gap-snug">
          {title ? <p className="text-lead font-semibold">{title}</p> : null}
          {description ? (
            <div className="text-body text-muted-foreground">{description}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
