'use client';

// components/references/BackgroundCheckPanel.tsx
//
// Unified public footprint & background check card modeled on NoDitto's References
// design system (`ref-surface rounded-xl bg-card p-group sm:p-6`, globals.css,
// `PlatformChip`, `divide-y divide-border`, `tabular-nums`, flat internal tiles with
// single-level elevation).
//
// Sits directly on `/references/[handle]` (mode="profile") with the same walk fade
// (`opacity`), and backs non-handle lookups on `/references/check?q=...` (mode="standalone").

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon, type IconGlyph } from '@/components/ui/icon';
import {
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  CaretLeftIcon,
  ClockIcon,
  GlobeSimpleIcon,
  LinkIcon,
  MapPinIcon,
  ShieldCheckIcon,
  ShieldIcon,
  StarIcon,
  WarningCircleIcon,
} from '@/components/ui/icons';

import {
  CheckProgress,
  readCheckStream,
  type CheckStepResults,
} from '@/components/references/CheckProgress';
import { PlatformChip, Tag, type TagTone } from '@/components/references/referenceLabels';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { StatusGlyphKind } from '@/components/ui/status-glyph';
import {
  CHECK_STREAM_CONTENT_TYPE,
  type BackgroundCheckDossier,
  type CheckProfilePlatform,
  type FootprintJudgeWarning,
  type RealnessTier,
} from '@/domain/references/enrichment';
import {
  canonicalizeWebUrl,
  filterOpenWebMentions,
  formatWebMention,
  getEbayStarTier,
  parseEbaySaleTitle,
  parseInstagramBio,
} from '@/domain/references/footprintPresentation';
import type { FacebookIndexReport } from '@/domain/references/facebookIndex';
import type { ClaimPlatform } from '@/domain/references/reference';
import { cn } from '@/lib/utils';

/**
 * THE VERDICT IS A STATE TAG (`Tag`, referenceLabels.tsx: "When a tag, when an icon,
 * when text"): a white capsule beside the heading with the verdict's icon in its colour.
 * It was a SOLID green fill with a white tick, the heaviest object on the card, which
 * read as generated. Red flags take the danger tone, red from icon to word.
 */
// The states that carry a colour take a FILLED glyph (`status-glyph`); "Limited history"
// has no colour to carry, so it keeps a grey outline clock.
const VERDICT_STYLE: Record<RealnessTier, { icon: IconGlyph | StatusGlyphKind; tone: TagTone; label: string }> = {
  ID_VERIFIED: { icon: 'verified', tone: 'trust', label: 'ID-verified' },
  ESTABLISHED_FOOTPRINT: { icon: 'success', tone: 'trust', label: 'Looks established' },
  LIMITED_FOOTPRINT: { icon: ClockIcon, tone: 'neutral', label: 'Limited history' },
  WARNING_FLAGGED: { icon: 'danger', tone: 'danger', label: 'Red flags found' },
};

function buildFallbackSummary(dossier: BackgroundCheckDossier): string {
  if (dossier.scamRisk.matchedReportCount > 0) {
    return `Matches ${dossier.scamRisk.matchedReportCount} scam report${dossier.scamRisk.matchedReportCount === 1 ? '' : 's'} — do not send unprotected payment.`;
  }

  const parts: string[] = [];
  if (dossier.ebay?.found && dossier.ebay.feedbackScore !== null) {
    const pct = dossier.ebay.feedbackPercentage ? ` (${dossier.ebay.feedbackPercentage}% positive)` : '';
    const since = dossier.ebay.memberSince ? `, member since ${dossier.ebay.memberSince}` : '';
    parts.push(
      `eBay seller with ${dossier.ebay.feedbackScore.toLocaleString('en-US')} feedback${pct}${since}`,
    );
  } else if (dossier.ebay?.found) {
    parts.push(`confirmed eBay account @${dossier.ebay.username}`);
  }

  const vp = dossier.forensics?.visibleProfile;
  if (vp && vp.followersCount !== null) {
    parts.push(`Instagram profile with ${vp.followersCount.toLocaleString('en-US')} followers`);
  }

  if (parts.length > 0) {
    const joined =
      parts.length === 1
        ? parts[0]!
        : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}. Public signals from other sites.`;
  }

  return 'Public signals from other sites — separate from NoDitto references.';
}

function collectFallbackWarnings(dossier: BackgroundCheckDossier): FootprintJudgeWarning[] {
  const out: FootprintJudgeWarning[] = [];

  if (dossier.scamRisk.matchedReportCount > 0) {
    out.push({
      severity: 'HIGH',
      title: `Matched ${dossier.scamRisk.matchedReportCount} scam report${dossier.scamRisk.matchedReportCount === 1 ? '' : 's'}`,
      detail: `Matched on ${dossier.scamRisk.matchedKinds.join(', ')}. Avoid PayID or direct bank transfer.`,
    });
  } else if (dossier.scamRisk.nameMatchCount > 0) {
    out.push({
      severity: 'CAUTION',
      title: `${dossier.scamRisk.nameMatchCount} scam report${dossier.scamRisk.nameMatchCount === 1 ? '' : 's'} mention a similar name`,
      detail: 'Names can overlap — double-check payment details before sending money.',
    });
  }

  if (dossier.psaCert?.riskLevel === 'HIGH') {
    out.push({
      severity: 'HIGH',
      title: `PSA cert #${dossier.psaCert.certNumber} is listed elsewhere on eBay`,
      detail: dossier.psaCert.riskReason ?? 'Conflicting active eBay listing found for this cert.',
    });
  }

  if (dossier.priceComp && dossier.priceComp.riskLevel !== 'LOW' && dossier.priceComp.riskReason) {
    out.push({
      severity: dossier.priceComp.riskLevel === 'HIGH' ? 'HIGH' : 'CAUTION',
      title:
        dossier.priceComp.discountPercent !== null && dossier.priceComp.discountPercent > 0
          ? `Price is ${dossier.priceComp.discountPercent}% below live eBay median`
          : 'Unusual pricing vs eBay comps',
      detail: dossier.priceComp.riskReason,
    });
  }

  for (const flag of dossier.paymentForensics?.flags ?? []) {
    out.push({
      severity: flag.severity === 'HIGH' ? 'HIGH' : 'CAUTION',
      title: flag.label,
      detail: flag.detail,
    });
  }

  for (const flag of dossier.dmAnalysis?.flags ?? []) {
    out.push({
      severity: flag.severity === 'HIGH' ? 'HIGH' : 'CAUTION',
      title: flag.label,
      detail: flag.detail,
    });
  }

  for (const m of dossier.webMentions) {
    if (m.riskFlag === 'WARNING') {
      out.push({
        severity: 'HIGH',
        title: m.title,
        detail: m.snippet || `Flagged mention on ${m.sourceLabel}.`,
      });
    }
  }

  if (dossier.forensics && dossier.forensics.riskLevel !== 'LOW') {
    for (const flag of dossier.forensics.flags) {
      if (flag.severity === 'HIGH' || flag.severity === 'CAUTION') {
        out.push({
          severity: flag.severity,
          title: flag.label,
          detail: flag.detail,
        });
      }
    }
  }

  return out;
}

// ONE ICON SIZE DOWN THE CARD: 40px (`size-10`), for a platform logo, a seller's avatar
// and these badges alike, so every row's title starts on the same line. What hangs
// under a row is indented by that icon plus the row's gap (`sm:pl-[3.25rem]`).

/** The 40px circular icon badge for a row that has no platform logo. */
function RowBadge({
  icon,
  tone = 'neutral',
}: {
  icon: typeof GlobeSimpleIcon;
  tone?: 'neutral' | 'trust' | 'destructive';
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full border',
        tone === 'trust'
          ? 'border-trust/25 bg-trust/10 text-trust'
          : tone === 'destructive'
            ? 'border-destructive/30 bg-destructive/10 text-destructive'
            : 'border-border bg-muted/40 text-muted-foreground',
      )}
    >
      <Icon icon={icon} className="size-4" aria-hidden />
    </span>
  );
}

/** Seller avatar with anchored eBay badge and automatic fallback to `PlatformChip`. */
function EbaySellerAvatar({ avatarUrl, username }: { avatarUrl?: string | null; username: string }) {
  const [failed, setFailed] = useState(false);

  if (!avatarUrl || failed) {
    return <PlatformChip slug="ebay" className="size-10 shrink-0" />;
  }

  return (
    <div className="relative size-10 shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={avatarUrl}
        alt={`${username} eBay avatar`}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-10 rounded-full border border-border object-cover bg-muted"
      />
      <span className="absolute -right-0.5 -bottom-0.5 inline-flex size-5 items-center justify-center rounded-full bg-card ring-2 ring-card">
        <PlatformChip slug="ebay" className="size-full bg-card" />
      </span>
    </div>
  );
}

/** Crisp domain favicon with graceful fallback to `GlobeSimpleIcon`. */
function SiteFavicon({
  faviconUrl,
  label,
  size = 'md',
}: {
  faviconUrl: string | null;
  label: string;
  size?: 'sm' | 'md';
}) {
  const [failed, setFailed] = useState(false);
  const boxClass = size === 'sm' ? 'size-4 rounded-sm' : 'size-7 rounded-md';

  if (!faviconUrl || failed) {
    return (
      <span
        aria-hidden
        className={cn(
          'inline-flex shrink-0 items-center justify-center border border-border bg-muted/50 text-muted-foreground',
          boxClass,
        )}
      >
        <Icon icon={GlobeSimpleIcon} className={size === 'sm' ? 'size-2.5' : 'size-3.5'} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden border border-border bg-background',
        boxClass,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={faviconUrl}
        alt={`${label} icon`}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={size === 'sm' ? 'size-3.5 object-contain' : 'size-4 object-contain'}
      />
    </span>
  );
}

/** Active eBay item thumbnail with graceful omission if missing or broken. */
function ListingThumb({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-12 shrink-0 rounded-md border border-border bg-muted object-cover"
    />
  );
}

function getHostnameSafe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export function BackgroundCheckPanel({
  mode,
  compact = false,
  opacity = 1,
  initialQuery = '',
  initialPlatform = null,
  instagramAvatarPath = null,
  initialLocation = '',
  initialFacebookUrl = '',
  initialSecondaryHandle = '',
  initialDossier = null,
  autoRun = false,
  autoRunRefresh = false,
  onDossier,
}: {
  mode: 'profile' | 'search' | 'standalone';
  /** Compact default cap (2 sales / 2 web mentions) when paired above a populated References section. */
  compact?: boolean;
  /** The page's walk fade on `/references/[handle]`, matching `TrackRecordCard`. */
  opacity?: number;
  initialQuery?: string;
  initialPlatform?: ClaimPlatform | null;
  /**
   * The page person's own picture, when the page IS their Instagram account. The check
   * reads Instagram's figures, never its picture; the page already holds it.
   */
  instagramAvatarPath?: string | null;
  initialLocation?: string;
  initialFacebookUrl?: string;
  initialSecondaryHandle?: string;
  initialDossier?: BackgroundCheckDossier | null;
  autoRun?: boolean;
  /**
   * Whether the check run on arrival skips the 24-hour server cache. Off by default: a
   * fresh check is a web search plus two model calls (~47k input tokens), and a visit, a
   * reload or a walk back to someone already checked today should read the stored run.
   * On only when the page knows its stored run is missing fields it needs.
   */
  autoRunRefresh?: boolean;
  /**
   * Told about every dossier this panel shows: the one it was given, a fresh run, each
   * poll. The references page reads the eBay feedback from it to draw as references.
   */
  onDossier?: (dossier: BackgroundCheckDossier) => void;
}) {
  const [dossier, setDossier] = useState<BackgroundCheckDossier | null>(initialDossier);
  const reportDossier = useEffectEvent((next: BackgroundCheckDossier) => onDossier?.(next));
  useEffect(() => {
    if (dossier) reportDossier(dossier);
  }, [dossier]);
  const [showAllSites, setShowAllSites] = useState(false);
  const [showAllSales, setShowAllSales] = useState(false);
  const [showAllWeb, setShowAllWeb] = useState(false);
  const [loading, setLoading] = useState(Boolean(autoRun && !initialDossier));
  const [error, setError] = useState<string | null>(null);
  // The parts of the check being answered right now, as each comes back.
  const [stepResults, setStepResults] = useState<CheckStepResults>({});
  // Whether the check under way was asked for here (Refresh, Check now), not run by the
  // page on arrival. Only a check someone asked for is laid over the card while it runs:
  // they are waiting on it. One the page started fills the card in quietly.
  const [requested, setRequested] = useState(false);
  // Whose profile the check's second part reads, before the server says so itself.
  const profilePlatform: CheckProfilePlatform =
    initialPlatform === 'facebook' || (!initialPlatform && initialFacebookUrl.trim()) ? 'facebook' : 'instagram';

  const autoRanRef = useRef(false);

  const runCheck = useCallback(
    async (forceRefresh: boolean, byRequest = false) => {
      const targetQuery = (initialQuery || initialFacebookUrl || initialSecondaryHandle).trim();
      if (!targetQuery) return;

      setLoading(true);
      setRequested(byRequest);
      setStepResults({});
      setError(null);
      setShowAllSites(false);
      setShowAllSales(false);
      setShowAllWeb(false);

      const failed = 'Could not run check right now. Please try again.';
      try {
        // Asked for as a stream, so each part can be shown as it comes back.
        const res = await fetch('/api/references/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: CHECK_STREAM_CONTENT_TYPE },
          body: JSON.stringify({
            query: targetQuery,
            platform: initialPlatform,
            location: initialLocation.trim() || null,
            facebookUrl: initialFacebookUrl.trim() || null,
            secondaryHandle: initialSecondaryHandle.trim() || null,
            forceRefresh,
          }),
        });

        // Refused before it started (rate limit, bad input): a plain JSON error.
        if (!res.ok || !res.headers.get('content-type')?.includes(CHECK_STREAM_CONTENT_TYPE)) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(data?.error ?? failed);
          return;
        }

        let answered = false;
        await readCheckStream(res, (event) => {
          if (event.type === 'step') {
            setStepResults((known) => ({ ...known, [event.result.step]: event.result }));
          } else if (event.type === 'dossier') {
            answered = true;
            setDossier(event.dossier);
          } else {
            answered = true;
            setError(event.error);
          }
        });
        if (!answered) setError(failed);
      } catch {
        setError('Network error while checking. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [initialQuery, initialPlatform, initialLocation, initialFacebookUrl, initialSecondaryHandle],
  );

  // Auto-run once on mount when requested (both profile & standalone)
  useEffect(() => {
    if (!autoRun || autoRanRef.current) return;
    autoRanRef.current = true;
    void runCheck(autoRunRefresh);
  }, [autoRun, autoRunRefresh, runCheck]);

  // Poll while async OSINT worker is scanning additional platforms
  useEffect(() => {
    if (!dossier?.runId) return;
    if (dossier.status !== 'QUEUED' && dossier.status !== 'RUNNING') return;

    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/references/check?runId=${encodeURIComponent(dossier.runId!)}`,
          { cache: 'no-store' },
        );
        if (!res.ok || cancelled) return;
        const next = (await res.json()) as BackgroundCheckDossier;
        if (!cancelled) setDossier(next);
      } catch {
        // Retry next tick
      }
    }, 2_200);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dossier?.runId, dossier?.status]);

  // Loading state before first dossier arrives
  if (!dossier) {
    if (loading) {
      return (
        <div className="space-y-group" style={{ opacity }}>
          {mode === 'standalone' ? (
            <Link
              href="/references"
              className="inline-flex items-center gap-1.5 text-meta font-medium text-muted-foreground hover:text-foreground"
            >
              <Icon icon={CaretLeftIcon} className="size-3.5" aria-hidden />
              References
            </Link>
          ) : null}

          <section
            aria-busy
            className="ref-surface rounded-xl bg-card p-group sm:p-6"
          >
            <CheckProgress
              title="Checking digital footprint"
              starting
              results={stepResults}
              dossier={null}
              profilePlatform={profilePlatform}
            />
          </section>
        </div>
      );
    }

    return (
      <section
        className="ref-surface flex flex-col gap-cozy rounded-xl bg-card p-group sm:flex-row sm:items-center sm:justify-between sm:p-6"
        style={{ opacity }}
      >
        <div className="min-w-0">
          <h2 className="text-subhead font-semibold tracking-tight text-foreground">
            Digital footprint
          </h2>
          <p className="mt-tight text-body text-muted-foreground">
            {error ?? 'Public eBay feedback, recent sales, Instagram stats, and open-web mentions.'}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0 bg-foreground text-background hover:bg-foreground/90"
          onClick={() => void runCheck(true, true)}
        >
          Check now
        </Button>
      </section>
    );
  }

  const judge = dossier.judge ?? null;
  const effectiveTier = judge?.tier ?? dossier.assessment.tier;
  const isPolling = dossier.status === 'QUEUED' || dossier.status === 'RUNNING';
  // A check asked for here hides the card until it is whole: first while it is answered,
  // then while other public sites are still being scanned. What is under the cover is
  // the last check (or this one half-filled), so it is taken out of reach as well.
  const covered = requested && (loading || isPolling);
  const warnings = judge ? judge.warnings : collectFallbackWarnings(dossier);
  const hasHighWarning = warnings.some((w) => w.severity === 'HIGH');
  const verdict =
    effectiveTier === 'LIMITED_FOOTPRINT' && warnings.length > 0
      ? { icon: 'warning' as const, tone: 'caution' as const, label: 'Caution flags' }
      : VERDICT_STYLE[effectiveTier];
  const summaryText = judge?.summary || buildFallbackSummary(dossier);
  const hasLookalikeFlag = Boolean(
    dossier.forensics?.flags.some((f) => f.code === 'LOOKALIKE_OF_ESTABLISHED'),
  );
  const topLookalike = hasLookalikeFlag ? (dossier.lookalikes[0] ?? null) : null;

  const primaryMember = dossier.matchedMembers[0] ?? null;
  const primaryMemberHref = primaryMember
    ? primaryMember.handle && primaryMember.platform
      ? `/references/${encodeURIComponent(primaryMember.handle.replace(/^@/, ''))}?on=${encodeURIComponent(primaryMember.platform)}`
      : `/references/${primaryMember.id}`
    : null;

  const initialCap = compact ? 2 : 4;
  const ebay = dossier.ebay;
  const ebayStarTier = ebay?.found ? getEbayStarTier(ebay.feedbackScore) : null;
  const recentSales = ebay?.recentSales ?? [];
  const visibleSales = showAllSales ? recentSales : recentSales.slice(0, initialCap);
  const ebayPos12m = ebay?.positive12m ?? null;
  const ebayNeg12m = ebay?.negative12m ?? null;
  const ebay12mTotal =
    ebayPos12m !== null ? ebayPos12m + (ebayNeg12m ?? 0) : null;
  const ebay12mPosPct =
    ebay12mTotal && ebay12mTotal > 0 ? Math.round(((ebayPos12m ?? 0) / ebay12mTotal) * 100) : null;
  const ebayPctNum = ebay?.feedbackPercentage ? Number.parseFloat(ebay.feedbackPercentage) : null;

  const visibleProfile = dossier.forensics?.visibleProfile ?? null;
  const hasInstagramMetrics = Boolean(
    visibleProfile &&
      (visibleProfile.followersCount !== null ||
        visibleProfile.followingCount !== null ||
        visibleProfile.postsCount !== null ||
        visibleProfile.bio),
  );
  const igHandle = (visibleProfile?.handle || initialQuery || dossier.queryLabel)
    .replace(/^@/, '')
    .trim();
  const parsedIgBio = parseInstagramBio(visibleProfile?.bio);
  const facebookIndex = dossier.forensics?.facebookIndex ?? null;
  const dedupedWebMentions = filterOpenWebMentions(dossier.webMentions).map(formatWebMention);

  const webMentionUrlSet = new Set(dedupedWebMentions.map((m) => canonicalizeWebUrl(m.url)));
  const uniqueSherlock = dossier.sherlock.filter(
    (s) => !webMentionUrlSet.has(canonicalizeWebUrl(s.url)),
  );

  const visibleWebMentions = showAllWeb ? dedupedWebMentions : dedupedWebMentions.slice(0, initialCap);
  const visibleSherlock = showAllSites ? uniqueSherlock : uniqueSherlock.slice(0, 8);

  return (
    <div className="space-y-group" style={{ opacity }}>
      {mode === 'standalone' ? (
        <Link
          href="/references"
          className="inline-flex items-center gap-1.5 text-meta font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon icon={CaretLeftIcon} className="size-3.5" aria-hidden />
          References
        </Link>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/35 bg-destructive/5 px-4 py-2.5 text-meta text-destructive"
        >
          {error}
        </div>
      ) : null}

      <section
        aria-labelledby="bg-footprint-heading"
        aria-busy={covered}
        className="ref-surface rounded-xl bg-card p-group sm:p-6"
      >
        <div className="grid">
          <div className={cn('col-start-1 row-start-1 min-w-0', covered && 'invisible')} inert={covered}>
            {/* 1. HEADER + SCANNABLE SIGNAL STRIP */}
            <div>
          <div className="flex items-start justify-between gap-cozy">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {mode === 'standalone' ? (
                <h1
                  id="bg-footprint-heading"
                  className="break-all text-subhead font-semibold tracking-tight text-foreground md:text-head"
                >
                  {dossier.queryLabel}
                </h1>
              ) : mode === 'search' ? (
                <h2
                  id="bg-footprint-heading"
                  className="break-all text-subhead font-semibold tracking-tight text-foreground"
                >
                  {dossier.queryLabel}
                </h2>
              ) : (
                <h2
                  id="bg-footprint-heading"
                  className="text-subhead font-semibold tracking-tight text-foreground"
                >
                  Digital footprint
                </h2>
              )}
              <Tag icon={verdict.icon} tone={verdict.tone} className="ml-0.5">
                {verdict.label}
              </Tag>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={loading || isPolling}
              onClick={() => void runCheck(true, true)}
              aria-label="Refresh digital footprint"
              className="size-9 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
            >
              <Icon
                icon={ArrowClockwiseIcon}
                className={cn('size-4', (loading || isPolling) && 'animate-spin')}
                aria-hidden
              />
            </Button>
          </div>
          {/* ONE SENTENCE, AND THEN THE ROWS. A strip of pills used to sit here saying
              the sentence again (feedback, followers, no scam reports), and each row
              below says it a third time beside its own logo. The verdict and the
              sentence are the reading; the rows are the proof. A scan still running
              says so on its own row and on the Refresh button, not here as well. */}
          <p className="mt-1.5 text-body text-muted-foreground">{summaryText}</p>
        </div>

        {/* 2. WARNINGS BAND (LLM-judged / verified red flags & caution signals — hidden when clean) */}
        {warnings.length > 0 ? (
          <div
            role="status"
            inert={covered}
            className={cn(
              'mt-group rounded-lg border p-cozy',
              hasHighWarning
                ? 'border-destructive/25 bg-destructive/[0.04]'
                : 'border-action-border/50 bg-action/20',
            )}
          >
            <ul className="space-y-2.5">
              {warnings.map((w, idx) => (
                <li key={`${w.title}-${idx}`} className="flex items-start gap-2.5 text-body">
                  <Icon
                    icon={WarningCircleIcon}
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      w.severity === 'HIGH' ? 'text-destructive' : 'text-action-foreground',
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{w.title}</p>
                    <p className="text-meta text-muted-foreground">{w.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
            {topLookalike ? (
              <div className="mt-2.5 border-t border-border pt-2 text-meta">
                <span className="text-muted-foreground">Established lookalike: </span>
                <Link
                  href={`/references/${encodeURIComponent(topLookalike.handle.replace(/^@/, ''))}?on=${encodeURIComponent(topLookalike.platform)}`}
                  className="inline-flex items-center gap-1 font-semibold text-foreground underline underline-offset-4 hover:text-iris-ink"
                >
                  <span>@{topLookalike.handle}</span>
                  <span className="font-normal text-muted-foreground">
                    ({topLookalike.positiveRefs} positive {topLookalike.positiveRefs === 1 ? 'ref' : 'refs'})
                  </span>
                  <Icon icon={ArrowUpRightIcon} className="size-3 text-muted-foreground" aria-hidden />
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 3. EVIDENCE SECTIONS */}
        <ul className="mt-group divide-y divide-border border-t border-border pt-group" inert={covered}>
          {/* Section A: eBay */}
          <li className="py-group first:pt-0 last:pb-0">
            <div className="flex flex-col gap-cozy sm:flex-row sm:items-start sm:justify-between sm:gap-group">
              <div className="flex min-w-0 items-start gap-cozy">
                {ebay?.found ? (
                  <EbaySellerAvatar avatarUrl={ebay.avatarUrl} username={ebay.username} />
                ) : (
                  <PlatformChip slug="ebay" className="size-10 shrink-0" />
                )}
                <div className="min-w-0">
                  {ebay?.found ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={ebay.profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-full items-center gap-1 rounded-sm text-body font-semibold text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="break-all">@{ebay.username}</span>
                          <Icon
                            icon={ArrowUpRightIcon}
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          <span className="sr-only">on eBay (opens in a new tab)</span>
                        </a>
                        {/* eBay's feedback score as eBay itself prints it: the number and
                            its star, in text. It was a capsule tinted by tier, five colours
                            for one fact, each with its own tinted edge. The star keeps the
                            tier colour, the one place the tier means something to a
                            reader who knows eBay. */}
                        {ebayStarTier ? (
                          <span className="inline-flex items-center gap-1 text-meta tabular-nums text-muted-foreground">
                            <Icon
                              icon={StarIcon}
                              className={cn('size-3.5', ebayStarTier.iconClass)}
                              aria-hidden
                            />
                            <span>
                              <span className="font-medium text-foreground">
                                {ebay.feedbackScore?.toLocaleString('en-US')}
                              </span>{' '}
                              feedback
                            </span>
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
                        {/* SAYS "eBay" IN WORDS. The 20px logo on the avatar's corner was the
                            only thing naming the site, and the row read as one more handle. */}
                        <span className="font-medium text-foreground">eBay seller</span>
                        {ebay.memberSince ? (
                          <span className="inline-flex items-center gap-1">
                            <Icon icon={ClockIcon} className="size-3.5" aria-hidden />
                            Member since {ebay.memberSince}
                          </span>
                        ) : null}
                        {ebay.activeListingsCount > 0 ? (
                          <span className="tabular-nums">
                            {ebay.activeListingsCount} active{' '}
                            {ebay.activeListingsCount === 1 ? 'listing' : 'listings'}
                          </span>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-body font-semibold text-foreground">eBay</p>
                      <p className="text-meta text-muted-foreground">No matching eBay account found</p>
                    </>
                  )}
                </div>
              </div>

              {/* Right-side feedback score + 12m visual ratio bar */}
              {ebay?.found ? (
                <div className="flex flex-col gap-1 sm:items-end sm:text-right">
                  {ebay.feedbackPercentage || (ebay.feedbackScore !== null && ebay.feedbackScore > 0) ? (
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          'text-subhead font-semibold tabular-nums tracking-tight',
                          ebayPctNum !== null && ebayPctNum >= 97
                            ? 'text-trust'
                            : ebayPctNum !== null && ebayPctNum < 90
                              ? 'text-destructive'
                              : 'text-foreground',
                        )}
                      >
                        {ebay.feedbackPercentage
                          ? `${ebay.feedbackPercentage}%`
                          : ebay.feedbackScore!.toLocaleString('en-US')}
                      </span>
                      {ebay.feedbackPercentage ? (
                        <span className="text-meta text-muted-foreground">positive</span>
                      ) : (
                        <span className="text-meta text-muted-foreground">feedback</span>
                      )}
                    </div>
                  ) : (
                    <p className="text-meta font-medium text-muted-foreground">No feedback yet</p>
                  )}

                  {ebay12mPosPct !== null && ebay12mTotal !== null ? (
                    <div className="flex flex-col gap-1 sm:items-end">
                      <div
                        className="flex h-1.5 w-32 overflow-hidden rounded-full bg-destructive/30"
                        role="img"
                        aria-label={`Last 12 months: ${ebayPos12m} positive and ${ebayNeg12m ?? 0} negative`}
                      >
                        <div
                          className="h-full bg-trust"
                          style={{ width: `${ebay12mPosPct}%` }}
                        />
                      </div>
                      <p className="text-meta tabular-nums text-muted-foreground">
                        Last 12 months: {ebayPos12m} positive · {ebayNeg12m ?? 0} negative
                        {ebay.totalFeedback !== null && ebay.totalFeedback !== undefined
                          ? ` · ${ebay.totalFeedback.toLocaleString('en-US')} total`
                          : ''}
                      </p>
                    </div>
                  ) : ebay.totalFeedback !== null && ebay.totalFeedback !== undefined && ebay.totalFeedback > 0 ? (
                    <p className="text-meta tabular-nums text-muted-foreground">
                      {ebay.totalFeedback.toLocaleString('en-US')} total received
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Active eBay listings (with real thumbnails) */}
            {ebay?.sampleListings && ebay.sampleListings.length > 0 ? (
              <div className="mt-cozy sm:pl-[3.25rem]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-meta font-semibold text-foreground">Active listings</p>
                  <span className="text-meta tabular-nums text-muted-foreground">
                    {ebay.activeListingsCount} live
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {ebay.sampleListings.slice(0, 4).map((item) => (
                    <a
                      key={item.itemUrl}
                      href={item.itemUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ref-tile group flex items-center gap-2.5 rounded-xl border border-border bg-card p-2 hover:bg-muted/35"
                    >
                      <ListingThumb src={item.imageUrl} alt={item.title} />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-meta font-medium leading-snug text-foreground group-hover:underline">
                          {item.title}
                        </p>
                        {item.priceText ? (
                          <p className="mt-1 text-meta font-semibold tabular-nums text-foreground">
                            {item.priceText}
                          </p>
                        ) : null}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Verified recent eBay sales — 2-col visual cards with slab & category badges */}
            {recentSales.length > 0 ? (
              <div className="mt-cozy sm:pl-[3.25rem]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-meta font-semibold text-foreground">
                    Recent verified sales
                    <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                      ({recentSales.length})
                    </span>
                  </p>
                  {recentSales.length > initialCap ? (
                    <button
                      type="button"
                      onClick={() => setShowAllSales((v) => !v)}
                      className="text-meta font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {showAllSales ? 'Show less' : 'Show all'}
                    </button>
                  ) : null}
                </div>
                <div className={cn('grid grid-cols-1 gap-2', visibleSales.length > 1 && 'sm:grid-cols-2')}>
                  {visibleSales.map((sale, idx) => {
                    const parsed = parseEbaySaleTitle(sale.title, sale.when);
                    const inner = (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {parsed.gradeBadge ? (
                              <span
                                // FLAT TAGS: a fill and no edge, RevenueCat's "Case study"
                                // tag. A tinted edge on a 20px tag was a second outline
                                // inside the card's own.
                                className={cn(
                                  'inline-flex items-center rounded-sm px-1.5 py-1 text-meta font-medium tabular-nums leading-none',
                                  parsed.gradeBadge.highlight
                                    ? 'bg-iris/12 text-iris-ink'
                                    : 'bg-muted text-foreground',
                                )}
                              >
                                {parsed.gradeBadge.label}
                              </span>
                            ) : null}
                            {parsed.categoryBadge ? (
                              <span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-1 text-meta font-medium leading-none text-muted-foreground">
                                {parsed.categoryBadge}
                              </span>
                            ) : null}
                            {!parsed.gradeBadge && !parsed.categoryBadge && parsed.year ? (
                              <span className="inline-flex items-center rounded-sm bg-muted px-1.5 py-1 text-meta font-medium tabular-nums leading-none text-muted-foreground">
                                {parsed.year}
                              </span>
                            ) : null}
                          </div>
                          {sale.priceText ? (
                            <span className="shrink-0 text-body font-semibold tabular-nums text-foreground">
                              {sale.priceText}
                            </span>
                          ) : null}
                        </div>

                        <p className="mt-1.5 line-clamp-2 text-meta leading-snug text-foreground">
                          {parsed.cleanTitle}
                        </p>

                        <div className="mt-2 flex items-center justify-between gap-2 text-meta text-muted-foreground">
                          <span>{parsed.shortWhen ?? 'Verified sale'}</span>
                          {sale.itemId ? (
                            <span className="inline-flex items-center gap-0.5 font-medium text-muted-foreground group-hover:text-foreground">
                              View
                              <Icon icon={ArrowUpRightIcon} className="size-3" aria-hidden />
                            </span>
                          ) : null}
                        </div>
                      </>
                    );

                    // Only a sale that opens on eBay lifts on hover (`ref-tile`); one with no
                    // item to open is not a link and must not look like one.
                    const cardClasses =
                      'group flex flex-col justify-between rounded-xl border border-border bg-card p-3';

                    return sale.itemId ? (
                      <a
                        key={`${sale.itemId}-${idx}`}
                        href={`https://www.ebay.com.au/itm/${encodeURIComponent(sale.itemId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(cardClasses, 'ref-tile hover:bg-muted/30')}
                      >
                        {inner}
                      </a>
                    ) : (
                      <div key={`${sale.title}-${idx}`} className={cardClasses}>
                        {inner}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </li>

          {/* Section B: Instagram public profile */}
          {hasInstagramMetrics && visibleProfile ? (
            <li className="py-group first:pt-0 last:pb-0">
              <div className="flex flex-col gap-cozy sm:flex-row sm:items-center sm:justify-between sm:gap-group">
                <div className="flex min-w-0 items-start gap-cozy">
                  {/* THEIR PICTURE, with the site on its corner, like the eBay row. Only
                      when this row is the account the page is about: a picture from
                      one account is never put beside another's numbers. */}
                  {instagramAvatarPath && igHandle.toLowerCase() === initialQuery.trim().replace(/^@/, '').toLowerCase() ? (
                    <div className="relative size-10 shrink-0">
                      <Avatar
                        avatarPath={instagramAvatarPath}
                        displayName={visibleProfile.displayName ?? igHandle}
                        size="md"
                      />
                      <span className="absolute -right-0.5 -bottom-0.5 inline-flex size-5 items-center justify-center rounded-full bg-card ring-2 ring-card">
                        <PlatformChip slug="instagram" className="size-full bg-card" />
                      </span>
                    </div>
                  ) : (
                    <PlatformChip slug="instagram" className="size-10 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {igHandle && !/\s/.test(igHandle) ? (
                        <a
                          href={`https://www.instagram.com/${encodeURIComponent(igHandle)}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-full items-center gap-1 rounded-sm text-body font-semibold text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="break-all">
                            {visibleProfile.displayName ?? `@${igHandle}`}
                          </span>
                          <Icon
                            icon={ArrowUpRightIcon}
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        </a>
                      ) : (
                        <p className="text-body font-semibold text-foreground">
                          {visibleProfile.displayName ?? 'Instagram'}
                        </p>
                      )}
                      {visibleProfile.displayName && igHandle ? (
                        <span className="text-meta text-muted-foreground">@{igHandle}</span>
                      ) : null}
                      {/* On the name's line, as plain type like eBay's "in Australia". As a
                          pill on a line of its own it sat between the name and the bio. */}
                      {parsedIgBio.location ? (
                        <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
                          <Icon icon={MapPinIcon} className="size-3.5" aria-hidden />
                          {parsedIgBio.location}
                        </span>
                      ) : null}
                      {visibleProfile.isPrivate ? (
                        <span className="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-meta font-medium text-muted-foreground">
                          Private
                        </span>
                      ) : null}
                    </div>

                    {/* Parsed location + hobby tag badges instead of raw emoji bio text */}
                    {parsedIgBio.tags.length > 0 || parsedIgBio.cleanBio ? (
                      <div className="mt-1 space-y-1">
                        {parsedIgBio.tags.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {parsedIgBio.tags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center rounded-md border border-border bg-muted/35 px-2 py-0.5 text-meta font-medium text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {parsedIgBio.cleanBio ? (
                          <p className="line-clamp-2 text-meta text-muted-foreground">
                            {parsedIgBio.cleanBio}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-0.5 text-meta text-muted-foreground">Public Instagram profile</p>
                    )}
                  </div>
                </div>

                {/* Three figures, set as type on the row. No box around them: the card is
                    the container, and a tinted panel here was the heaviest thing on it. */}
                <dl className="flex shrink-0 gap-group sm:justify-end sm:gap-6 sm:text-right">
                  {(
                    [
                      ['Followers', visibleProfile.followersCount],
                      ['Following', visibleProfile.followingCount],
                      ['Posts', visibleProfile.postsCount],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex flex-col-reverse">
                      <dt className="text-meta text-muted-foreground">{label}</dt>
                      <dd className="text-body font-semibold tabular-nums text-foreground">
                        {value !== null ? value.toLocaleString('en-US') : '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          ) : null}

          {/* Section B2: Facebook, as search engines hold it. Facebook itself is never
              read (a logged-out visitor gets a login page), so this says what a search
              engine has indexed and nothing more. */}
          {facebookIndex ? <FacebookIndexRow report={facebookIndex} /> : null}

          {/* Section C: Open web & community mentions — 2-col visual cards with favicons, zero duplicate text */}
          {dedupedWebMentions.length > 0 ? (
            <li className="py-group first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-cozy">
                <div className="flex min-w-0 items-start gap-cozy">
                  <RowBadge icon={GlobeSimpleIcon} />
                  <div className="min-w-0">
                    <p className="text-body font-semibold text-foreground">
                      Open web &amp; community
                      <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                        ({dedupedWebMentions.length})
                      </span>
                    </p>
                    <p className="text-meta text-muted-foreground">
                      Public posts, community tags, and web listings
                    </p>
                  </div>
                </div>
                {dedupedWebMentions.length > initialCap ? (
                  <button
                    type="button"
                    onClick={() => setShowAllWeb((v) => !v)}
                    className="shrink-0 text-meta font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {showAllWeb ? 'Show less' : 'Show all'}
                  </button>
                ) : null}
              </div>

              {/* Two columns only when there are two to fill them: one mention in half a
                  row left the other half empty. */}
              <div
                className={cn(
                  'mt-cozy grid grid-cols-1 gap-snug sm:pl-[3.25rem]',
                  visibleWebMentions.length > 1 && 'sm:grid-cols-2',
                )}
              >
                {visibleWebMentions.map((m) => (
                  <a
                    key={m.id}
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'ref-tile group flex flex-col justify-between rounded-xl border p-3',
                      m.riskFlag === 'WARNING'
                        ? 'border-destructive/35 bg-destructive/[0.03] hover:bg-destructive/[0.06]'
                        : 'border-border bg-card hover:border-border hover:bg-muted/30',
                    )}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {m.platformChip ? (
                            <PlatformChip slug={m.platformChip} className="size-7 shrink-0" />
                          ) : (
                            <SiteFavicon faviconUrl={m.faviconUrl} label={m.sourceLabel} />
                          )}
                          <span className="truncate text-meta font-semibold text-foreground">
                            {m.sourceLabel}
                          </span>
                        </div>
                        <Icon
                          icon={ArrowUpRightIcon}
                          className="size-3.5 shrink-0 text-muted-foreground transition-[color,transform] duration-300 ease-enter group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
                          aria-hidden
                        />
                      </div>

                      <p className="mt-2 line-clamp-2 text-body font-medium leading-snug text-foreground">
                        {m.headline}
                      </p>

                      {m.excerpt ? (
                        <p className="mt-1 line-clamp-2 text-meta text-muted-foreground">
                          {m.excerpt}
                        </p>
                      ) : null}
                    </div>

                    {m.metaPills.length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        {m.metaPills.map((pill) => (
                          <span
                            key={pill}
                            className="inline-flex items-center rounded-sm bg-muted/60 px-1.5 py-0.5 text-meta font-medium tabular-nums text-muted-foreground"
                          >
                            {pill}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </a>
                ))}
              </div>
            </li>
          ) : null}

          {/* Section D: Scam database */}
          <li className="flex flex-col gap-cozy py-group first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-group">
            <div className="flex min-w-0 items-start gap-cozy">
              <RowBadge
                icon={dossier.scamRisk.matchedReportCount > 0 ? WarningCircleIcon : ShieldCheckIcon}
                tone={dossier.scamRisk.matchedReportCount > 0 ? 'destructive' : 'trust'}
              />
              <div className="min-w-0">
                <p className="text-body font-semibold text-foreground">Scam database</p>
                <p className="text-meta text-muted-foreground">
                  {dossier.scamRisk.matchedReportCount > 0
                    ? `Matched on ${dossier.scamRisk.matchedKinds.join(', ')}`
                    : dossier.scamRisk.nameMatchCount > 0
                      ? `${dossier.scamRisk.nameMatchCount} report(s) mention a similar name`
                      : 'Checked against reported handles and payment details'}
                </p>
              </div>
            </div>
            {/* Plain type when it is clean: the row's badge is already green, and the
                verdict at the top is the one pill. A match is the exception, and keeps
                its fill so it cannot be read past. */}
            {dossier.scamRisk.matchedReportCount > 0 ? (
              <span className="inline-flex items-center self-start rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-meta font-semibold tabular-nums text-destructive sm:self-auto">
                {dossier.scamRisk.matchedReportCount} match
                {dossier.scamRisk.matchedReportCount === 1 ? '' : 'es'}
              </span>
            ) : (
              <p className="text-body font-semibold text-trust sm:text-right">No reports</p>
            )}
          </li>

          {/* Section E: NoDitto references (search/standalone mode only) */}
          {mode !== 'profile' ? (
            <li className="flex flex-col gap-cozy py-group first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-group">
              <div className="flex min-w-0 items-start gap-cozy">
                <PlatformChip slug="noditto" className="size-10 shrink-0" />
                <div className="min-w-0">
                  {primaryMemberHref ? (
                    <Link
                      href={primaryMemberHref}
                      className="inline-flex max-w-full items-center gap-1 rounded-sm text-body font-semibold text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span>NoDitto references</span>
                      <Icon
                        icon={ArrowUpRightIcon}
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </Link>
                  ) : (
                    <p className="text-body font-semibold text-foreground">NoDitto references</p>
                  )}
                  <p className="text-meta text-muted-foreground">
                    ID-verified trader vouches on NoDitto
                  </p>
                </div>
              </div>
              <div className="sm:text-right">
                <p className="text-body font-semibold tabular-nums text-foreground">
                  {primaryMember && primaryMember.positiveRefs > 0
                    ? `${primaryMember.positiveRefs} positive`
                    : 'None yet'}
                </p>
                {primaryMember?.identityVerified ? (
                  <p className="text-meta text-trust">ID-verified member</p>
                ) : null}
              </div>
            </li>
          ) : null}

          {/* Section F: Other public sites (Sherlock handle matches with favicons) */}
          {uniqueSherlock.length > 0 || isPolling ? (
            <li className="py-group first:pt-0 last:pb-0">
              <div className="flex flex-col gap-cozy sm:flex-row sm:items-center sm:justify-between sm:gap-group">
                <div className="flex min-w-0 items-start gap-cozy">
                  <RowBadge icon={LinkIcon} />
                  <div className="min-w-0">
                    <p className="text-body font-semibold text-foreground">Other public sites</p>
                    <p className="text-meta text-muted-foreground">
                      Same handle found elsewhere (not verified as the same person)
                    </p>
                  </div>
                </div>
                <p className="text-meta font-medium tabular-nums text-muted-foreground sm:text-right">
                  {uniqueSherlock.length > 0
                    ? `${uniqueSherlock.length} ${uniqueSherlock.length === 1 ? 'site' : 'sites'}`
                    : 'Scanning…'}
                </p>
              </div>

              {uniqueSherlock.length > 0 ? (
                <div className="mt-cozy flex flex-wrap items-center gap-1.5 sm:pl-[3.25rem]">
                  {visibleSherlock.map((match) => {
                    const host = getHostnameSafe(match.url);
                    const fav = host
                      ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`
                      : null;
                    return (
                      <a
                        key={`${match.site}:${match.url}`}
                        href={match.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-card py-1 pr-2.5 pl-1.5 text-meta font-medium text-foreground transition-colors hover:border-input-hover hover:bg-accent"
                      >
                        <SiteFavicon faviconUrl={fav} label={match.site} size="sm" />
                        {match.site}
                        <Icon
                          icon={ArrowUpRightIcon}
                          className="size-3 text-muted-foreground"
                          aria-hidden
                        />
                      </a>
                    );
                  })}
                  {uniqueSherlock.length > 8 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllSites((v) => !v)}
                      className="px-1.5 py-1 text-meta font-medium text-muted-foreground hover:text-foreground"
                    >
                      {showAllSites ? 'Show less' : `+${uniqueSherlock.length - 8} more`}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ) : null}

          {/* Optional Row: Wayback Machine */}
          {dossier.forensics?.waybackFirstSeen ? (
            <li className="flex flex-col gap-cozy py-group first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-group">
              <div className="flex min-w-0 items-start gap-cozy">
                <RowBadge icon={ClockIcon} />
                <div className="min-w-0">
                  <p className="text-body font-semibold text-foreground">Web archive</p>
                  <p className="text-meta text-muted-foreground">Earliest Wayback Machine snapshot</p>
                </div>
              </div>
              <p className="text-body font-semibold tabular-nums text-foreground sm:text-right">
                {dossier.forensics.waybackFirstSeen}
              </p>
            </li>
          ) : null}

          {/* Optional Row: PSA Cert */}
          {dossier.psaCert ? (
            <li className="py-group first:pt-0 last:pb-0">
              <div className="flex flex-col gap-cozy sm:flex-row sm:items-center sm:justify-between sm:gap-group">
                <div className="flex min-w-0 items-start gap-cozy">
                  <RowBadge
                    icon={ShieldIcon}
                    tone={dossier.psaCert.riskLevel === 'HIGH' ? 'destructive' : 'trust'}
                  />
                  <div className="min-w-0">
                    <a
                      href={dossier.psaCert.psaVerifyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full items-center gap-1 rounded-sm text-body font-semibold text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span>PSA Cert #{dossier.psaCert.certNumber}</span>
                      <Icon
                        icon={ArrowUpRightIcon}
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </a>
                    {dossier.psaCert.psaCardTitle ? (
                      <p className="text-meta text-muted-foreground">
                        {dossier.psaCert.psaCardTitle}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
              {dossier.psaCert.ebayMatches.length > 0 ? (
                <div className="mt-cozy space-y-1.5 sm:pl-[3.25rem]">
                  {dossier.psaCert.ebayMatches.map((m) => (
                    <a
                      key={m.itemUrl}
                      href={m.itemUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.03] px-3 py-1.5 text-meta hover:bg-destructive/[0.06]"
                    >
                      <span className="truncate font-medium text-foreground">{m.title}</span>
                      {m.priceValue !== null ? (
                        <span className="shrink-0 font-semibold tabular-nums text-foreground">
                          {m.priceCurrency} {m.priceValue.toFixed(0)}
                        </span>
                      ) : null}
                    </a>
                  ))}
                </div>
              ) : null}
            </li>
          ) : null}

          {/* Optional Row: Price check */}
          {dossier.priceComp && dossier.priceComp.sampleCount > 0 ? (
            <li className="flex flex-col gap-cozy py-group first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-group">
              <div className="flex min-w-0 items-start gap-cozy">
                <PlatformChip slug="ebay" className="size-10 shrink-0" />
                <div className="min-w-0">
                  <p className="text-body font-semibold text-foreground">Market price comp</p>
                  <p className="text-meta text-muted-foreground">
                    Compared against {dossier.priceComp.sampleCount} live eBay listings
                  </p>
                </div>
              </div>
              <div className="sm:text-right">
                <p className="text-body font-semibold tabular-nums text-foreground">
                  Asking {dossier.priceComp.currency}{' '}
                  {dossier.priceComp.askingPrice.toLocaleString('en-US')}
                </p>
                {dossier.priceComp.medianPrice !== null ? (
                  <p className="text-meta tabular-nums text-muted-foreground">
                    eBay median {dossier.priceComp.currency}{' '}
                    {dossier.priceComp.medianPrice.toLocaleString('en-US')}
                  </p>
                ) : null}
              </div>
            </li>
          ) : null}

          {/* Optional Row: Payment / Bank */}
          {dossier.paymentForensics?.bsbBankName ? (
            <li className="flex flex-col gap-cozy py-group first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-group">
              <div className="flex min-w-0 items-start gap-cozy">
                <RowBadge icon={ShieldIcon} />
                <div className="min-w-0">
                  <p className="text-body font-semibold text-foreground">Bank (BSB)</p>
                  <p className="text-meta text-muted-foreground">Resolved from payment details</p>
                </div>
              </div>
              <p className="text-body font-semibold text-foreground sm:text-right">
                {dossier.paymentForensics.bsbBankName}
              </p>
            </li>
          ) : null}
        </ul>

          </div>

          {/* A CHECK SOMEONE ASKED FOR, RUNNING. Stacked in the same grid cell on an
              opaque card surface (with the previous check marked `invisible` underneath)
              so nothing bleeds through, the card never shrinks below its prior height,
              and a shorter card on mobile still grows cleanly to fit the progress rows. */}
          {covered ? (
            <div className="col-start-1 row-start-1 z-10 min-w-0 bg-card duration-150 animate-in fade-in-0 motion-reduce:animate-none">
              <CheckProgress
                title="Refreshing digital footprint"
                starting={loading}
                results={stepResults}
                dossier={loading ? null : dossier}
                profilePlatform={profilePlatform}
              >
                {!loading ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-cozy border-border"
                    onClick={() => setRequested(false)}
                  >
                    Show results so far
                  </Button>
                ) : null}
              </CheckProgress>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

const FACEBOOK_SECTION_LABEL: Record<string, string> = {
  profile: 'Profile',
  photos: 'Photos',
  photos_by: 'Photos',
  about: 'About',
  posts: 'Posts',
  friends: 'Friends',
  videos: 'Videos',
  reels: 'Reels',
  followers: 'Followers',
};

function facebookSectionLabel(section: string): string {
  return FACEBOOK_SECTION_LABEL[section] ?? section.charAt(0).toUpperCase() + section.slice(1);
}

/**
 * One Facebook profile, as search engines hold it: the indexed name, the Intro facts a
 * public snippet carries, which of the profile's pages are public, and other accounts
 * indexed under the same name. Facebook itself is never read.
 *
 * Friends and followers always draw, as "—" when unknown, so the row keeps its height.
 */
function FacebookIndexRow({ report }: { report: FacebookIndexReport }) {
  const sections = Array.from(new Set(report.pages.map((p) => facebookSectionLabel(p.section))));
  const facts = [
    report.worksAt ? `Works at ${report.worksAt}` : null,
    report.studiedAt ? `Studied at ${report.studiedAt}` : null,
    report.from ? `From ${report.from}` : null,
  ].filter((f): f is string => Boolean(f));
  const sameName = report.sameNameAccounts;

  return (
    <li className="py-group first:pt-0 last:pb-0">
      <div className="flex flex-col gap-cozy sm:flex-row sm:items-center sm:justify-between sm:gap-group">
        <div className="flex min-w-0 items-start gap-cozy">
          <PlatformChip slug="facebook" className="size-10 shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={report.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-sm text-body font-semibold text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="break-all">{report.displayName ?? `facebook.com/${report.slug}`}</span>
                <Icon icon={ArrowUpRightIcon} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </a>
              {report.displayName && report.nameSource === 'SLUG' ? (
                <span className="text-meta text-muted-foreground">name guessed from the link</span>
              ) : null}
              {report.livesIn ? (
                <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
                  <Icon icon={MapPinIcon} className="size-3.5" aria-hidden />
                  {report.livesIn}
                </span>
              ) : null}
            </div>
            {facts.length > 0 ? (
              <p className="mt-0.5 line-clamp-2 text-meta text-muted-foreground">{facts.join(' · ')}</p>
            ) : null}
            <p className="mt-0.5 text-meta text-muted-foreground">
              {report.indexed
                ? `In search engines: ${sections.join(', ')}`
                : 'Not in search engines. Many people hide their profile from search, so this proves nothing on its own.'}
            </p>
          </div>
        </div>

        <dl className="flex shrink-0 gap-group sm:justify-end sm:gap-6 sm:text-right">
          {(
            [
              ['Friends', report.friendsCount],
              ['Followers', report.followersCount],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex flex-col-reverse">
              <dt className="text-meta text-muted-foreground">{label}</dt>
              <dd className="text-body font-semibold tabular-nums text-foreground">
                {value !== null ? value.toLocaleString('en-US') : '—'}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {sameName.length > 0 && report.displayName ? (
        <div className="mt-cozy rounded-xl border border-border bg-muted/30 p-3 sm:ml-[3.25rem]">
          <p className="text-meta font-semibold text-foreground">
            {sameName.length} other Facebook {sameName.length === 1 ? 'account' : 'accounts'} named &ldquo;
            {report.displayName}&rdquo;
          </p>
          <p className="mt-0.5 text-meta text-muted-foreground">
            Scammers copy a real person&rsquo;s name and photos onto a new account. Compare the link, not the name,
            with the one you have dealt with before. Many real people share a name.
          </p>
          <ul className="mt-snug flex flex-wrap gap-1.5">
            {sameName.map((account) => (
              <li key={account.slug}>
                <a
                  href={account.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-meta font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  facebook.com/{account.slug}
                  <Icon icon={ArrowUpRightIcon} className="size-3" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}
