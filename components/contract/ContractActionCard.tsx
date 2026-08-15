// components/contract/ContractActionCard.tsx
//
// ONE QUESTION AT A TIME. The single card that answers "what do I do now" for any
// contract, and the only place in the room that carries a control for the live step.
//
// It replaces two things that used to coexist and said the same thing twice: the
// seven-row action plan and the separate "Your next step" section. Everything about
// the future lives in the thin `ContractProgressRail`; everything about the past lives
// in the collapsed history row. This card is only ever about NOW.
//
// The step label answers ownership in words — "Waiting for the other party to
// join" — so the card carries no eyebrow or owner badge. When it is not the
// viewer's move, the room passes no children and the card deliberately shows no
// buttons.

import type { ReactNode } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ContractStep } from '@/domain/contract';

/** Visual weight of the card, for terminal or degraded outcomes. */
export type ContractActionTone = 'default' | 'success' | 'warning' | 'danger';

const TONE: Record<ContractActionTone, string> = {
  default: 'border-gold/50 bg-gold/[0.08]',
  success: 'border-[hsl(var(--trust)/0.4)] bg-[hsl(var(--trust)/0.06)]',
  warning: 'border-gold/45 bg-gold/[0.06]',
  danger: 'border-destructive/45 bg-destructive/[0.06]',
};

export interface ContractActionCardProps {
  /** The live step. `null` once the contract is finished. */
  step: ContractStep | null;
  /** Title override, when the flow has better copy than the step label. */
  title?: string;
  /** Detail override. */
  detail?: ReactNode;
  tone?: ContractActionTone;
  /** The controls for this step. Omit when the viewer cannot act. */
  children?: ReactNode;
  className?: string;
}

/** The one card in a contract room that says what happens now. */
export function ContractActionCard({
  step,
  title,
  detail,
  tone = 'default',
  children,
  className,
}: ContractActionCardProps) {
  return (
    <Card className={cn(TONE[tone], className)}>
      <CardContent className="grid h-full gap-group p-group md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0 space-y-1">
          <h3 className="text-pretty text-subhead font-semibold leading-tight tracking-tight">
            {title ?? step?.label ?? 'This contract is finished'}
          </h3>
          {detail ?? step?.detail ? (
            <p className="max-w-3xl text-body text-muted-foreground">
              {detail ?? step?.detail}
            </p>
          ) : null}
        </div>

        {children ? (
          <div className="flex min-w-0 flex-col gap-snug md:max-w-[40rem] md:items-end">
            {children}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
