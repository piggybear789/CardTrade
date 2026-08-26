// components/account/SettingsPrimitives.tsx
//
// Shared building blocks for the account settings tabs.
//
// TRANSLATED, NOT COPIED. The design reference these follow is dark-themed and
// names fonts this app does not load (Fraunces, JetBrains Mono). The app ships a
// single LIGHT theme with Plus Jakarta Sans, so the reference's
// STRUCTURE (compact rows, eyebrow labels, status pills, icon medallions) is
// reproduced here against real tokens — `trust`, `gold`, `destructive`, `muted`.
// Porting its `bg-[#111118]` / `text-emerald-400` classes verbatim would render
// as unreadable dark-on-light.

import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode, Ref } from 'react';
import Link from 'next/link';
import { ChevronRight, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';

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
          <SectionLabel>{label}</SectionLabel>
          {description ? (
            <p className="text-body leading-relaxed text-muted-foreground">{description}</p>
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
  icon?: LucideIcon;
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
  // `rest` carries a Radix trigger's own onClick when used via `asChild`, so a row
  // with neither `href` nor `onClick` can still be interactive.
  const interactive = Boolean(href || onClick || rest.onPointerDown || rest['aria-haspopup']);

  const body = (
    <>
      {Glyph ? <IconMedallion icon={Glyph} tone={tone} /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-foreground">{label}</span>
        {description ? (
          // ONE LINE, and it gets the row's full width — which is the point of using
          // it over `value` for something long. A bio in the value slot was capped at
          // 45% of a phone screen and truncated at about nineteen characters, so the
          // preview showed nothing worth reading.
          <span className="mt-0.5 line-clamp-1 text-body leading-snug text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {value ? (
        <span className="min-w-0 max-w-[45%] truncate text-right text-body text-muted-foreground">
          {value}
        </span>
      ) : null}
      {trailing ?? null}
      {interactive && !trailing ? (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
      ) : null}
    </>
  );

  // Divider drawn as a pseudo-element inset to the row's text origin, rather than
  // `divide-y` on the group: a full-bleed rule between rows reads as a table, and the
  // inset one is what makes a run of rows read as a single grouped list.
  const shape = cn(
    'relative flex w-full items-center gap-cozy px-group py-cozy text-left',
    'min-h-12 before:absolute before:left-group before:right-0 before:top-0 before:h-px',
    'before:bg-border first:before:hidden',
    interactive && 'transition-colors active:bg-muted/70 md:hover:bg-muted/40',
    // Ring rather than the app's usual border-colour focus: these rows sit inside an
    // `overflow-hidden` group, so an outset ring would be clipped on the first and
    // last row. `ring-inset` stays visible on every row.
    interactive &&
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/60',
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
        <ShieldAlert className="size-4 shrink-0" aria-hidden />
        Not verified yet
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-x-tight gap-y-0 text-body">
      <ShieldCheck className="size-4 shrink-0 text-trust" aria-hidden />
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
 * Eyebrow label above a settings group.
 *
 * Reuses the existing `market-label` component class (uppercase, tracked) rather
 * than re-specifying those properties, so the account pages speak the same
 * typographic language as the rest of the app. That class is single-family sans —
 * see the note on it in `globals.css`.
 */
export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn('market-label text-muted-foreground', className)}>{children}</p>
  );
}

/**
 * A settings group: eyebrow label, optional explanation, then content.
 *
 * Vertical rhythm lives here so every group on every tab is spaced identically —
 * the thing that made the earlier iterations of this page read as "all over the
 * place" was each section inventing its own margins.
 */
export function SettingsSection({
  label,
  description,
  children,
  className,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-cozy', className)}>
      <div className="space-y-tight">
        <SectionLabel>{label}</SectionLabel>
        {description ? (
          <p className="hidden text-body leading-relaxed text-muted-foreground md:block">{description}</p>
        ) : null}
      </div>
      <div className="max-md:divide-y max-md:divide-border max-md:overflow-hidden max-md:rounded-xl max-md:border max-md:border-border max-md:bg-card md:contents">
        {children}
      </div>
    </section>
  );
}

/** Status tone for {@link StatusPill}, mapped to the app's semantic tokens. */
export type StatusTone = 'verified' | 'pending' | 'required' | 'neutral';

const TONE_CLASS: Record<StatusTone, string> = {
  // `trust` is the app's reserved verification colour (see globals.css) — the
  // reference's emerald would introduce a second "this is confirmed" hue.
  verified: 'border-trust/40 bg-trust/10 text-trust',
  pending: 'border-gold/40 bg-gold/10 text-gold',
  required: 'border-border bg-muted text-muted-foreground',
  neutral: 'border-border bg-muted text-muted-foreground',
};

/** Compact status pill. Icon is optional and always decorative. */
export function StatusPill({
  tone,
  icon: Icon,
  children,
}: {
  tone: StatusTone;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-tight rounded-full border px-2 py-0.5',
        'text-meta font-medium leading-tight',
        TONE_CLASS[tone],
      )}
    >
      {Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  );
}

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
  icon: LucideIcon;
  tone?: StatusTone;
}) {
  const toneClass: Record<StatusTone, string> = {
    verified: 'bg-trust/10 text-trust',
    pending: 'bg-gold/10 text-gold',
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
      <Icon className="size-4" />
    </span>
  );
}

/**
 * A bordered row: medallion, title + subtitle, then trailing content.
 *
 * `trailing` is deliberately a slot rather than a button prop — callers pass real
 * dialogs and server-action buttons (`AddPaymentMethodDialog`, Connect flows) and
 * this component must never own a mutation.
 */
export function SettingsRow({
  icon,
  tone = 'neutral',
  title,
  subtitle,
  trailing,
  children,
  inverse = false,
  className,
}: {
  icon?: LucideIcon;
  tone?: StatusTone;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  /** Extra content rendered beneath the row, inside the same border. */
  children?: ReactNode;
  /** Black card, white type — used for a saved payment method. */
  inverse?: boolean;
  className?: string;
}) {
  const IconGlyph = icon;
  return (
    <div
      className={cn(
        'rounded-xl border bg-card max-md:rounded-none max-md:border-0 max-md:bg-transparent',
        inverse && 'border-white/15 bg-obsidian max-md:rounded-none max-md:border-white/15 max-md:bg-obsidian',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-group gap-y-cozy p-group">
        {IconGlyph ? (
          inverse ? (
            <span
              className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-parchment"
              aria-hidden
            >
              <IconGlyph className="size-4" />
            </span>
          ) : (
            <IconMedallion icon={IconGlyph} tone={tone} />
          )
        ) : null}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-lead font-semibold',
              inverse ? 'text-parchment' : 'text-foreground',
            )}
          >
            {title}
          </p>
          {subtitle ? (
            <p
              className={cn(
                'mt-0.5 text-body',
                inverse ? 'text-parchment/65' : 'text-muted-foreground',
              )}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {children ? <div className="border-t px-group py-group">{children}</div> : null}
    </div>
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
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-cozy rounded-xl border border-dashed px-group py-group max-md:rounded-none max-md:border-0 max-md:px-group max-md:py-cozy">
      <p className="text-body text-muted-foreground">{children}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** A single figure in the payouts summary strip. */
export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  tone?: StatusTone;
}) {
  return (
    <div className="rounded-xl border bg-card p-cozy md:p-group">
      <div className="flex items-center gap-snug">
        <IconMedallion icon={icon} tone={tone} />
        <p className="min-w-0 font-sans text-meta text-muted-foreground">{label}</p>
      </div>
      {/* `display-value` is the existing ledger-figure class: sans, bold, with
          tabular figures so columns of money align. */}
      <p className="display-value mt-snug text-lead md:mt-4">{value}</p>
      {sub ? <p className="mt-tight font-sans text-body text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
