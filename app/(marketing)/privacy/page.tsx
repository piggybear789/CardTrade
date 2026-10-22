import type { Metadata } from 'next';
import Link from 'next/link';

import { LEGAL, operatorIdentity } from '@/lib/legal/operator';

import { PolicyArticle } from '../policy-article';

export const metadata: Metadata = {
  title: 'Privacy policy · NoDitto',
  description:
    'What personal information NoDitto collects, why, who we share it with, how long we keep it, and your rights.',
};

// Every statement here describes what the code actually does: the providers below are
// the ones it calls, and the fraud fingerprints, message flags and automated refusals
// are real features. When a feature starts collecting or sharing something new, update
// this page in the same change and bump `LEGAL.effectiveDate`.

export default function PrivacyPage() {
  const operator = operatorIdentity();
  return (
    <PolicyArticle
      title="Privacy policy"
      lede="This policy explains what personal information NoDitto collects, why we use it, who we share it with, how long we keep it, and the choices and rights you have."
      meta={`Effective ${LEGAL.effectiveDate}`}
      notice={
        LEGAL.showDraftNotice
          ? 'Draft. This policy has not yet been reviewed by a lawyer and may change before NoDitto opens to the public.'
          : undefined
      }
    >
      <h2 id="who">1. Who we are</h2>
      <p>
        NoDitto is operated by {operator}
        {LEGAL.address ? `, ${LEGAL.address}` : ''} (“NoDitto”, “we”, “us”). We are responsible
        for the personal information described here. We handle it in line with the Australian
        Privacy Principles in the Privacy Act 1988 (Cth) and, for members in the UK and the
        European Economic Area, the UK GDPR and the EU GDPR. Questions or requests:{' '}
        <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>.
      </p>

      <h2 id="collect">2. What we collect</h2>
      <h3>You give us</h3>
      <ul>
        <li>
          <strong>Account:</strong> email address, display name, password (stored only as a
          hash by our authentication provider), and, if you choose, a photo, bio, social
          profile links and trading region. If you sign in with Google we receive your name,
          email and Google account ID.
        </li>
        <li>
          <strong>Listings and deals:</strong> listings and photos, offers, contract terms,
          prices, line items, postage, delivery addresses, meeting places and times, tracking
          numbers, reviews, references and dispute evidence.
        </li>
        <li>
          <strong>Messages:</strong> messages and attachments you send to other members.
        </li>
        <li>
          <strong>Reports and applications:</strong> reports about listings or members, scam
          reports and their screenshots, Trusted Seller applications and their photos, and
          feedback or problem reports you send us.
        </li>
      </ul>
      <h3>From Stripe, for payments and identity</h3>
      <ul>
        <li>
          <strong>Cards and bank payments:</strong> card details are entered into Stripe’s own
          form and never reach our servers. We keep a reference to your saved card and its
          brand and last four digits. We read its expiry and issuing country from Stripe when
          needed (the country sets the card’s fee) and do not store them.
        </li>
        <li>
          <strong>Identity check:</strong> Stripe Identity collects your photo ID and a selfie,
          and compares them, which involves processing biometric information. Stripe asks for
          your consent to this in its own flow. We receive the result, your verified legal
          name, and briefly your document number, issuing country and date of birth, which we
          use only to make the one-way fraud codes described in section 4. We do not keep your
          document images, number or date of birth.
        </li>
        <li>
          <strong>Payouts:</strong> whether your payout account is set up and able to receive
          money, and the account holder’s name to check it matches your verified identity.
          Stripe collects your bank details directly.
        </li>
        <li>
          <strong>Payment status:</strong> whether payments, holds, refunds and payouts
          succeeded, and any card disputes or fraud warnings raised against a payment.
        </li>
      </ul>
      <h3>Collected automatically</h3>
      <ul>
        <li>
          <strong>Technical:</strong> your IP address and the country it suggests (used to show
          listings near you and to limit abuse), browser type, and error reports when something
          fails. Error reports contain identifiers such as a contract number, not your messages
          or payment details.
        </li>
        <li>
          <strong>Usage:</strong> aggregate page-view and performance measurements through
          Vercel Analytics and Speed Insights, which do not use advertising cookies or build a
          profile of you.
        </li>
        <li>
          <strong>On your device:</strong> cookies that keep you signed in and remember your
          browsing region and a sign-in step in progress; your recent searches; and a draft
          private deal you started before signing in. All are needed for the features you use;
          we use no advertising or cross-site tracking cookies.
        </li>
      </ul>

      <h2 id="use">3. How we use it, and our legal bases</h2>
      <p>
        For members in the UK and EEA, the legal basis for each use is shown in brackets.
      </p>
      <ul>
        <li>
          To run your account, listings, sales, trades, messages and payouts, and to show
          the other member on a deal what they need to complete it (performing our contract
          with you).
        </li>
        <li>
          To verify identity, prevent fraud and scams, keep NoDitto secure, and enforce our
          Terms (our legitimate interest in a safe marketplace, and legal obligations).
        </li>
        <li>
          To review disputes and card disputes, and respond to card issuers and Stripe
          (contract, and legitimate interests).
        </li>
        <li>
          To send transactional emails and notifications about your account and deals
          (contract).
        </li>
        <li>
          To keep financial and transaction records, and to respond to lawful requests from
          regulators, law enforcement and courts (legal obligation).
        </li>
        <li>
          To understand how NoDitto is used in aggregate and fix problems (legitimate
          interests).
        </li>
      </ul>
      <p>We do not use your personal information for advertising, and we do not sell it.</p>

      <h2 id="fraud">4. Fraud prevention and automated checks</h2>
      <p>
        To protect members, some checks run automatically. A person on our team reviews any
        decision that bans an account.
      </p>
      <ul>
        <li>
          <strong>One-way fraud codes.</strong> We turn certain details into codes that can be
          compared but not turned back into the original: your identity document and verified
          name with date of birth, your saved card and payout account, the contact email on
          your account, the usernames in your profile links, and for an Australian payout
          account its BSB and last four digits. We use them to recognise a person or account
          that was banned for fraud, to stop one person opening several accounts, and to stop
          two linked accounts dealing with each other. We never store a full bank account or
          card number.
        </li>
        <li>
          <strong>Automatic refusals.</strong> A deal between linked accounts, a card blocked
          after a lost fraud chargeback, or a new seller over their open-sales limit is refused
          automatically. If you think a refusal is wrong, contact us and a person will review it.
        </li>
        <li>
          <strong>Image screening.</strong> Listing and profile photos are screened by an
          automated service for prohibited images before they are published.
        </li>
        <li>
          <strong>Message flags.</strong> Messages are checked automatically for signs of an
          attempt to move a deal off NoDitto, such as phone numbers or payment details. A
          flagged message is still delivered; the flag is visible only to our team.
        </li>
        <li>
          <strong>Scam reports.</strong> Members can report scams that happened outside
          NoDitto. The scammer’s payment details and usernames are stored only as one-way
          codes with a partly hidden hint for our team. If your details match a report, we tell
          you and give you 14 days to respond before we decide anything. We do not tell you who
          reported you, and we never tell a reporter whether anything matched.
        </li>
      </ul>

      <h2 id="share">5. Who we share it with</h2>
      <h3>Other members</h3>
      <p>
        Your display name, photo, bio, profile links, region, listings, ratings and reviews are
        public. References members post about you, or about a social media handle, are public.
        When you deal with someone, they see what the deal needs: as a seller or trader, your
        verified legal name; the delivery address or meeting place for that deal; tracking; and
        your messages to them.
      </p>
      <h3>Service providers</h3>
      <p>These providers process information for us, under contract, to run NoDitto:</p>
      <ul>
        <li><strong>Stripe</strong>: payments, card holds, payouts, identity checks, and fraud screening.</li>
        <li><strong>Supabase</strong>: database, sign-in and file storage, hosted in Sydney, Australia.</li>
        <li><strong>Vercel</strong>: website hosting (Sydney) and aggregate analytics.</li>
        <li><strong>Amazon Web Services</strong>: sending email and screening images, in Sydney.</li>
        <li><strong>Google</strong>: Google sign-in, and address and place search when you type an address.</li>
        <li><strong>Ship24</strong>: tracking numbers, to follow deliveries.</li>
        <li>
          <strong>Discord, X, Instagram, Facebook, TikTok and eBay</strong>: only if you link a
          handle by signing in with one of them, to confirm the handle is yours.
        </li>
      </ul>
      <p>
        Stripe also acts on its own account for some purposes, such as meeting its own legal
        obligations and preventing fraud, under the{' '}
        <a href="https://stripe.com/privacy" rel="noreferrer" target="_blank">
          Stripe Privacy Policy
        </a>
        .
      </p>
      <h3>Others</h3>
      <p>
        We may disclose information when the law requires it, to card issuers in a payment
        dispute, to law enforcement where we reasonably believe it is needed to prevent or
        investigate fraud or harm, or to a business that takes over NoDitto (which must keep to
        this policy). We do not give identity documents to other members.
      </p>

      <h2 id="transfers">6. Where your information is held</h2>
      <p>
        Our database and files are held in Australia. Some providers, including Stripe and
        Google, process information in the United States and other countries. If you are in
        the UK or EEA, your information is transferred to Australia and those countries, which
        may not have equivalent data protection laws; where required, we rely on the European
        Commission’s standard contractual clauses (and the UK addendum) in our providers’ terms.
      </p>

      <h2 id="retention">7. How long we keep it</h2>
      <ul>
        <li>Account information: while your account is open.</li>
        <li>
          Contracts, payments, disputes and the messages on them: for 7 years after the
          contract ends, for tax, financial-record and dispute purposes.
        </li>
        <li>
          Fraud codes and records of an account banned for fraud: for as long as needed to stop
          the person returning.
        </li>
        <li>
          Scam reports: while open; deleted 90 days after they are dismissed or withdrawn, and a
          cleared match is deleted straight away.
        </li>
        <li>Rate-limiting records of IP addresses: hours, not days.</li>
      </ul>
      <p>
        When you close your account, your public profile is anonymised straight away. We keep
        the records above for the periods shown, then delete or de-identify them.
      </p>

      <h2 id="rights">8. Your rights and choices</h2>
      <p>
        You can see and correct most of your information in your account settings, and close
        your account there once nothing is in flight. You can also ask us to:
      </p>
      <ul>
        <li>give you a copy of the personal information we hold about you;</li>
        <li>correct information that is wrong;</li>
        <li>
          delete information, or restrict or object to how we use it, where we do not need to
          keep it for a deal, a dispute, fraud prevention or the law;
        </li>
        <li>give you your information in a portable format (UK and EEA); and</li>
        <li>have a person review an automated decision about you.</li>
      </ul>
      <p>
        Email <a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a>. We may need to
        confirm your identity first, and we will respond within 30 days. If you are unhappy
        with our response you can complain to the Office of the Australian Information
        Commissioner (oaic.gov.au), the UK Information Commissioner’s Office (ico.org.uk), or
        the data protection authority where you live in the EEA.
      </p>

      <h2 id="security">9. Security</h2>
      <p>
        We protect information with encryption in transit, access controls that limit staff
        access to what their role needs, and private storage for documents such as dispute
        evidence and scam reports. No system is perfectly secure. If a data breach is likely to
        cause you serious harm, we will notify you and the relevant regulator as the law
        requires.
      </p>

      <h2 id="children">10. Children</h2>
      <p>
        NoDitto is for people aged 18 and over. We do not knowingly collect information from
        anyone younger. If you believe a child has an account, contact us and we will close it.
      </p>

      <h2 id="changes">11. Changes to this policy</h2>
      <p>
        If we change this policy in a way that materially affects you, we will tell you by
        email or in the app before the change takes effect. The date at the top shows when it
        last changed. You can also reach us through the <Link href="/help">Help page</Link>.
      </p>
    </PolicyArticle>
  );
}
