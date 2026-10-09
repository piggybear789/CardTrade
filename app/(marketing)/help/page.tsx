import type { Metadata } from 'next';

import { HelpCentre } from '@/components/help/HelpCentre';
import { TRADE_INSPECTION_HOURS } from '@/domain/fulfilment/inspection';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

export const metadata: Metadata = {
  title: 'Help · NoDitto',
  description:
    'Answers on paying, inspection windows, selling, payouts, trades, identity checks and your account.',
};

export default async function HelpPage() {
  // Only to choose the contact route: the feedback form needs an account.
  const user = await getCachedAuthUser();

  return (
    // The header geometry of `PolicyArticle`, without its prose styling: that wrapper
    // turns every list inside it into a bulleted paragraph list, which the topic chips
    // and the answer list here are not.
    <article className="mx-auto max-w-3xl px-group py-section sm:px-6 md:py-12 lg:px-section">
      <h1 className="text-subhead font-semibold tracking-tight text-foreground md:text-head">
        How can we help?
      </h1>
      <p className="mt-snug text-body text-muted-foreground md:mt-cozy md:text-lead">
        Short answers on buying, selling, trades, payouts and your account.
      </p>
      <HelpCentre signedIn={Boolean(user)} tradeInspectionDays={TRADE_INSPECTION_HOURS / 24} />
    </article>
  );
}
