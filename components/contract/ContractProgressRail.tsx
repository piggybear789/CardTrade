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

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckIcon, XIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';
import type { ContractStep } from '@/domain/contract';

export interface ContractProgressRailProps {
  steps: ContractStep[];
  /**
   * Number the ticks 1..n instead of marking them with a dot.
   *
   * REPLACED A PER-STEP ICON MAP. Four different glyphs — a pin, a truck, a box,
   * a tick — carried nothing the label beneath them did not already say, and
   * asked the reader to decode a picture to find out how far along they were.
   * A numeral answers "how many, in what order, where am I" outright.
   *
   * Completed and halted steps keep their ✓ and ✕: those say something a numeral
   * cannot.
   */
  numbered?: boolean;
  /**
   * Extra content under a step's caption, keyed by step id — a deadline, a
   * figure, a count.
   *
   * Attaches a fact to the step it belongs to instead of floating it above the
   * rail as a banner of its own. Keep them to a chip's worth: a rail column is
   * roughly a quarter of the panel.
   */
  annotations?: Record<string, ReactNode>;
  /**
   * Render each step's `caption` under its label.
   *
   * Off by default: the contract-wide rail is five or six ticks across the top of
   * a room and a second line of prose per tick turns it into a paragraph. Worth
   * turning on for a short rail that owns its surface — the four-step postage plan
   * in the Terms tab — where the captions are what make the sequence legible
   * without clicking anything.
   */
  captions?: boolean;
  className?: string;
}

/** The contract lifecycle as a row of ticks. */
export function ContractProgressRail({
  steps,
  numbered = false,
  annotations,
  captions = false,
  className,
}: ContractProgressRailProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = steps.find((step) => step.id === openId) ?? null;

  // Track which steps just completed so we can animate them.
  const prevStepsRef = useRef<Map<string, ContractStep['status']>>(new Map());
  const [justCompleted, setJustCompleted] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevStepsRef.current;
    const newlyDone = new Set<string>();

    for (const step of steps) {
      const prevStatus = prev.get(step.id);
      // A step that was NOT done and is now done = just completed.
      if (step.status === 'done' && prevStatus && prevStatus !== 'done') {
        newlyDone.add(step.id);
      }
    }

    // Update the ref for next render.
    const next = new Map<string, ContractStep['status']>();
    for (const step of steps) next.set(step.id, step.status);
    prevStepsRef.current = next;

    if (newlyDone.size > 0) {
      setJustCompleted(newlyDone);
      // Clear the animation class after it plays.
      const timeout = setTimeout(() => setJustCompleted(new Set()), 600);
      return () => clearTimeout(timeout);
    }
  }, [steps]);

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
          const animating = justCompleted.has(step.id);
          const annotation = annotations?.[step.id];

          return (
            <li key={step.id} className="flex min-w-0 flex-1 flex-col items-center">
              {/* Connector halves either side of the tick, so the line never
                  overshoots the first or last step. Only the connectors are
                  aria-hidden — the tick button itself must stay reachable. */}
              <div className="flex w-full items-center">
                <span
                  aria-hidden
                  className={cn(
                    'h-[3px] flex-1 rounded-full transition-[background-color] duration-500',
                    first
                      ? 'bg-transparent'
                      : done
                        ? 'bg-trust/60'
                        : live
                          ? 'bg-iris/60'
                          : halted
                            ? 'bg-destructive/50'
                            : 'bg-border',
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
                    'grid shrink-0 touch-manipulation place-items-center rounded-full border',
                    numbered ? 'size-7 text-meta font-semibold tabular-nums' : 'size-5',
                    'transition-[background-color,border-color,box-shadow,color] duration-300',
                    // The tick stays 20px visually, but an invisible overlay
                    // stretches the hit area to ~44px for touch guidelines.
                    "relative before:absolute before:-inset-y-3 before:inset-x-0 before:content-['']",
                    'hover:border-iris/50 hover:text-foreground',
                    'border border-transparent focus:outline-none focus-visible:border-iris',
                    done && 'cardtrade-success-chip',
                    live && 'animate-step-active border-iris bg-iris/25 text-foreground ring-2 ring-iris/25',
                    halted &&
                      'border-destructive/40 bg-destructive/10 text-destructive',
                    !done && !live && !halted && 'border-border bg-card text-muted-foreground',
                    selected && 'ring-2 ring-ring ring-offset-1',
                    animating && 'animate-step-complete',
                  )}
                >
                  {done ? (
                    <HugeiconsIcon icon={CheckIcon} className={numbered ? 'size-3.5' : 'size-3'} aria-hidden />
                  ) : halted ? (
                    <HugeiconsIcon icon={XIcon} className={numbered ? 'size-3.5' : 'size-3'} aria-hidden />
                  ) : numbered ? (
                    index + 1
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
                    'h-[3px] flex-1 rounded-full transition-[background-color] duration-500',
                    last
                      ? 'bg-transparent'
                      : steps[index + 1]?.status === 'done'
                        ? 'bg-trust/60'
                        : steps[index + 1]?.status === 'active'
                          ? 'bg-iris/60'
                          : steps[index + 1]?.status === 'halted'
                            ? 'bg-destructive/50'
                            : 'bg-border',
                  )}
                />
              </div>

              <span
                className={cn(
                  'mt-1.5 max-w-full px-1 text-meta transition-colors duration-300',
                  captions ? 'text-center' : 'truncate',
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

              {/* `text-balance` and no truncation: a caption that clips to one
                  ellipsised line tells the reader less than no caption at all. */}
              {captions && step.caption ? (
                <span className="mt-0.5 max-w-full text-balance px-1 text-center text-meta text-muted-foreground">
                  {step.caption}
                </span>
              ) : null}

              {annotation ? (
                <span className="mt-1 max-w-full px-1 text-center">{annotation}</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {open ? (
        <p
          className="mt-2 text-body text-muted-foreground"
          aria-live="polite"
        >
          <span className="font-medium text-foreground">{open.label}</span>
          {open.detail ? ` — ${open.detail}` : ''}
        </p>
      ) : null}
    </div>
  );
}
