// components/account/SettingsPrimitives.tsx
//
// Shared building blocks for the account settings tabs.
//
// TRANSLATED, NOT COPIED. The design reference these follow is dark-themed and
// names fonts this app does not load (Fraunces, JetBrains Mono). The app ships a
// single LIGHT theme with Plus Jakarta Sans + Geist Mono, so the reference's
// STRUCTURE (compact rows, eyebrow labels, status pills, icon medallions) is
// reproduced here against real tokens — `trust`, `gold`, `destructive`, `muted`.
// Porting its `bg-[#111118]` / `text-emerald-400` classes verbatim would render
// as unreadable dark-on-light.

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

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
          <p className="text-body leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Status tone for {@link StatusPill}, mapped to the app's semantic tokens. */
export type StatusTone = 'verified' | 'pending' | 'required' | 'neutral';

const TONE_CLASS: Record<StatusTone, string> = {
  // `trust` is the app's reserved verification colour (see globals.css) — the
  // reference's emerald would introduce a second "this is confirmed" hue.
  verified: 'border-trust/25 bg-trust/10 text-trust',
  pending: 'border-gold/30 bg-gold/10 text-gold',
  required: 'border-border bg-muted text-muted-foreground',
  neutral: 'border-border bg-muted/60 text-muted-foreground',
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
        'text-[0.6875rem] font-medium leading-tight',
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
  className,
}: {
  icon?: LucideIcon;
  tone?: StatusTone;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  /** Extra content rendered beneath the row, inside the same border. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border bg-card', className)}>
      <div className="flex flex-wrap items-center gap-x-group gap-y-cozy p-group">
        {icon ? <IconMedallion icon={icon} tone={tone} /> : null}
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-foreground">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 text-meta text-muted-foreground">
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
    <div className="flex flex-wrap items-center justify-between gap-cozy rounded-xl border border-dashed px-group py-group">
      <p className="text-meta text-muted-foreground">{children}</p>
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
    <div className="rounded-xl border bg-card p-group">
      <div className="flex items-center gap-snug">
        <IconMedallion icon={icon} tone={tone} />
        <p className="min-w-0 text-meta text-muted-foreground">{label}</p>
      </div>
      {/* `display-value` is the existing ledger-figure class: sans, bold, with
          tabular figures so columns of money align. */}
      <p className="display-value mt-3 text-subhead">{value}</p>
      {sub ? <p className="mt-1 text-meta text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
