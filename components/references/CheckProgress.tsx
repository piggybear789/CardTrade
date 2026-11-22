'use client';

// components/references/CheckProgress.tsx
//
// A digital footprint check as it runs: each part ticked off as it comes back, with what
// it found. Shown in place of the card before a first check has an answer, and laid over
// the card while a check someone asked for is redone (`BackgroundCheckPanel`).
//
// NOTHING HERE IS TIMED. A row turns to a tick because the server said that part finished
// (`CheckStreamEvent`, one line per part), or because the stored run says so while the
// slower scan of other public sites is polled. A reader is never shown progress that
// has not happened.

import type { ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  CheckmarkCircle02Icon,
  Globe02Icon,
  Link01Icon,
  LoaderCircleIcon,
  MinusSignCircleIcon,
  Note01Icon,
  ShieldCheckIcon,
} from '@hugeicons/core-free-icons';

import { PlatformChip } from '@/components/references/referenceLabels';

import {
  CHECK_STEPS,
  type BackgroundCheckDossier,
  type CheckProfilePlatform,
  type CheckStep,
  type CheckStepResult,
  type CheckStreamEvent,
} from '@/domain/references/enrichment';
import { cn } from '@/lib/utils';

/** What has come back so far, by part. */
export type CheckStepResults = Partial<Record<CheckStep, CheckStepResult>>;

type StepStatus = 'waiting' | 'checking' | 'done' | 'skipped';

interface StepView {
  step: CheckStep;
  label: string;
  status: StepStatus;
  detail: string | null;
}

const STEP_LABEL: Record<Exclude<CheckStep, 'profile'>, string> = {
  ebay: 'eBay',
  web: 'Open web & community',
  scam: 'Scam database',
  summary: 'Summary',
  sites: 'Other public sites',
};

const PROFILE_LABEL: Record<CheckProfilePlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook (search index)',
};

function stepLabel(step: CheckStep, platform: CheckProfilePlatform): string {
  return step === 'profile' ? PROFILE_LABEL[platform] : STEP_LABEL[step];
}

/** The parts the summary is written from: it starts once these are all back. */
const SUMMARISED_STEPS: readonly CheckStep[] = ['ebay', 'profile', 'web', 'scam'];

const COUNT_FORMAT = new Intl.NumberFormat('en-AU');

function counted(count: number, one: string, many: string): string {
  return `${COUNT_FORMAT.format(count)} ${count === 1 ? one : many}`;
}

function resultDetail(result: CheckStepResult): string | null {
  if (result.state === 'skipped') return 'Not checked';
  switch (result.step) {
    case 'ebay':
      if (!result.found) return 'No account found';
      return result.count === null ? 'Account found' : `${COUNT_FORMAT.format(result.count)} feedback`;
    case 'profile':
      if (result.platform === 'facebook') {
        // `count` is how many other accounts share the name.
        if (!result.found) return 'Not in search engines';
        return result.count ? counted(result.count, 'same-name account', 'same-name accounts') : 'Profile indexed';
      }
      if (!result.found) return 'No public profile';
      return result.count === null ? 'Profile found' : counted(result.count, 'follower', 'followers');
    case 'web':
      // No figure: the card drops duplicates of the profile itself, so its count can differ.
      return result.found ? 'Mentions found' : 'Nothing found';
    case 'scam':
      return result.count ? counted(result.count, 'match', 'matches') : 'No reports';
    default:
      return null;
  }
}

/** The scan of other public sites, read from the stored run. It only starts once the rest is in. */
function sitesView(starting: boolean, dossier: BackgroundCheckDossier | null): Pick<StepView, 'status' | 'detail'> {
  if (starting || !dossier) return { status: 'waiting', detail: null };
  const scan = dossier.sources.sherlock;
  if (scan === 'skipped') return { status: 'skipped', detail: 'Not checked' };
  if (scan === 'failed') return { status: 'skipped', detail: 'Could not be scanned' };
  const running = dossier.status === 'QUEUED' || dossier.status === 'RUNNING';
  if (running && scan !== 'done') return { status: 'checking', detail: null };
  return {
    status: 'done',
    detail: dossier.sherlock.length > 0 ? counted(dossier.sherlock.length, 'site', 'sites') : 'None found',
  };
}

/**
 * Where every part of a check stands. `starting` is true while the check itself is being
 * answered (`results` fill in); after it, `dossier` is that check's answer and only the
 * scan of other sites can still be running.
 */
export function checkStepViews({
  starting,
  results,
  dossier,
  profilePlatform = 'instagram',
}: {
  starting: boolean;
  results: CheckStepResults;
  dossier: BackgroundCheckDossier | null;
  /** Whose profile the `profile` row reads, until its result says so itself. */
  profilePlatform?: CheckProfilePlatform;
}): StepView[] {
  return CHECK_STEPS.map((step): StepView => {
    const label = stepLabel(step, results.profile?.platform ?? profilePlatform);
    if (step === 'sites') return { step, label, ...sitesView(starting, dossier) };
    const result = results[step];
    if (result) return { step, label, status: result.state, detail: resultDetail(result) };
    // Answered without saying how this part went (a stored check, reused): it is done.
    if (!starting) return { step, label, status: 'done', detail: null };
    if (step === 'summary' && !SUMMARISED_STEPS.every((part) => results[part])) {
      return { step, label, status: 'waiting', detail: null };
    }
    return { step, label, status: 'checking', detail: null };
  });
}

/**
 * Who each row is about, drawn the way the finished card draws it: the site's own logo
 * where there is one, a round icon badge where there is not. The loader is the card's
 * rows before they have answers, so nothing changes place when they arrive.
 */
const STEP_ICON: Record<Exclude<CheckStep, 'ebay' | 'profile'>, typeof Globe02Icon> = {
  web: Globe02Icon,
  scam: ShieldCheckIcon,
  summary: Note01Icon,
  sites: Link01Icon,
};

function StepBadge({
  step,
  quiet,
  platform,
}: {
  step: CheckStep;
  quiet: boolean;
  platform: CheckProfilePlatform;
}) {
  if (step === 'ebay' || step === 'profile') {
    return (
      <PlatformChip
        slug={step === 'profile' ? platform : step}
        className={cn('size-8 shrink-0 transition-opacity', quiet && 'opacity-50')}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground transition-opacity',
        quiet && 'opacity-50',
      )}
    >
      <HugeiconsIcon icon={STEP_ICON[step]} className="size-4" aria-hidden />
    </span>
  );
}

/** Where a part stands, at the end of its cell. */
function StepMark({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4 shrink-0 text-trust" aria-hidden />;
  }
  if (status === 'skipped') {
    return <HugeiconsIcon icon={MinusSignCircleIcon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
  }
  if (status === 'checking') {
    return (
      <HugeiconsIcon
        icon={LoaderCircleIcon}
        className="size-4 shrink-0 animate-spin text-iris-ink motion-reduce:animate-none"
        aria-hidden
      />
    );
  }
  return null;
}

const STATUS_TEXT: Record<StepStatus, string> = {
  waiting: 'Waiting',
  checking: 'Checking…',
  done: 'Done',
  skipped: 'Not checked',
};

/**
 * A check in progress: a title, a bar for how far along it is, and one row per part.
 * `children` sit under the rows, for an action.
 *
 * THE BAR IS A COUNT, NOT A CLOCK: its width is the parts that have answered out of the
 * parts there are, so it moves only when something has come back. The same count is
 * said in words beside the title, politely, for a reader who cannot see the bar.
 *
 * AS WIDE AS ITS CARD: see the grid below.
 */
export function CheckProgress({
  title,
  starting,
  results,
  dossier,
  profilePlatform = 'instagram',
  children,
}: {
  title: string;
  /** The check is being answered; its parts are still coming back. */
  starting: boolean;
  results: CheckStepResults;
  /** That check's answer, once there is one. Not an earlier check's. */
  dossier: BackgroundCheckDossier | null;
  /** Whose profile the second row reads: the platform the lookup is on. */
  profilePlatform?: CheckProfilePlatform;
  children?: ReactNode;
}) {
  const views = checkStepViews({ starting, results, dossier, profilePlatform });
  const badgePlatform = results.profile?.platform ?? profilePlatform;
  const settled = views.filter((view) => view.status === 'done' || view.status === 'skipped').length;
  const scanningSites = !starting && views.some((view) => view.step === 'sites' && view.status === 'checking');

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-group">
        <p className="text-subhead font-semibold tracking-tight text-foreground">{title}</p>
        <p role="status" className="shrink-0 text-meta tabular-nums text-muted-foreground">
          {settled} of {views.length}
          <span className="sr-only"> checked</span>
        </p>
      </div>
      <div aria-hidden className="mt-snug h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${(settled / views.length) * 100}%` }}
        />
      </div>

      {/* THE WIDTH OF THE CARD. One part to a row on a phone, two from `sm`, three from
          `lg`: six parts in two rows across the card, not a narrow column down its
          middle with a third of the surface empty on either side. What a part found
          sits under its name, where the eye already is. */}
      <ul className="mt-group grid gap-x-6 gap-y-cozy sm:grid-cols-2 lg:grid-cols-3">
        {views.map((view) => (
          <li key={view.step} className="flex items-center gap-cozy">
            <StepBadge step={view.step} quiet={view.status === 'waiting'} platform={badgePlatform} />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block truncate text-body font-medium',
                  view.status === 'waiting' ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {view.label}
              </span>
              <span className="block truncate text-meta tabular-nums text-muted-foreground">
                {view.detail ?? STATUS_TEXT[view.status]}
              </span>
            </span>
            <StepMark status={view.status} />
          </li>
        ))}
      </ul>

      {scanningSites ? (
        <p className="mt-group text-meta text-muted-foreground">
          Other public sites take a little longer. Everything else is ready to read.
        </p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Reads a streamed check (`POST /api/references/check`, one `CheckStreamEvent` per line)
 * and hands each event on as it arrives. A line that is not an event is skipped.
 */
export async function readCheckStream(
  response: Response,
  onEvent: (event: CheckStreamEvent) => void,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  const emit = (line: string) => {
    const text = line.trim();
    if (!text) return;
    try {
      onEvent(JSON.parse(text) as CheckStreamEvent);
    } catch {
      // Not an event (a proxy's padding, a cut-off line): nothing to act on.
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let lineEnd = pending.indexOf('\n');
    while (lineEnd !== -1) {
      emit(pending.slice(0, lineEnd));
      pending = pending.slice(lineEnd + 1);
      lineEnd = pending.indexOf('\n');
    }
  }
  emit(pending + decoder.decode());
}
