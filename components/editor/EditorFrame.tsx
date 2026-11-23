// components/editor/EditorFrame.tsx
//
// The pieces of the full-screen editors (`/deals`, `/listings/new`, the listing
// edit page) that are the same in each: the footer that holds the actions under the
// form, the line beside them, and a screen's heading. Moved out of `DealComposeForm`
// so the two editors cannot drift apart.
//
// NOT `'use client'`: nothing here holds state, and a server component that read the
// constants from a client module would get a client reference instead of the value.

import type { ReactNode, RefObject } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Tick02Icon, XIcon } from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';

/** The editor's own top bar sticks under the site header and its 1px rule. */
export const EDITOR_TOOLBAR_TOP = 'calc(var(--chrome-top) + 1px)';

/**
 * From `lg` an editor is exactly one screen: the site header, the editor bar and
 * this grid fill the viewport, so the document never scrolls and each pane manages
 * its own height.
 */
export const EDITOR_GRID_HEIGHT = 'lg:h-[calc(100dvh-var(--chrome-top)-1px-3.5rem)]';

/**
 * The same, for an editor with no `EditorBar` (the listing editor): the site header
 * and the grid fill the viewport.
 */
export const EDITOR_GRID_HEIGHT_BARLESS = 'lg:h-[calc(100dvh-var(--chrome-top)-1px)]';

/**
 * The form's footer: the reason the action is disabled on the left, Back and the
 * action on the right (Mercury's and Airtasker's editors), at the form's own width so
 * the buttons line up with the fields above them. Sticky at the bottom of the screen
 * below `lg`; from `lg` the form column holds it at its foot. Outside the workspace
 * there is no hub bar to clear, only the home-indicator inset.
 */
export function ActionFooter({
  note,
  error,
  className,
  children,
}: {
  note: ReactNode;
  error: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-20 shrink-0 border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-cozy sm:px-6 md:px-8 lg:static lg:px-10 lg:py-group',
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-snug sm:flex-row sm:items-center sm:gap-group">
        <ActionNote error={error} className="sm:min-w-0 sm:flex-1">
          {note}
        </ActionNote>
        <div className="flex gap-snug">{children}</div>
      </div>
    </div>
  );
}

/** The line beside the action: what is still missing, or what went wrong. */
export function ActionNote({
  error,
  className,
  children,
}: {
  error: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      role={error ? 'alert' : undefined}
      aria-live="polite"
      className={cn(
        'min-h-[1lh] text-pretty text-meta',
        error ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {children}
    </p>
  );
}

/** One step of an editor's step tabs. */
export interface EditorStep {
  label: string;
  /** Shows a tick in place of the number. */
  done: boolean;
  /** Whether the step can be opened yet. */
  enabled: boolean;
}

/**
 * An editor's screens as numbered tabs above the form (Contra's Details / Content):
 * an underline on the open one and a tick on a finished one.
 */
export function EditorSteps({
  steps,
  current,
  onSelect,
  disabled,
}: {
  steps: readonly EditorStep[];
  /** The open step's index. */
  current: number;
  onSelect: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <nav aria-label="Steps">
      <ol className="flex border-b border-border">
        {steps.map((step, index) => {
          const open = index === current;
          return (
            <li key={step.label} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onSelect(index)}
                disabled={disabled || !step.enabled}
                aria-current={open ? 'step' : undefined}
                className={cn(
                  // `-mb-px` lays the 2px marker over the list's own hairline.
                  '-mb-px flex w-full min-w-0 items-center gap-snug border-b-2 pb-cozy pt-tight text-left text-body font-medium transition-colors focus:outline-none focus-visible:border-ring disabled:cursor-not-allowed',
                  open
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground enabled:hover:text-foreground disabled:opacity-60',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full text-meta font-semibold tabular-nums',
                    open || step.done
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {step.done ? <HugeiconsIcon icon={Tick02Icon} className="size-3.5" /> : index + 1}
                </span>
                <span className="truncate">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A screen's title and line, with focus moving to the title when the screen opens. */
export function ScreenHeading({
  headingRef,
  title,
  description,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  title: string;
  description: string;
}) {
  return (
    <header className="space-y-tight">
      {/* `tabIndex={-1}`: focus moves here when the screen opens. Never in the tab
          order. */}
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-balance text-head font-bold tracking-[-0.02em] text-foreground focus:outline-none"
      >
        {title}
      </h2>
      <p className="text-pretty text-body text-muted-foreground">{description}</p>
    </header>
  );
}

/**
 * The page's `<h1>` and line at the top of the form column, with the editor's close
 * beside the title from `md` (on a phone the site's back strip closes). Used in place
 * of `EditorBar` where the bar would hold nothing but a close and a name, so the
 * one-screen editor keeps that height. The close is pulled out of the line box
 * (`-my-1.5`) so the 36px target does not push the description away from the title;
 * the step tabs that follow are spaced by the caller's column.
 */
export function EditorPageHeader({
  title,
  description,
  onClose,
  closeLabel = 'Close',
  className,
}: {
  title: string;
  description: string;
  onClose: () => void;
  closeLabel?: string;
  className?: string;
}) {
  return (
    <header className={cn('space-y-tight', className)}>
      <div className="flex items-center gap-cozy">
        <h1 className="min-w-0 flex-1 text-balance text-head font-bold tracking-[-0.025em] text-foreground">
          {title}
        </h1>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
          className="-my-1.5 -mr-2 hidden size-9 shrink-0 place-items-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:border-ring md:grid"
        >
          <HugeiconsIcon icon={XIcon} className="size-5" aria-hidden />
        </button>
      </div>
      <p className="text-pretty text-body text-muted-foreground">{description}</p>
    </header>
  );
}

/**
 * The editor's own top bar, from `md`: close, the page's name, and whatever the
 * page puts on the right. The form's actions are NOT here: they sit in the footer
 * under the fields they act on (`ActionFooter`). On a phone the site's own back strip
 * tops the page instead.
 */
export function EditorBar({
  title,
  onClose,
  closeLabel = 'Close',
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  /** The rest of the bar after the title: a status badge, the right-hand actions. */
  children?: ReactNode;
}) {
  return (
    <div
      style={{ top: EDITOR_TOOLBAR_TOP }}
      className="sticky z-30 hidden h-14 items-center gap-cozy border-b border-border bg-background px-6 md:flex"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="grid size-9 shrink-0 place-items-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:border-ring"
      >
        <HugeiconsIcon icon={XIcon} className="size-5" aria-hidden />
      </button>
      <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
      <p className="min-w-0 truncate text-body font-medium text-foreground">{title}</p>
      {children}
    </div>
  );
}

/**
 * The canvas, from `lg`: a tinted pane the full height of the editor with a faint dot
 * grid (Whop's canvas), so it reads as a surface the preview sits on.
 */
export const EDITOR_CANVAS_CLASS =
  'hidden min-h-0 border-l border-border bg-muted/60 bg-[radial-gradient(hsl(var(--foreground)/0.07)_1px,transparent_1px)] [background-size:16px_16px] lg:flex lg:flex-col';

/**
 * One option of a radio group, as a card in one row (the deal type, the listing kind): a glyph, the name and a line under it,
 * and a radio mark at the end. One row rather than stacked, so the deal screen fits
 * beside the preview. Selected is an ink edge and a filled glyph, so it does not rest
 * on a tint alone. The native radio stays inside the label, so a click anywhere on
 * the card picks it and the keyboard moves between the two.
 */
export function OptionCard({
  id,
  checked,
  onSelect,
  icon,
  label,
  hint,
  disabled = false,
  name,
}: {
  id: string;
  checked: boolean;
  onSelect: () => void;
  icon: IconSvgElement;
  label: string;
  hint: string;
  disabled?: boolean;
  /** The radio group's name. */
  name: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-center gap-cozy rounded-xl border bg-card px-group py-cozy transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2',
        checked
          ? 'border-foreground shadow-[inset_0_0_0_1px_hsl(var(--foreground))]'
          : 'border-input hover:border-input-hover hover:bg-muted/40',
        disabled && 'pointer-events-none cursor-not-allowed opacity-50',
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={id}
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="sr-only"
      />
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-lg transition-colors',
          checked ? 'bg-foreground text-background' : 'bg-muted text-foreground',
        )}
        aria-hidden
      >
        <HugeiconsIcon icon={icon} className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-body font-semibold text-foreground">{label}</span>
        <span className="block text-pretty text-meta text-muted-foreground">{hint}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          'grid size-[18px] shrink-0 place-items-center rounded-full border transition-colors',
          checked ? 'border-foreground bg-foreground' : 'border-input bg-card',
        )}
      >
        {checked ? <span className="size-1.5 rounded-full bg-background" /> : null}
      </span>
    </label>
  );
}
