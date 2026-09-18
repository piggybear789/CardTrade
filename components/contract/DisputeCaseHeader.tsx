'use client';

// components/contract/DisputeCaseHeader.tsx
//
// The cover sheet on a disputed contract: what is frozen, who filed against whom, and
// when a decision is due.
//
// WHY THIS EXISTS. The Dispute tab used to open with the claim and then, two lines
// later, offer to refund the buyer in full. It never answered the three questions a
// member actually arrives with — where is my money, what do I have to do, when is this
// decided — even though the app knows all three: the amount is on the contract row,
// `disputed_at` is on the contract row, and `ARBITRATION_SLA_HOURS` is in the domain. A
// member had to read a form to work out they were not about to lose anything today.
//
// A COVER SHEET, NOT AN ALERT. The tab label, the status badge and the claim below are
// already red; a fourth red thing is noise rather than emphasis. This is mist and
// obsidian — the register the app reserves for money — because the accurate tone here is
// gravity, not alarm: the money has stopped moving and a person will decide it. Red
// stays on the claim itself and on the controls that cost you something.
//
// ONE CONTAINER, USED ONCE. `DisputeEvidencePanel` draws no card chrome for the reason
// its own header records, and that still holds for its prose. This is the exception
// because it is a distinct object rather than a section of prose — the tint is depth on
// paper, which `app/globals.css` sanctions, and it carries no border, matching the
// warning block in `HandoverFailedDialog`.
//
// THE TARGET DATE IS DERIVED, NOT PROMISED. `ARBITRATION_SLA_HOURS` is the internal
// threshold past which a case is treated as overdue, so it is stated as a target the
// queue works to and never as a guarantee. Once it passes, the copy says so plainly
// rather than showing a date that has been and gone — a case past target genuinely is
// escalated (`PAST_SLA` → HIGH in `priorityReasonOf`), so the honest line is also the
// reassuring one.

import { useEffect, useState, type ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Clock01Icon, GavelIcon, ScaleIcon } from '@hugeicons/core-free-icons';

import { ARBITRATION_SLA_HOURS } from '@/domain/arbitration/arbitrationCase';
import { formatShortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * What is frozen while the case is open, in the room's OWN vocabulary.
 *
 * Supplied by the room rather than derived here, for the reason the steering docs give
 * about trade collateral: a Cash_Sale has money collected into the platform balance,
 * while a Trade has an uncaptured card authorisation and no money has moved at all.
 * Calling either one by the other's name is the misstatement this prop exists to
 * prevent.
 */
export interface DisputeCaseStake {
  /** Short noun phrase: "Payment held", "Collateral held". */
  label: string;
  /** The figure or subject, pre-formatted by the room. */
  value: string;
  /** One sentence on what that means for the reader. */
  note: string;
}

/** The decision, once a party conceded or staff decided. */
export interface DisputeCaseOutcome {
  /** What was decided, in plain words: "Refunded in full". */
  label: string;
  /** What it means for the reader now. */
  detail: string;
  /** When it was decided, ISO. */
  at?: string | null;
}

export interface DisputeCaseHeaderProps {
  stake: DisputeCaseStake;
  /** Who raised it. Literally `'you'` when the viewer did. */
  raisedByName?: string | null;
  /** Who it was raised against. Literally `'you'` when that is the viewer. */
  againstName?: string | null;
  /** When it was raised, ISO. Drives the decision target. */
  raisedAt?: string | null;
  /** Set once the case is closed; replaces the decision target. */
  outcome?: DisputeCaseOutcome | null;
  /** True when the viewer already has a statement on the record. */
  viewerHasFiled?: boolean;
  /** False once the record is closed, which removes the nudge to file. */
  canSubmit?: boolean;
}

/** One cell of the cover sheet. */
function Fact({
  icon,
  label,
  value,
  note,
}: {
  icon: typeof ScaleIcon;
  label: string;
  value: ReactNode;
  note: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-tight text-meta font-semibold uppercase tracking-wide text-obsidian/60">
        <HugeiconsIcon icon={icon} className="size-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      {/* `tabular-nums` because two of the three cells are a figure or a date and
          the three sit in a row: proportional digits make the columns wobble. */}
      <dd className="mt-tight text-lead font-semibold tabular-nums">{value}</dd>
      <dd className="mt-tight text-pretty text-body text-obsidian/70">{note}</dd>
    </div>
  );
}

/** Status, stake and clock for a disputed contract, as one cover sheet. */
export function DisputeCaseHeader({
  stake,
  raisedByName,
  againstName,
  raisedAt,
  outcome,
  viewerHasFiled = false,
  canSubmit = true,
}: DisputeCaseHeaderProps) {
  const raisedMs = raisedAt ? Date.parse(raisedAt) : Number.NaN;
  const targetMs = Number.isNaN(raisedMs)
    ? null
    : raisedMs + ARBITRATION_SLA_HOURS * 3_600_000;

  // AFTER MOUNT, DELIBERATELY. "Is the target in the past" depends on the current
  // instant, and reading the clock during render makes the server's HTML disagree with
  // the client's first pass. The date itself is derived purely from `raisedAt`, so the
  // cell renders correctly either way and only the overdue note arrives a tick later.
  const [pastTarget, setPastTarget] = useState(false);
  useEffect(() => {
    if (targetMs === null) return;
    setPastTarget(Date.now() > targetMs);
  }, [targetMs]);

  const targetDate = targetMs === null ? null : formatShortDate(new Date(targetMs).toISOString());
  const decided = Boolean(outcome);

  const raisedLine = raisedByName
    ? raisedByName === 'you'
      ? 'You'
      : raisedByName
    : 'A party';
  const againstLine = againstName
    ? againstName === 'you'
      ? 'Raised against you.'
      : `Raised against ${againstName}.`
    : 'Raised on this contract.';

  return (
    <section
      aria-labelledby="dispute-case-heading"
      className="rounded-lg bg-mist p-group text-obsidian"
    >
      <h3
        id="dispute-case-heading"
        className="flex items-center gap-snug text-meta font-semibold uppercase tracking-wide"
      >
        <HugeiconsIcon icon={ScaleIcon} className="size-4 shrink-0" aria-hidden />
        {decided ? 'Case closed' : 'Case open with support'}
      </h3>

      <dl className="mt-cozy grid gap-group sm:grid-cols-3">
        <Fact
          icon={GavelIcon}
          label={stake.label}
          value={stake.value}
          note={stake.note}
        />
        <Fact
          icon={ScaleIcon}
          label="Reported by"
          value={raisedLine}
          note={`${againstLine} A report is a claim, not a finding.`}
        />
        {outcome ? (
          <Fact
            icon={GavelIcon}
            label="Outcome"
            value={outcome.label}
            note={
              outcome.at
                ? `${outcome.detail} Decided ${formatShortDate(outcome.at) ?? 'earlier'}.`
                : outcome.detail
            }
          />
        ) : (
          <Fact
            icon={Clock01Icon}
            label="Decision target"
            value={targetDate ?? 'With support'}
            note={
              pastTarget
                ? `Past the ${ARBITRATION_SLA_HOURS}-hour target, so this case is prioritised in the queue.`
                : `Support works cases in the order they were reported and aims to decide within ${ARBITRATION_SLA_HOURS} hours.`
            }
          />
        )}
      </dl>

      {/* YOUR MOVE, ON THE COVER SHEET. This is the one fact a member cannot work out
          for themselves and the one the old panel never stated: a decision is made on
          the record, and an empty side is an unanswered one. It sits inside the strip
          because "where do I stand" is exactly what the strip is for. */}
      {canSubmit ? (
        <p
          className={cn(
            'mt-group border-t border-obsidian/10 pt-cozy text-body',
            viewerHasFiled ? 'text-obsidian/70' : 'font-medium',
          )}
        >
          {viewerHasFiled
            ? 'Your side is on the record. Add another statement below if something changes.'
            : 'Your side is not on the record yet. Support decides on what is written here, so add it below.'}
        </p>
      ) : null}
    </section>
  );
}
