import type { Metadata } from 'next';

import { PolicyArticle } from '../policy-article';

export const metadata: Metadata = {
  title: 'Terms · NoDitto',
  description:
    'Terms of use for NoDitto — marketplace rules, Stripe payments, and identity verification.',
};

export default function TermsPage() {
  return (
    <PolicyArticle
      title="Terms of use"
      lede="These terms describe how NoDitto works. They are a product policy, not legal advice, and they have not been reviewed by counsel."
    >
      <h2>The service</h2>
      <p>
        NoDitto is a peer-to-peer marketplace and clearinghouse for collectibles.
        Members list items, agree terms, and complete cash sales or trades with
        each other. NoDitto provides the contract workflow, identity product, and
        payment integration. It does not buy or sell the goods.
      </p>

      <h2>Stripe and money movement</h2>
      <p>
        Payments, payouts, card authorisations, and collected funds are handled
        by Stripe. When a trade requires collateral, Stripe places a temporary
        card hold (an uncaptured authorisation). When a cash sale is paid,
        Stripe collects the purchase amount. Those are Stripe payment operations.
      </p>
      <p>
        NoDitto is not a bank, licensed escrow agent, or trustee. It does not
        operate a trust account and does not market licensed escrow. Holding a
        card authorisation or collecting a payment through Stripe is not the
        same as a licensed escrow or trust service.
      </p>

      <h2>Identity</h2>
      <p>
        Verification is performed through Stripe Identity (government document
        and selfie). An identity check identifies a member; it does not
        guarantee that a transaction will complete, that goods match the
        listing, or that a counterparty will perform.
      </p>

      <h2>Contracts and responsibility</h2>
      <p>
        Each cash sale or trade is an agreement between the members on that
        contract. You are responsible for the items you list, the terms you
        accept, and the goods you ship or hand over. Support can freeze funds
        or holds for review when a dispute is opened. That review is an
        operational process, not a promise that every loss will be made good.
      </p>

      <h2>Accounts</h2>
      <p>
        You must provide accurate account details and keep your password
        confidential. Creating an account means you accept these Terms and the
        Privacy policy. NoDitto may suspend an account after a staff-confirmed
        objective fraud finding.
      </p>

      <h2>Changes</h2>
      <p>
        NoDitto may update these terms as the product changes. Continued use
        after a posted change means you accept the updated terms. If you do not
        accept them, stop using the service.
      </p>
    </PolicyArticle>
  );
}
