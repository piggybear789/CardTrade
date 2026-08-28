// app/admin/arbitration/[kind]/[ref]/page.tsx
//
// One arbitration case. Thin route: narrow the params, gate, fetch, delegate — the same
// shape as `/trades/[id]`, `/sales/[id]` and `/deals/[id]`, which hand their whole room
// to a component. The case body lives in `components/arbitration/ArbitrationCaseView`.
//
// WHY THIS SURFACE EXISTS SEPARATELY FROM /admin. Dispute resolution used to be a card
// in a stack on the moderation console, which meant an arbitrator committing a
// four-figure capture read the claim, the collateral figures and the parties' names in a
// 200px box between a community report and a payout retry button. A decision that
// irreversible deserves the whole viewport and a stable URL a second arbitrator can be
// pointed at.
//
// Gated on `requireStaff` through the action, and every control re-checks its own gate.

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ShieldAlertIcon } from '@hugeicons/core-free-icons';

import { getArbitrationCase } from '@/lib/actions/arbitration';
import { parseCaseKind } from '@/domain/arbitration/arbitrationCase';
import {
  ArbitrationCaseView,
  CASE_KIND_LABEL,
} from '@/components/arbitration/ArbitrationCaseView';
import { CaseAssignButton } from '@/components/arbitration/CaseAssignButton';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader } from '@/components/layout/SectionHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { formatAud } from '@/lib/format';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'Case · NoDitto',
};

// Live case state and staff capability — never prerender.
export const dynamic = 'force-dynamic';

export default async function ArbitrationCasePage({
  params,
}: {
  params: Promise<{ kind: string; ref: string }>;
}) {
  const { kind: rawKind, ref } = await params;
  const kind = parseCaseKind(rawKind);
  if (!kind) notFound();

  const result = await getArbitrationCase(kind, ref);

  if (!result.ok) {
    if (result.error === 'not-authenticated') {
      redirect(`/sign-in?redirectTo=/admin/arbitration/${kind}/${ref}`);
    }
    if (result.error === 'not-authorized') {
      // Refuse without leaking whether the case exists.
      return (
        <MarketplaceShell title="Cases" center>
          <EmptyState
            variant="page"
            icon={<HugeiconsIcon icon={ShieldAlertIcon} className="size-6" aria-hidden />}
            title="Not Authorized"
            titleAs="h3"
            description="Cases are limited to NoDitto support staff."
            action={{ label: 'Return home', href: '/', variant: 'outline' }}
          />
        </MarketplaceShell>
      );
    }
    // `not-found` also covers a case that has already been decided: it left the queue,
    // so there is nothing here to act on any more.
    return (
      <MarketplaceShell title="Cases" center>
        <EmptyState
          variant="page"
          title="Case Closed"
          titleAs="h3"
          description="This case is no longer open. It may have been resolved by another arbitrator."
          action={{ label: 'Back to the queue', href: '/admin/arbitration' }}
        />
      </MarketplaceShell>
    );
  }

  const { case: c, contractHref, viewerId } = result.data;

  return (
    <MarketplaceShell title="Cases">
      <SectionHeader
        title={c.title}
        description={
          <>
            {CASE_KIND_LABEL[c.kind] ?? c.kind} · {formatAud(c.amountAtRiskCents)} at stake
            {contractHref ? (
              <>
                {' · '}
                <Link
                  href={contractHref}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  View the contract as the parties see it
                </Link>
              </>
            ) : null}
          </>
        }
        actions={
          <CaseAssignButton
            caseKind={c.kind}
            caseRef={c.ref}
            assigneeId={c.assigneeId}
            assigneeName={c.assigneeName}
            viewerId={viewerId}
          />
        }
      />

      <ArbitrationCaseView detail={result.data} />
    </MarketplaceShell>
  );
}
