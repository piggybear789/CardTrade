import type { Metadata } from 'next';
import Link from 'next/link';

import { StartDealTextLink } from '@/components/deals/StartDealButton';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';

import { PolicyArticle } from '../policy-article';

export const metadata: Metadata = {
  title: 'Help · NoDitto',
  description:
    'How identity, Stripe holds, password reset, and trades work on NoDitto.',
};

export default async function HelpPage() {
  const user = await getCachedAuthUser();
  const isAuthenticated = Boolean(user);

  return (
    <PolicyArticle
      title="Help"
      lede="Short answers for identity, money movement, passwords, and private deals."
    >
      <section id="identity" className="space-y-3 scroll-mt-24">
        <h2>Identity</h2>
        <p>
          Identity is checked through Stripe Identity: you submit a government
          document and a selfie, Stripe checks them, and NoDitto records the
          result on your profile.
        </p>
        <p>
          A verified status tells counterparties that Stripe accepted that
          identity check. It is not a credit score, a guarantee of performance,
          or a licensed professional accreditation. Listing, selling, and
          entering a trade as a disclosed counterparty require it. Receiving
          payouts is a separate Stripe Connect step.
        </p>
        <p>
          Start the check from{' '}
          <Link
            href="/profile?tab=verification"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Verification
          </Link>{' '}
          after you sign in.
        </p>
      </section>

      <section id="holds" className="space-y-3 scroll-mt-24">
        <h2>How holds and collection work</h2>
        <p>
          Trade collateral is a temporary Stripe card hold — an uncaptured card
          authorisation. While the trade proceeds normally, that amount is a
          claim on the card, not money sitting in a NoDitto account. Cash-sale
          payments are collected by Stripe when the buyer pays.
        </p>
        <p>
          Neither mechanism is licensed escrow, a trust account, or a custodial
          deposit that NoDitto holds as trustee. Stripe is the payment provider.
          If a contract is disputed, support can freeze movement and review the
          case. That is an operational hold and review, not a promise that every
          loss will be covered.
        </p>
      </section>

      <section id="passwords" className="space-y-3 scroll-mt-24">
        <h2>Passwords</h2>
        <p>
          On the sign-in form, use Forgot password and enter the email on the
          account. If that email is registered, we send a reset link to{' '}
          <Link
            href="/forgot-password"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            request a reset
          </Link>
          . The confirmation screen is the same whether or not an account exists,
          so a visitor cannot use this flow to check emails.
        </p>
        <p>
          The link returns you to NoDitto, opens a short-lived session, and
          lands on the reset page so you can choose a new password. If the link
          has expired, request another one.
        </p>
      </section>

      <section id="deals-as-trades" className="space-y-3 scroll-mt-24">
        <h2>Private deals</h2>
        <p>
          A private deal is two people who already know each other using NoDitto
          as escrow. It is not only a card-for-card swap. Send a link: they join,
          and you finish in the same rooms as a public listing.
        </p>
        <p>
          Cash for a card is paid, held, and arbitrated as a sale. A trade
          (cards both ways, cash only to even) uses the trade room and trade
          collateral. The cards on a private deal stay unlisted — they never
          appear in the marketplace.
        </p>
        <p>
          Open{' '}
          <StartDealTextLink
            isAuthenticated={isAuthenticated}
            className="font-medium text-primary underline-offset-4 hover:underline"
          />{' '}
          to create a link, or check{' '}
          <Link
            href="/sales"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sales
          </Link>{' '}
          and{' '}
          <Link
            href="/trades"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Trades
          </Link>{' '}
          for unused invites and live contracts.
        </p>
      </section>
    </PolicyArticle>
  );
}
