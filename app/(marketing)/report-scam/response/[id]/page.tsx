import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ShieldAlertIcon } from '@hugeicons/core-free-icons';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { formatShortDate } from '@/lib/format';
import { ScamReportResponseForm } from '@/components/scamReports/ScamReportResponseForm';

// app/(marketing)/report-scam/response/[id]/page.tsx
//
// Where a member answers a scam report staff told them about (scam-reports spec,
// Req 8). Reached from the notification `notifyScamReportMatch` sends.
//
// WHAT IT SHOWS. That a report involves details linked to their account, the deadline,
// and a box for their side. Never the reporter, the story, the evidence or which detail
// matched: the notice is the same for everyone, so it cannot be used to work out who
// reported them or what they said.
//
// A match the member was not told about, or one that is not theirs, is a 404, the same
// as a report that does not exist.

export const metadata: Metadata = {
  title: 'Respond to a report · NoDitto',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ScamReportResponsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const user = await getCachedAuthUser();
  if (!user) redirect(`/sign-in?redirectTo=${encodeURIComponent(`/report-scam/response/${id}`)}`);

  const { data: match } = await createAdminClient()
    .from('scam_report_matches')
    .select('notified_at, response_due_at, responded_at')
    .eq('report_id', id)
    .eq('profile_id', user.id)
    .not('notified_at', 'is', null)
    .maybeSingle();
  if (!match) notFound();

  const responded = Boolean(match.responded_at);
  const due = formatShortDate(match.response_due_at);

  return (
    <article className="mx-auto max-w-2xl px-group py-section sm:px-6 md:py-12">
      <header className="space-y-snug">
        <p className="inline-flex items-center gap-tight text-meta font-semibold uppercase tracking-wide text-iris-ink">
          <HugeiconsIcon icon={ShieldAlertIcon} className="size-4" aria-hidden />
          A report to check
        </p>
        <h1 className="text-head font-semibold tracking-tight text-foreground">
          {responded ? 'Thanks, we’ve got your response' : 'We need to check something with you'}
        </h1>
        <p className="text-pretty text-body text-muted-foreground md:text-lead">
          {responded
            ? `You sent it ${formatShortDate(match.responded_at) ?? 'recently'}. Our team will read it before deciding anything, and we'll let you know the outcome.`
            : 'Someone has reported a scam that happened outside NoDitto, and some of the details in it are linked to your account. That doesn’t mean we think you did anything wrong. Details get copied, shared and faked.'}
        </p>
      </header>

      {responded ? null : (
        <div className="mt-section space-y-group">
          <section aria-labelledby="response-how-heading" className="space-y-tight rounded-xl border border-border bg-muted/40 p-group">
            <h2 id="response-how-heading" className="text-body font-semibold text-foreground">
              What happens next
            </h2>
            <ul className="list-disc space-y-tight pl-5 text-pretty text-body text-muted-foreground">
              <li>Tell us your side{due ? ` by ${due}` : ''}. A person reads every response.</li>
              <li>We don&rsquo;t act on a single report, and we never take action without checking first.</li>
              <li>
                We can&rsquo;t tell you who sent the report or share what it says, the same way we&rsquo;d
                protect you if you reported someone.
              </li>
            </ul>
          </section>
          <ScamReportResponseForm reportId={id} />
        </div>
      )}
    </article>
  );
}
