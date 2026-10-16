import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ShieldAlertIcon } from '@hugeicons/core-free-icons';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { formatShortDate } from '@/lib/format';
import { regionCurrency } from '@/domain/region';
import {
  SCAM_PAYMENT_METHODS,
  reporterFacingStatus,
  type ScamReportStatus,
} from '@/domain/risk/scamReportVocabulary';
import { ScamReportForm } from '@/components/scamReports/ScamReportForm';
import { WithdrawScamReportButton } from '@/components/scamReports/WithdrawScamReportButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// app/(marketing)/report-scam/(form)/page.tsx
//
// Report a scam that happened OFF NoDitto (scam-reports spec, Req 1–3).
//
// WHO CAN REPORT. Signed in (the proxy sends anyone else to sign-in) and ID-verified,
// so every report traces back to a real, checked person. A member who has not verified
// sees why, and the way to do it, instead of the form.
//
// WHAT THE REPORTER SEES. Their own reports, each as Received / Reviewed / Closed /
// Withdrawn, and nothing else: never whether it matched anyone, and never whether
// anybody else reported the same details. Read with the service role keyed by their
// own id, because the 0154 tables carry no member grant.

export const metadata: Metadata = {
  title: 'Report a scam · NoDitto',
  robots: { index: false },
};

const METHOD_LABEL = new Map<string, string>(SCAM_PAYMENT_METHODS.map((option) => [option.value, option.label]));

const STATUS_VARIANT: Record<ScamReportStatus, 'default' | 'secondary' | 'outline'> = {
  SUBMITTED: 'secondary',
  REVIEWED: 'default',
  CORROBORATED: 'default',
  DISMISSED: 'outline',
  WITHDRAWN: 'outline',
};

function monthLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? isoDate
    : date.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default async function ReportScamPage() {
  const user = await getCachedAuthUser();
  if (!user) redirect('/sign-in?redirectTo=%2Freport-scam');

  const admin = createAdminClient();
  const [{ data: profile }, { data: reports }] = await Promise.all([
    admin
      .from('profiles')
      .select('identity_check_status, region_code, fraud_banned_at, closed_at')
      .eq('id', user.id)
      .maybeSingle(),
    // Own reports, own columns only: no staff notes, reviewer or dismissal reason.
    admin
      .from('scam_reports')
      .select('id, status, created_at, occurred_month, payment_method')
      .eq('reporter_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const verified = profile?.identity_check_status === 'VERIFIED';
  const blocked = Boolean(profile?.fraud_banned_at || profile?.closed_at);
  const currency = regionCurrency(profile?.region_code) ?? 'aud';
  const ownReports = reports ?? [];

  return (
    <article className="mx-auto max-w-2xl px-group py-section sm:px-6 md:py-12">
      <header className="space-y-snug">
        <p className="inline-flex items-center gap-tight text-meta font-semibold uppercase tracking-wide text-iris-ink">
          <HugeiconsIcon icon={ShieldAlertIcon} className="size-4" aria-hidden />
          Report a scam
        </p>
        <h1 className="text-head font-semibold tracking-tight text-foreground">
          Been scammed outside NoDitto?
        </h1>
        <p className="text-pretty text-body text-muted-foreground md:text-lead">
          Tell us about a card deal that went wrong on Instagram, Facebook or anywhere else. We
          can&rsquo;t get your money back, but we check every report by hand, and if the same
          person turns up here we can stop them.
        </p>
      </header>

      <div className="mt-section space-y-group">
        <section
          aria-labelledby="scam-first-heading"
          className="space-y-tight rounded-xl border border-border bg-muted/40 p-group"
        >
          <h2 id="scam-first-heading" className="text-body font-semibold text-foreground">
            Do these first
          </h2>
          <ul className="list-disc space-y-tight pl-5 text-pretty text-body text-muted-foreground">
            <li>Call your bank or payment provider now. They can sometimes stop or recall a payment.</li>
            <li>
              In Australia, report it to{' '}
              <a
                href="https://www.cyber.gov.au/report-and-recover/report"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-iris-ink underline-offset-4 hover:underline"
              >
                ReportCyber
              </a>{' '}
              and{' '}
              <a
                href="https://www.scamwatch.gov.au/report-a-scam"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-iris-ink underline-offset-4 hover:underline"
              >
                Scamwatch
              </a>
              . Elsewhere, report it to your local police.
            </li>
          </ul>
        </section>

        {blocked ? (
          <p className="rounded-xl border border-border bg-card p-group text-pretty text-body text-muted-foreground">
            This account can&rsquo;t send reports.
          </p>
        ) : !verified ? (
          <section
            aria-labelledby="scam-verify-heading"
            className="flex flex-col gap-cozy rounded-xl border border-border bg-card p-group sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-tight">
              <h2 id="scam-verify-heading" className="text-body font-semibold text-foreground">
                Verify your ID first
              </h2>
              <p className="text-pretty text-body text-muted-foreground">
                We only take reports from members who&rsquo;ve checked a photo ID with Stripe, so
                every report comes from a real person. It takes a few minutes.
              </p>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <Link href="/profile?tab=verification">Verify ID</Link>
            </Button>
          </section>
        ) : (
          <ScamReportForm currency={currency} />
        )}

        {ownReports.length > 0 ? (
          <section aria-labelledby="scam-yours-heading" className="space-y-snug">
            <h2 id="scam-yours-heading" className="text-lead font-semibold text-foreground">
              Your reports
            </h2>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {ownReports.map((report) => {
                const status = report.status as ScamReportStatus;
                const open = status !== 'DISMISSED' && status !== 'WITHDRAWN';
                return (
                  <li key={report.id} className="flex flex-wrap items-center justify-between gap-snug p-group">
                    <div className="min-w-0 space-y-tight">
                      <p className="text-body font-medium text-foreground">
                        {METHOD_LABEL.get(report.payment_method) ?? 'Scam'} · {monthLabel(report.occurred_month)}
                      </p>
                      <p className="text-meta text-muted-foreground">Sent {formatShortDate(report.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-snug">
                      <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>{reporterFacingStatus(status)}</Badge>
                      {open ? <WithdrawScamReportButton reportId={report.id} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-pretty text-meta text-muted-foreground">
              We won&rsquo;t tell you whether a report matched anyone. That keeps reports from being
              used to look people up.
            </p>
          </section>
        ) : null}
      </div>
    </article>
  );
}
