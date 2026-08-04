'use client';

// components/contract/ContractProgressRail.tsx
//
// WHERE ARE WE. The whole lifecycle as one thin line of ticks, replacing the
// seven-row action plan that carried a marker, a label, an owner badge, a sentence of
// detail and a control on every row.
//
// It answers only one question — how far along is this — and leaves "what do I do now"
// to `ContractActionCard`. Detail is still reachable: clicking a tick reveals that
// step's line underneath, so nothing was lost, it is just no longer all on screen at
// once.
//
// Steps come from the same pure derivation in `domain/contract` that feeds the action
// card, so the two can never disagree.

import { useState } from 'react';
import { Check, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ContractStep } from '@/domain/contract';

export interface ContractProgressRailProps {
  steps: ContractStep[];
  className?: string;
}

/** The contract lifecycle as a row of ticks. */
export function ContractProgressRail({ steps, className }: ContractProgressRailProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = steps.find((step) => step.id === openId) ?? null;

  if (steps.length === 0) return null;

  return (
    <div className={cn('px-1', className)}>
      <ol className="flex items-start" aria-label="Contract progress">
        {steps.map((step, index) => {
          const done = step.status === 'done';
          const live = step.status === 'active';
          // Where a closed contract stopped. Must never render as a tick: a
          // cancelled contract showing the same success mark as a completed one was
          // the bug this state exists to fix.
          const halted = step.status === 'halted';
          const selected = openId === step.id;
          const first = index === 0;
          const last = index === steps.length - 1;

          return (
            <li key={step.id} className="flex min-w-0 flex-1 flex-col items-center">
              {/* Connector halves either side of the tick, so the line never
                  overshoots the first or last step. Only the connectors are
                  aria-hidden — the tick button itself must stay reachable. */}
              <div className="flex w-full items-center">
                <span
                  aria-hidden
                  className={cn(
                    'h-px flex-1',
                    first ? 'bg-transparent' : done ? 'cardtrade-success-fill' : 'bg-border',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setOpenId(selected ? null : step.id)}
                  aria-label={`${step.label}${
                    done
                      ? ' — complete'
                      : live
                        ? ' — current step'
                        : halted
                          ? ' — the contract ended here'
                          : ''
                  }`}
                  aria-expanded={selected}
                  className={cn(
                    'grid size-5 shrink-0 touch-manipulation place-items-center rounded-full border transition-colors',
                    // The tick stays 20px visually, but an invisible overlay
                    // stretches the hit area to ~44px for touch guidelines.
                    "relative before:absolute before:-inset-3 before:content-['']",
                    'hover:border-foreground/40 hover:text-foreground',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    done && 'cardtrade-success-chip',
                    live && 'border-gold bg-gold/25 text-foreground ring-2 ring-gold/25',
                    halted &&
                      'border-destructive/55 bg-destructive/10 text-destructive',
                    !done && !live && !halted && 'border-border bg-card text-muted-foreground',
                    selected && 'ring-2 ring-ring ring-offset-1',
                  )}
                >
                  {done ? (
                    <Check className="size-3" aria-hidden />
                  ) : halted ? (
                    <X className="size-3" aria-hidden />
                  ) : (
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        live ? 'bg-current' : 'bg-muted-foreground/40',
                      )}
                      aria-hidden
                    />
                  )}
                </button>
                <span
                  aria-hidden
                  className={cn(
                    'h-px flex-1',
                    last
                      ? 'bg-transparent'
                      : steps[index + 1]?.status === 'done'
                        ? 'cardtrade-success-fill'
                        : 'bg-border',
                  )}
                />
              </div>

              <span
                className={cn(
                  'mt-1.5 max-w-full truncate px-1 text-xs',
                  live
                    ? 'font-semibold text-foreground'
                    : halted
                      ? 'font-semibold text-destructive'
                      : done
                        ? 'font-medium text-muted-foreground'
                        : 'text-muted-foreground',
                )}
              >
                {step.short ?? step.label}
              </span>
            </li>
          );
        })}
      </ol>

      {open ? (
        <p
          className="mt-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <span className="font-medium text-foreground">{open.label}</span>
          {open.detail ? ` — ${open.detail}` : ''}
        </p>
      ) : null}
    </div>
  );
}
