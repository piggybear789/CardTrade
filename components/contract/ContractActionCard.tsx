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
// The heading answers ownership in words — "Your move", "Waiting on Ada" — which is
// why the room no longer needs per-step owner badges or consent ticks on the party
// line. When it is not the viewer's move, the room passes no children and the card
// deliberately shows no buttons.

import type { ReactNode } from 'react';
import { Check, Clock, Loader2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ContractStep } from '@/domain/contract';

/** Visual weight of the card, for terminal or degraded outcomes. */
export type ContractActionTone = 'default' | 'success' | 'warning' | 'danger';

const TONE: Record<ContractActionTone, { card: string; eyebrow: string }> = {
  default: { card: 'border-gold/50 bg-gold/[0.08]', eyebrow: 'text-gold' },
  success: {
    card: 'border-[hsl(var(--trust)/0.4)] bg-[hsl(var(--trust)/0.06)]',
    eyebrow: 'text-trust',
  },
  warning: {
    card: 'border-gold/45 bg-gold/[0.06]',
    eyebrow: 'text-gold',
  },
  danger: {
    card: 'border-destructive/45 bg-destructive/[0.06]',
    eyebrow: 'text-destructive',
  },
};

export interface ContractActionCardProps {
  /** The live step. `null` once the contract is finished. */
  step: ContractStep | null;
  /** The other party's name, for the "Waiting on …" heading. */
  counterpartyName: string;
  /**
   * Heading override. Use for terminal states where ownership is not the point
   * ("Sale complete", "Contract cancelled").
   */
  eyebrow?: string;
  /** Title override, when the flow has better copy than the step label. */
  title?: string;
  /** Detail override. */
  detail?: ReactNode;
  tone?: ContractActionTone;
  /** The controls for this step. Omit when the viewer cannot act. */
  children?: ReactNode;
  className?: string;
}

/** Heading for the live step, phrased as whose move it is. */
function eyebrowFor(step: ContractStep | null, counterpartyName: string): string {
  if (!step) return 'Nothing to do';
  switch (step.owner) {
    case 'you':
    case 'both':
      return 'To do';
    case 'them':
      return `Waiting on ${counterpartyName}`;
    case 'platform':
      return 'In progress';
  }
}

/** Glyph matching the heading, so ownership reads at a glance too. */
function OwnerGlyph({ step }: { step: ContractStep | null }) {
  if (!step) return <Check className="size-4" aria-hidden />;
  if (step.owner === 'you') return <Clock className="size-4" aria-hidden />;
  if (step.owner === 'platform') {
    return <Loader2 className="size-4 animate-spin" aria-hidden />;
  }
  return <Clock className="size-4" aria-hidden />;
}

/** The one card in a contract room that says what happens now. */
export function ContractActionCard({
  step,
  counterpartyName,
  eyebrow,
  title,
  detail,
  tone = 'default',
  children,
  className,
}: ContractActionCardProps) {
  const palette = TONE[tone];
  const heading = eyebrow ?? eyebrowFor(step, counterpartyName);

  return (
    <Card className={cn(palette.card, className)}>
      <CardContent className="grid h-full gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0 space-y-1.5">
          <p
            className={cn(
              'flex items-center gap-1.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em]',
              palette.eyebrow,
            )}
          >
            <OwnerGlyph step={step} />
            {heading}
          </p>

          <div className="min-w-0 space-y-1">
            <h3 className="text-pretty text-lg font-semibold leading-tight tracking-tight">
              {title ?? step?.label ?? 'This contract is finished'}
            </h3>
            {detail ?? step?.detail ? (
              <p className="max-w-3xl text-sm leading-5 text-muted-foreground">
                {detail ?? step?.detail}
              </p>
            ) : null}
          </div>
        </div>

        {children ? (
          <div className="flex min-w-0 flex-col gap-2 md:max-w-[40rem] md:items-end">
            {children}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
