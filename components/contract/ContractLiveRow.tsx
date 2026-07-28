// components/contract/ContractLiveRow.tsx
//
// The active contract area in reading order: current action and lifecycle first, then
// a bounded detail inspector beside the live conversation.

import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface ContractLiveRowProps {
  action: ReactNode;
  conversation: ReactNode;
  progress?: ReactNode;
  /** The contract's fixed-height `ContractDetailList` inspector. */
  children: ReactNode;
  className?: string;
}

/** Action and progress above the equal-height details/chat workspace. */
export function ContractLiveRow({
  action,
  conversation,
  progress,
  children,
  className,
}: ContractLiveRowProps) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-4', className)}>
      <Card className="shrink-0 overflow-hidden border-border/90 shadow-sm">
        <div className="[&>*]:rounded-none [&>*]:border-0 [&>*]:shadow-none">{action}</div>
        {progress ? (
          <div className="border-t border-border/80 bg-card px-4 py-3 sm:px-5">
            {progress}
          </div>
        ) : null}
      </Card>

      <div className="grid min-h-[48rem] gap-4 lg:min-h-[28rem] lg:flex-1 lg:grid-cols-[minmax(0,3fr)_minmax(22rem,2fr)]">
        <div className="h-[24rem] min-w-0 lg:h-auto lg:min-h-0 [&>*]:h-full">
          {children}
        </div>
        <div className="flex h-[24rem] min-w-0 flex-col lg:h-auto lg:min-h-0 [&>*]:h-full">
          {conversation}
        </div>
      </div>
    </div>
  );
}
