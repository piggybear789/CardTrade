import type { Metadata } from 'next';

import { PolicyArticle } from '../policy-article';

export const metadata: Metadata = {
  title: 'Privacy · NoDitto',
  description:
    'How NoDitto collects and uses account, contract, and Stripe identity data.',
};

export default function PrivacyPage() {
  return (
    <PolicyArticle
      title="Privacy policy"
      lede="This describes what NoDitto collects and why. It is a product policy, not legal advice, and it has not been reviewed by counsel."
    >
      <h2>What we collect</h2>
      <p>
        When you create an account we store the email and display name you
        provide, plus a password hash held by the authentication provider
        (Supabase Auth). As you use the marketplace we store listings, offers,
        messages, contract terms, fulfilment details, and the region you browse
        or set on your profile.
      </p>

      <h2>Stripe — payments and identity</h2>
      <p>
        Stripe is the payment and identity provider. Card details are entered on
        Stripe&apos;s pages and are not stored by NoDitto. Stripe returns the
        payment, hold, payout, and dispute states the product needs to run a
        contract.
      </p>
      <p>
        Identity verification uses Stripe Identity. Stripe collects the
        government document and selfie for that check. NoDitto stores the
        verification outcome and, when Stripe reports it, the provider-verified
        legal name used for counterparty disclosure. We do not store the
        document images ourselves.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>Operate accounts, listings, trades, and cash sales.</li>
        <li>Show verification status and disclosed identity to counterparties.</li>
        <li>Process payments, card holds, collections, refunds, and payouts via Stripe.</li>
        <li>Review disputes and staff-confirmed fraud findings.</li>
        <li>Prevent fraud, including checking accounts against scam reports.</li>
        <li>Send transactional email such as password reset and contract notices.</li>
      </ul>

      <h2>Fraud prevention and scam reports</h2>
      <p>
        To spot repeat scammers, we turn some of your details into one-way codes
        (fingerprints) that can be compared but not read back: the contact email
        on your account, the usernames in your profile links, and, for an
        Australian payout account, its BSB and the last four digits of the
        account number. We also keep fingerprints of the card and payout account
        Stripe reports for you. We never store your full bank account number.
      </p>
      <p>
        Members can report a scam that happened outside NoDitto. A report holds
        the reporter&apos;s account, what they told us, their screenshots, and
        the payment details and usernames the scammer used, stored only as
        fingerprints with a partly hidden hint for our team. Reports are seen by
        NoDitto staff only. We never publish them, and nothing is decided
        automatically.
      </p>
      <p>
        If your details match a report, our team may look into it. Before we
        decide anything against you, we tell you that a report involves details
        linked to your account and give you 14 days to tell us your side. We
        won&apos;t tell you who sent the report or what it says, just as we
        wouldn&apos;t tell anyone you reported them.
      </p>
      <p>
        Open reports are kept while they help prevent repeat fraud. A report we
        dismiss, or one the reporter withdraws, is deleted 90 days later with
        its screenshots, and a match we clear is deleted straight away. If you
        think a report about you is wrong, contact us through the Help page and
        we&apos;ll review it, and delete it if it is.
      </p>

      <h2>What we do not do</h2>
      <p>
        We do not sell your personal information. We do not use Stripe Identity
        results for advertising. Payment and identity processing is performed by
        Stripe under Stripe&apos;s own terms and privacy policy.
      </p>

      <h2>Retention and access</h2>
      <p>
        We keep account and contract records for as long as they are needed to
        operate the service, complete payouts, and review disputes. You can
        update profile details from your account. Password reset uses the email
        on the account and does not tell a visitor whether that email is
        registered.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy can be sent through the Help page. If the
        product&apos;s privacy practices change in a material way, we will update
        this page.
      </p>
    </PolicyArticle>
  );
}
