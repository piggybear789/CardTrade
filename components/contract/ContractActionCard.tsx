'use client';

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

import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ContractStep } from '@/domain/contract';

/** Visual weight of the card, for terminal or degraded outcomes. */
export type ContractActionTone = 'default' | 'success' | 'warning' | 'danger';

const TONE: Record<ContractActionTone, string> = {
  default: 'border-gold/50 bg-gold/[0.08]',
  success: 'border-[hsl(var(--trust)/0.4)] bg-[hsl(var(--trust)/0.06)]',
  warning: 'border-gold/50 bg-gold/[0.06]',
  danger: 'border-destructive/40 bg-destructive/[0.06]',
};

// The dock is a flat strip inside the chat panel, so it tints only — the
// panel's own border rules divide it from the header and the log.
const STRIP_TONE: Record<ContractActionTone, string> = {
  default: 'bg-gold/[0.08]',
  success: 'bg-[hsl(var(--trust)/0.06)]',
  warning: 'bg-gold/[0.06]',
  danger: 'bg-destructive/[0.06]',
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
  /**
   * Secondary actions for the header ⋯ menu (Cancel, Decline, and the rest).
   * Rendered to the right of the primary control.
   */
  more?: ReactNode;
  /**
   * `card` is the classic full-width banner. `dock` is the compact form used
   * inside the chat column. `header` is a quiet button cluster for the
   * identity strip — no title, no tint, just the controls.
   */
  appearance?: 'card' | 'dock' | 'header';
  className?: string;
}

function hasMenuContent(node: ReactNode): boolean {
  if (node == null || typeof node === 'boolean') return false;
  if (Array.isArray(node)) return node.some(hasMenuContent);
  if (isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment) {
    return hasMenuContent(node.props.children);
  }
  return Children.toArray(node).some((child) => {
    if (child == null || typeof child === 'boolean') return false;
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return hasMenuContent(child.props.children);
    }
    return true;
  });
}

/** ⋯ menu for secondary contract actions. Sits to the right of the primary header control. */
export function ContractOverflowMenu({ children }: { children?: ReactNode }) {
  if (!hasMenuContent(children)) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="More actions"
        >
          <MoreVertical className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <div
          className={cn(
            'flex flex-col',
            // Menu rows, not CTAs. Button CVA is semibold 14px; next to a muted
            // Report that looked like a caption, Cancel read as a heading.
            '[&_a]:h-9 [&_a]:w-full [&_a]:justify-start [&_a]:px-2.5 [&_a]:text-body [&_a]:font-medium [&_a]:text-foreground',
            '[&_button]:h-9 [&_button]:w-full [&_button]:justify-start [&_button]:px-2.5 [&_button]:text-body [&_button]:font-medium',
            '[&_svg]:size-3.5',
          )}
        >
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The one card in a contract room that says what happens now. */
export function ContractActionCard({
  step,
  title,
  detail,
  tone = 'default',
  children,
  more,
  appearance = 'card',
  className,
}: ContractActionCardProps) {
  if (appearance === 'header') {
    return (
      <div
        aria-live="polite"
        className={cn('flex items-center justify-end gap-1.5', className)}
      >
        <h3 className="sr-only">
          {title ?? step?.label ?? 'This contract is finished'}
        </h3>
        {children ? (
          <div
            className={cn(
              'flex flex-wrap items-center justify-end gap-1',
              '[&>*]:w-auto [&>a]:min-h-11 [&>button]:min-h-11 [&>button]:px-3',
              '[&_a]:min-h-11 [&_a]:px-3 [&_a]:text-body [&_button]:min-h-11 [&_button]:w-auto [&_button]:px-3 [&_button]:text-body',
              'lg:[&>a]:h-7 lg:[&>a]:min-h-7 lg:[&>button]:h-7 lg:[&>button]:min-h-7 lg:[&>button]:px-2.5',
              'lg:[&_a]:h-7 lg:[&_a]:min-h-7 lg:[&_a]:px-2.5 lg:[&_button]:h-7 lg:[&_button]:min-h-7 lg:[&_button]:px-2.5',
              '[&_svg]:size-3.5',
            )}
          >
            {children}
          </div>
        ) : null}
        <ContractOverflowMenu>{more}</ContractOverflowMenu>
      </div>
    );
  }

  if (appearance === 'dock') {
    return (
      <section
        aria-live="polite"
        className={cn(
          'space-y-snug px-cozy py-snug',
          STRIP_TONE[tone],
          className,
        )}
      >
        <div className="min-w-0">
          <h3 className="text-pretty text-lead font-semibold leading-tight tracking-tight">
            {title ?? step?.label ?? 'This contract is finished'}
          </h3>
          {detail ?? step?.detail ? (
            <p className="mt-0.5 text-body text-muted-foreground">
              {detail ?? step?.detail}
            </p>
          ) : null}
        </div>

        {children ? (
          // Controls flow inline and wrap; explanatory blocks (paragraphs,
          // banners, panels) take the full row. The height/width overrides
          // compact the room's stock buttons — the rooms pass the same
          // controls to both appearances, so the dock compresses them here
          // instead of every call site carrying a size fork.
          <div
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-snug',
              '[&>*]:min-w-0 [&>*]:w-full [&>a]:w-auto [&>button]:w-auto',
              '[&_a]:h-9 [&_button]:h-9 [&_button]:px-3',
            )}
          >
            {children}
          </div>
        ) : null}
      </section>
    );
  }

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
