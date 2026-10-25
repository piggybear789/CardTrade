// components/account/SettingsPrimitives.tsx
'use client';

// components/account/SettingsPrimitives.tsx
//
// Shared building blocks for the account settings tabs.
//
// A CLIENT MODULE, AND THAT IS LOAD-BEARING — nothing here uses a hook, so it reads
// like it could be a Server Component, and it was one.
//
// The rows are handed to client dialogs as a `trigger` prop, and those dialogs identify
// them with `isValidElement(trigger)` before `cloneElement`-ing an `onClick` on
// (`EditProfileDialog`, `AddPaymentMethodDialog`, and `withRowOpenHandler` below). That
// check CANNOT be relied on for a prop that crossed the RSC boundary: while these were
// Server Components, `isValidElement` was false during the SSR pass and true in the
// browser, so the server emitted the dialogs' bare `<div>` fallback wrapper and the
// client emitted the cloned `<button>`. React reported a hydration mismatch, threw the
// tree away, and the rows ended up as controls that did not open anything.
//
// As client components the element is a real element on BOTH passes, so the two agree
// and the clone lands. The cost is that every prop from a Server Component caller must
// be serialisable — see `interactive` on {@link SettingsListRow} for the one that used
// to be a function and crashed the page.
//
// TRANSLATED, NOT COPIED. The design reference these follow is dark-themed and
// names fonts this app does not load (Fraunces, JetBrains Mono). The app ships a
// single LIGHT theme with Instrument Sans, so the reference's
// STRUCTURE (compact rows, eyebrow labels, status pills, icon medallions) is
// reproduced here against real tokens — `trust`, `iris`, `destructive`, `muted`.
// Porting its `bg-[#111118]` / `text-emerald-400` classes verbatim would render
// as unreadable dark-on-light.

import {
  cloneElement,
  isValidElement,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import { ChevronRightIcon, ShieldAlertIcon, ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// The grouped list — the vocabulary the whole Account surface is built from
// ---------------------------------------------------------------------------
//
// ONE ROW SHAPE, EVERYWHERE. Before this, a single scroll of Settings used four
// container treatments: a solid card for identity, a bare textarea for the bio, and
// two dashed boxes for links and payment. Nothing repeated, so there was no row
// vocabulary to learn and every block had to be read from scratch. A settings screen
// is the one surface where familiarity beats invention — see the product register's
// note that consistency IS an affordance.
//
// VALUES AT REST, EDITORS ON DEMAND. Rows show what a setting currently IS and open
// an editor when tapped. The page used to render live inputs instead: the bio was a
// permanently-open textarea with placeholder prose and a `0/280` counter, so a
// screen people mostly READ was dressed as a form they had abandoned halfway.

/**
 * A run of related rows inside one container.
 *
 * The container is the only card: rows never carry their own border, which is what
 * keeps this from becoming the nested-card pattern. No shadow either — a 1px border
 * plus a soft drop shadow on the same element is the "ghost card" tell.
 */
export function SettingsGroup({
  label,
  description,
  children,
  className,
}: {
  /** Group heading. Omit for a standalone run of rows that needs no introduction. */
  label?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-snug', className)}>
      {label ? (
        <div className="space-y-tight px-tight">
          {/* A REAL HEADING, not a `<p>`. This looked like a heading and was a `<p>`,
              so it sat outside the document outline: a screen-reader user skimming by
              heading jumped straight from the member's name to the rows with nothing
              naming the group in between.

              SENTENCE CASE AT BODY SIZE, not the app's `market-label`. That class is
              11px uppercase on wide tracking — a web-dashboard eyebrow, and the last
              thing on this surface that read as a website rather than an app. Native
              group headers are sentence case and close to body size, de-emphasised by
              colour rather than by shrinking, which is also what this project's own
              type-scale note asks for. */}
          <h3 className="text-body font-medium text-muted-foreground">{label}</h3>
          {description ? (
            <p className="text-body text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

/**
 * The row's box, shared by the real row and {@link SettingsRowSkeleton}.
 *
 * ONE DEFINITION SO THE PLACEHOLDER CANNOT DRIFT. Loading states here used to be
 * hand-drawn boxes with their own paddings and heights, so every change to the real
 * layout silently invalidated them and the page visibly re-laid-out on data arrival.
 * A skeleton whose geometry is a copy of the geometry is a skeleton that is wrong by
 * default; this makes them the same object.
 */
const ROW_SHAPE = [
  'relative flex w-full items-center gap-cozy px-group py-cozy text-left min-h-12',
  'before:absolute before:left-group before:right-0 before:top-0 before:h-px',
  'before:bg-border first:before:hidden',
].join(' ');

/**
 * One row in a {@link SettingsGroup}: label on the left, current value on the right,
 * a chevron when tapping it opens something.
 *
 * Renders as a link, a button, or a plain div depending on what it does, so a row
 * that navigates is a real anchor and a row that only reports is not focusable.
 */
export function SettingsListRow({
  icon,
  tone = 'neutral',
  label,
  description,
  value,
  trailing,
  href,
  onClick,
  interactive: interactiveProp,
  disabled,
  className,
  // Ref and unknown props are forwarded so a row can BE a Radix `asChild` trigger
  // (`DialogTrigger`, `PopoverTrigger`), which clones its child with handlers, ARIA
  // and a ref. Without this the dialogs would each need a parallel controlled-open
  // prop just to be opened from a list row.
  ref,
  type = 'button',
  ...rest
}: {
  icon?: IconSvgElement;
  tone?: StatusTone;
  label: ReactNode;
  /** Second line under the label, for a row whose purpose is not self-evident. */
  description?: ReactNode;
  /** The setting's current state, right-aligned and muted. */
  value?: ReactNode;
  /** Replaces the chevron — a pill, a switch, or a real control. */
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  /**
   * Force the `<button>` branch without supplying a handler.
   *
   * FOR A ROW CREATED IN A SERVER COMPONENT AND OPENED BY A CLIENT DIALOG. The dialog
   * clones this row and adds the real `onClick` (see `withRowOpenHandler`, and the
   * matching `cloneElement` in `EditProfileDialog` / `AddPaymentMethodDialog`), but the
   * clone lands on whatever this already RENDERED to — so the branch has to be decided
   * here, before the boundary, or the tap arrives on a non-focusable `div`.
   *
   * IT EXISTS BECAUSE THE OBVIOUS WORKAROUND CRASHES THE PAGE. Passing a throwaway
   * `onClick={() => {}}` from the server flips the same branch, and that is what
   * `app/(workspace)/profile/page.tsx` did: the server-rendered output then carried a
   * function prop, React refused to serialise it across the boundary
   * ("Event handlers cannot be passed to Client Component props"), and the route error
   * boundary swallowed the ENTIRE account surface — no tab strip, no rows, for every
   * member regardless of verification state.
   */
  interactive?: boolean;
  disabled?: boolean;
  className?: string;
  // Typed against `HTMLElement`, not one concrete tag: this renders as an anchor, a
  // button or a div, and `HTMLButtonElement` handlers are not assignable to the other
  // two. React's event handlers are bivariant, so the supertype satisfies all three.
  ref?: Ref<HTMLElement>;
  /** Radix sets this on a trigger; it is only meaningful on the button branch. */
  type?: 'button' | 'submit' | 'reset';
} & Omit<HTMLAttributes<HTMLElement>, 'onClick' | 'className' | 'children'>) {
  const Glyph = icon;
  // Interactive when it navigates, has an explicit handler, is declared so by a server
  // caller whose client dialog will attach the handler later, or is cloned as a trigger
  // (`ref` / pointer / aria-haspopup from Radix).
  const interactive = Boolean(
    href || onClick || interactiveProp || ref || rest.onPointerDown || rest['aria-haspopup'],
  );

  const body = (
    <>
      {Glyph ? <IconMedallion icon={Glyph} tone={tone} /> : null}
      <span className="min-w-0 flex-1">
        {/* LABEL AND VALUE SHARE THE FIRST LINE; THE DESCRIPTION GETS THE WHOLE SECOND.
            The label is the row's name, so it keeps its width and the value truncates
            instead. With the value in its own column beside a two-line block, a phone
            cut the label to "Browsing re…", and the description beside a value was
            squeezed to a dozen characters. */}
        <span className="flex min-w-0 items-baseline gap-cozy">
          <span
            className={cn(
              'text-body font-medium text-foreground',
              // Alone on its line it may wrap; beside a value it holds its width.
              value ? 'shrink-0' : 'min-w-0',
            )}
          >
            {label}
          </span>
          {/* Beside the label only when there is no description. With one, the value
              moves to the right column (below) and centres on the row with the
              chevron, rather than sitting on the first line while the chevron sits
              in the middle. */}
          {value && !description ? (
            <span className="min-w-0 flex-1 truncate text-right text-body text-muted-foreground">
              {value}
            </span>
          ) : null}
        </span>
        {description ? (
          // ONE LINE, and it gets the row's full width — which is the point of using
          // it over `value` for something long. One line is also what
          // `SettingsRowSkeleton` reserves.
          <span className="mt-0.5 line-clamp-1 text-body leading-snug text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {value && description ? (
        <span className="max-w-[40%] shrink-0 truncate text-right text-body text-muted-foreground">
          {value}
        </span>
      ) : null}
      {trailing ?? null}
      {interactive && !trailing ? (
        <HugeiconsIcon icon={ChevronRightIcon} className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
      ) : null}
    </>
  );

  // Divider drawn as a pseudo-element inset to the row's text origin, rather than
  // `divide-y` on the group: a full-bleed rule between rows reads as a table, and the
  // inset one is what makes a run of rows read as a single grouped list.
  const shape = cn(
    ROW_SHAPE,
    // `touch-manipulation` opts out of double-tap-to-zoom, which is what removes the
    // ~300ms delay browsers otherwise hold before firing the tap. On a list you flick
    // through, that delay is most of the difference between "app" and "website".
    interactive && 'touch-manipulation transition-colors active:bg-muted/70 md:hover:bg-muted/40',
    // Ring rather than the app's usual border-colour focus: these rows sit inside an
    // `overflow-hidden` group, so an outset ring would be clipped on the first and
    // last row. `ring-inset` stays visible on every row.
    interactive &&
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:border-ring',
    disabled && 'pointer-events-none opacity-60',
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        ref={ref as Ref<HTMLAnchorElement>}
        className={shape}
        aria-disabled={disabled || undefined}
        {...rest}
      >
        {body}
      </Link>
    );
  }

  // A row that only reports must not be focusable — rendering every row as a button
  // would put a keyboard stop on each line of a read-only group.
  if (!interactive) {
    return (
      <div ref={ref as Ref<HTMLDivElement>} className={shape} {...rest}>
        {body}
      </div>
    );
  }

  return (
    <button
      type={type}
      ref={ref as Ref<HTMLButtonElement>}
      onClick={onClick}
      disabled={disabled}
      className={shape}
      {...rest}
    >
      {body}
    </button>
  );
}

/**
 * Attach an open handler to a settings row (or any element) without Radix
 * `DialogTrigger asChild`.
 *
 * `asChild` clones its child with handlers, but a row created in a Server
 * Component and passed into a Client dialog often never receives them — the row
 * then renders as a non-button `div` and the tap does nothing. Cloning here, in
 * the client that owns the dialog, puts `onClick` on `SettingsListRow` so it
 * becomes a real button.
 */
export function withRowOpenHandler(trigger: ReactNode, onOpen: () => void): ReactNode {
  if (!isValidElement<{ onClick?: () => void; interactive?: boolean }>(trigger)) return trigger;
  const previous = trigger.props.onClick;
  return cloneElement(trigger, {
    onClick: () => {
      previous?.();
      onOpen();
    },
  });
}

/**
 * The one line on the Account surface that states what a member's account actually
 * IS, rather than what they can change about it.
 *
 * WHY IT EARNS THE SPACE. NoDitto's whole proposition is that everyone selling has
 * been checked, and `PRODUCT.md`'s first design principle is that trust is visible
 * and SPECIFIC. The first pass expressed that as a small grey-green "Verified" pill
 * tucked under an email address — a badge, which is exactly the decoration the
 * anti-references warn against. This names the two facts instead, in order, and says
 * plainly when one is missing.
 *
 * Never colour alone: each state is carried by its words, with tone as reinforcement.
 */
export function TrustLine({
  identityVerified,
  payoutsActive,
}: {
  identityVerified: boolean;
  payoutsActive: boolean;
}) {
  if (!identityVerified) {
    return (
      <p className="flex items-center gap-tight text-body text-muted-foreground">
        <HugeiconsIcon icon={ShieldAlertIcon} className="size-4 shrink-0" aria-hidden />
        Not verified yet
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-x-tight gap-y-0 text-body">
      <HugeiconsIcon icon={ShieldCheckIcon} className="size-4 shrink-0 text-trust" aria-hidden />
      <span className="font-medium text-trust">ID checked by Stripe</span>
      <span aria-hidden className="text-muted-foreground/50">
        ·
      </span>
      <span className="text-muted-foreground">
        {payoutsActive ? 'Payouts active' : 'Payouts not set up'}
      </span>
    </p>
  );
}

/**
 * A loading placeholder occupying exactly one {@link SettingsListRow}.
 *
 * Built from `ROW_SHAPE`, so it inherits the row's height, padding and divider
 * rather than approximating them. The trailing spacer is deliberate: it reserves the
 * chevron's footprint, without which every label and value shifts sideways by 16px
 * the instant real content arrives.
 */
export function SettingsRowSkeleton({
  /**
   * Reserve the leading {@link IconMedallion}. Same argument as the chevron
   * spacer, at three times the cost: the medallion is `size-9` beside a
   * `gap-cozy`, so a row that arrives with one and was drawn without it pushes
   * its label and value 48px to the right.
   */
  icon = false,
  /** Reserve the second line. It also lifts the row off its `min-h-12` floor. */
  description = false,
  labelClassName = 'w-1/3',
  valueClassName = 'w-1/3',
}: {
  icon?: boolean;
  description?: boolean;
  labelClassName?: string;
  valueClassName?: string;
}) {
  // The label and value bars are texture inside the row's `min-h-12` box (the icon
  // medallion and the row floor carry the height), so they draw from the canonical set.
  // The value sits on the label's line, as it does in `SettingsListRow`.
  return (
    <div className={ROW_SHAPE} aria-hidden>
      {icon ? <Skeleton className="size-9 shrink-0 rounded-full" /> : null}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center justify-between gap-cozy">
          <TextLines className="min-w-0 flex-1 text-body" widths={[labelClassName]} />
          <Skeleton className={cn('h-4 shrink-0', valueClassName)} />
        </span>
        {description ? (
          <TextLines
            className="mt-0.5 text-body leading-snug"
            widths={['w-2/3']}
          />
        ) : null}
      </span>
      <span className="size-4 shrink-0" />
    </div>
  );
}

/**
 * A row that hands its whole interior to the caller — used where a step needs real
 * controls (the verification spine) but should still sit in the same container as
 * the rows around it.
 */
export function SettingsPanelRow({
  children,
  className,
}: ComponentPropsWithoutRef<'div'> & { className?: string }) {
  return (
    <div
      className={cn(
        'relative p-group before:absolute before:left-group before:right-0 before:top-0',
        'before:h-px before:bg-border first:before:hidden',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Tone for {@link IconMedallion}, mapped to the app's semantic tokens. `trust` is the
 * app's reserved verification colour (see globals.css).
 */
export type StatusTone = 'verified' | 'pending' | 'required' | 'neutral';

/**
 * Circular icon medallion used at the start of a settings row.
 *
 * `aria-hidden` without exception: every caller pairs it with a text label, so
 * announcing it would duplicate that label for a screen reader.
 */
export function IconMedallion({
  icon: Icon,
  tone = 'neutral',
}: {
  icon: IconSvgElement;
  tone?: StatusTone;
}) {
  const toneClass: Record<StatusTone, string> = {
    verified: 'bg-trust/10 text-trust',
    pending: 'bg-muted text-foreground',
    required: 'bg-muted text-muted-foreground',
    neutral: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full',
        toneClass[tone],
      )}
      aria-hidden
    >
      <HugeiconsIcon icon={Icon} className="size-4" />
    </span>
  );
}

/**
 * Empty-state placeholder for a settings slot with no data yet.
 *
 * Dashed border rather than a solid card: an absent thing should not carry the
 * same visual weight as a present one.
 */
export function SettingsPlaceholder({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-cozy rounded-xl border border-border bg-muted px-group py-group max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-group max-md:py-cozy">
      <p className="text-body text-muted-foreground">{children}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
