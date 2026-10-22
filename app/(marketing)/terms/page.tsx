import type { Metadata } from 'next';
import Link from 'next/link';

import { termsFeeSentence } from '@/lib/fees/feeLabels';
import { LEGAL, operatorIdentity } from '@/lib/legal/operator';

import { PolicyArticle } from '../policy-article';

export const metadata: Metadata = {
  title: 'Terms of use · NoDitto',
  description:
    'The agreement between you and NoDitto: accounts, listings, cash sales, trades, payments through Stripe, disputes, and liability.',
};

// The facts in these Terms are the product's own rules (inspection windows, collateral,
// return flow, fee table). When a rule changes in code, change it here in the same pass,
// and update `LEGAL.effectiveDate`. The fee wording is read from `termsFeeSentence` so it
// cannot drift from what is charged.

export default function TermsPage() {
  const operator = operatorIdentity();
  return (
    <PolicyArticle
      title="Terms of use"
      lede="These Terms are the agreement between you and NoDitto when you use the NoDitto website and apps. Please read them, in particular sections 6 to 9 on payments and section 15 on our liability."
      meta={`Effective ${LEGAL.effectiveDate}`}
      notice={
        LEGAL.showDraftNotice
          ? 'Draft. These Terms have not yet been reviewed by a lawyer and may change before NoDitto opens to the public.'
          : undefined
      }
    >
      <h2 id="about">1. About these Terms</h2>
      <p>
        NoDitto (noditto.app) is operated by {operator}
        {LEGAL.address ? `, ${LEGAL.address}` : ''} (“NoDitto”, “we”, “us”). By creating an
        account, or by using NoDitto without one, you agree to these Terms and confirm you
        have read our <Link href="/privacy">Privacy policy</Link>. If you do not agree, do not
        use NoDitto.
      </p>
      <p>
        <strong>Your consumer rights.</strong> Nothing in these Terms excludes, restricts or
        modifies any right or remedy, or any guarantee, that you have under the Australian
        Consumer Law or any other law that cannot lawfully be excluded, including the
        consumer protection laws of the country you live in. Where a term would do that, it
        applies only to the extent the law allows.
      </p>

      <h2 id="eligibility">2. Eligibility and your account</h2>
      <ul>
        <li>You must be at least 18 years old and able to enter into a binding contract.</li>
        <li>
          You may hold one account. A person whose identity check matches another live
          account may be refused until the other account is closed.
        </li>
        <li>
          Your details must be accurate and kept up to date, including the trading region
          you state, which must be the country you live in and are paid in. A region cannot
          be changed once payouts are set up, because Stripe fixes the country of a payout
          account.
        </li>
        <li>
          Keep your password and sign-in methods secure. You are responsible for activity on
          your account unless it results from our failure to take reasonable care.
        </li>
      </ul>

      <h2 id="role">3. What NoDitto is, and is not</h2>
      <p>
        NoDitto is an online marketplace where members list trading cards, agree terms with
        each other, and complete cash sales and trades. We provide the listing and contract
        tools, identity checks, messaging, and payment collection and release through Stripe.
      </p>
      <p>
        <strong>We are not a party to your sale or trade.</strong> Each cash sale or trade is
        a contract between the members on it. We do not own, inspect, authenticate or grade
        the goods, and we do not guarantee that a listing is accurate, that goods are genuine,
        or that a member will perform. Our dispute process (section 10) decides what happens
        to money and card holds we control; it is not a substitute for your legal rights
        against the other member.
      </p>
      <p>
        <strong>We are not a bank, escrow agent or trustee.</strong> We do not take deposits,
        pay interest, or hold money in a trust account. How we collect, hold and release
        payments is set out in section 6.
      </p>

      <h2 id="identity">4. Identity verification</h2>
      <p>
        Listing, selling and trading require an identity check by Stripe Identity
        (a government photo ID and a selfie). Buying for cash does not. When you sell to or
        trade with someone, we show them your verified legal name so they know who they are
        dealing with. A verified identity shows who a member is. It does not guarantee their
        goods, their honesty, or that a deal will complete.
      </p>
      <p>
        A “Trusted Seller” mark is our own judgement after reviewing a seller. It is not a
        guarantee and does not change the protections in these Terms.
      </p>

      <h2 id="listings">5. Listings</h2>
      <p>When you list an item, you promise that:</p>
      <ul>
        <li>you own it, or are entitled to sell it, and it is in your possession;</li>
        <li>
          the title, description, condition (on the scale NoDitto uses) and photos are accurate
          and show the actual item;
        </li>
        <li>it is genuine, not stolen, and not subject to any claim that would stop you selling it.</li>
      </ul>
      <p>
        A <strong>binder or bulk listing</strong> is an inventory. Nothing is held for any
        buyer: what a buyer is purchasing is set out in the line items of their own contract,
        and the same card may be requested by more than one buyer.
      </p>
      <p>You must not list, sell or trade:</p>
      <ul>
        <li>counterfeit, proxy or reproduction cards presented as genuine, or altered or resealed product presented as original;</li>
        <li>stolen goods, or goods you do not have the right to sell;</li>
        <li>anything illegal to sell or send in your country or the buyer’s;</li>
        <li>anything other than trading cards and related card products while NoDitto is cards-only.</li>
      </ul>
      <p>
        We may refuse, hide or remove a listing, and photos are automatically screened for
        prohibited images before they are published.
      </p>

      <h2 id="cash-sales">6. Cash sales and payments</h2>
      <h3>When the contract is formed</h3>
      <p>
        A buyer opens a contract from a listing, an accepted offer or a private-deal link.
        Opening it reserves a single-item listing but commits neither party. The buyer and
        seller agree the price, the items (for a binder or bulk listing) and how the goods
        will change hands. <strong>The sale is binding when the buyer pays.</strong> Changing
        what is bought, or the price, requires both of you to agree again.
      </p>
      <h3>How payment is collected and held</h3>
      <p>
        The buyer pays the price, any postage and the service fee (section 8) through Stripe,
        by card or, where offered, from their bank. <strong>Each seller appoints NoDitto as
        its limited agent to collect payment from the buyer.</strong> When we receive the
        buyer’s payment, the buyer’s obligation to pay the seller is satisfied, even if we
        have not yet paid the seller.
      </p>
      <p>
        We hold the payment in our Stripe account and release it to the seller only when the
        sale completes:
      </p>
      <ul>
        <li>
          <strong>Posted:</strong> the buyer has 7 days to inspect, starting when the carrier
          confirms delivery, or when the buyer confirms receipt if earlier.
        </li>
        <li>
          <strong>In person:</strong> the buyer has 24 hours to inspect, starting when both of
          you confirm the handover.
        </li>
        <li>
          The sale completes when the buyer accepts the goods, or when the inspection window
          ends without a dispute. Completion is the buyer’s acceptance of the goods.
        </li>
      </ul>
      <p>
        We may delay a payout, without it being a failure to pay, while a new seller’s safety
        hold runs, while a card dispute or fraud warning is open on the payment, or while we
        review a dispute. We may limit how much a new seller can have in open sales at once.
      </p>
      <h3>Refunds and returns</h3>
      <p>
        A refund is paid to the original payment method. Where a refund is decided and the
        buyer has the goods, the buyer must post them back within 7 days with tracking. The
        refund is released automatically once the seller has had 72 hours, from the carrier
        confirming delivery, to check the returned parcel and has not raised a problem with
        it. A full refund includes the
        service fee. Currency conversion fees on a trade’s cash payment are not refunded.
      </p>
      <h3>Cancelling</h3>
      <p>
        Either party may cancel a contract before the buyer pays. After payment, a sale ends
        only by completion, a refund, or a decision under section 10.
      </p>

      <h2 id="trades">7. Trades and trade collateral</h2>
      <p>
        A trade is a swap of cards, with or without cash, agreed when both traders accept the
        same terms. Trades are handed over in person.
      </p>
      <p>
        <strong>Trade collateral.</strong> Before a trade proceeds, Stripe places a temporary
        hold on each trader’s saved card, up to the value of the side they are giving. No money
        is taken by a hold. By accepting a trade, you authorise NoDitto to:
      </p>
      <ul>
        <li>release your hold when the trade completes or is cancelled;</li>
        <li>
          capture some or all of your hold if, under section 10, we decide you did not deliver
          what you agreed or were responsible for fraud, and pay it to the other trader; and
        </li>
        <li>
          capture your hold into our Stripe account before it expires while a dispute is open,
          so that the dispute can still be decided, and then pay or refund it according to
          the decision.
        </li>
      </ul>
      <p>
        If a trade includes cash, the paying trader pays it before the holds are placed. We
        hold it on the same basis as a cash sale and release it to the other trader when the
        trade completes. Each trader has 72 hours from the agreed meeting time (and at least
        24 hours from the handover) to raise a problem; after that the trade completes and the
        holds are released. Confirming a handover is not accepting the cards.
      </p>

      <h2 id="fees">8. Fees</h2>
      <p>{termsFeeSentence()}</p>
      <p>
        The fee is shown before you pay, with the total for each way of paying. A contract’s
        fee is fixed when it is paid. We may change our rates for contracts agreed after the
        change.
      </p>

      <h2 id="payouts">9. Getting paid and Stripe’s terms</h2>
      <p>
        Payment processing for NoDitto is provided by Stripe. To receive money on NoDitto you
        must set up a Stripe connected account, and by doing so you agree to the{' '}
        <a href="https://stripe.com/legal/connect-account" rel="noreferrer" target="_blank">
          Stripe Connected Account Agreement
        </a>
        , which includes the{' '}
        <a href="https://stripe.com/legal/ssa" rel="noreferrer" target="_blank">
          Stripe Services Agreement
        </a>
        , as Stripe may update them. You agree to give us accurate and complete information
        about yourself, and you authorise us to share it, and information about your
        transactions, with Stripe for the purpose of providing those services.
      </p>
      <p>
        Your payout account must be in the name of the person who passed the identity check.
        You are responsible for any tax on what you sell and for keeping your own records.
      </p>

      <h2 id="disputes">10. Problems and disputes</h2>
      <p>
        If something goes wrong with a sale or trade, raise it in the contract room before the
        inspection window ends. Both members can add evidence. NoDitto staff review it and
        decide how money and card holds we control are released, refunded or paid, including
        whether goods must be returned first. Decisions that move larger amounts, and every
        fraud finding, need the approval of a second staff member.
      </p>
      <p>
        You agree that our decision governs what happens to that money and those holds, and
        you authorise us to act on it. Our decision does not limit any claim you have against
        the other member, or your rights under consumer law. We decide disputes in good faith
        on the evidence available; we cannot guarantee every loss will be recovered.
      </p>
      <p>
        If you dispute a payment with your card issuer, the issuer’s process applies. We may
        submit the contract record and evidence to the issuer, and we may hold the related
        payout until it is resolved.
      </p>

      <h2 id="suspension">11. Suspension, fraud and closing your account</h2>
      <p>
        We may suspend features, hold payouts, or suspend or close an account where we
        reasonably believe a member has breached these Terms, acted fraudulently, or put other
        members at risk, and we will tell you why unless the law or a fraud investigation
        prevents it. A staff-confirmed finding of fraud, approved by a second staff member,
        permanently bans the account and removes its listings. To stop a banned person
        returning, we keep a one-way code made from their identity document and refuse a new
        account that matches it.
      </p>
      <p>
        We may refuse a deal between accounts that share a card, a payout account or a verified
        person, without saying why.
      </p>
      <p>
        You can close your account at any time once you have no money or goods in flight.
        Sections of these Terms that by their nature continue (including 6, 7, 10, 12, 15 and
        17) survive closure.
      </p>

      <h2 id="content">12. Your content, reviews and references</h2>
      <p>
        You keep ownership of what you post (listings, photos, messages, reviews and
        references). You give NoDitto a non-exclusive, worldwide, royalty-free licence to host,
        display, adapt for display, and use it to operate, improve and promote NoDitto, for as
        long as it is on NoDitto and for a reasonable time after, and to keep it where we need
        it for a dispute, fraud prevention or the law.
      </p>
      <p>
        Reviews and references must be honest, based on your own dealings, and must not be
        defamatory, abusive or misleading. A reference may describe someone who is not a NoDitto
        member by their public handle; you are responsible for what you say about them. We may
        remove or edit content, and anyone who believes a review or reference about them is
        false can ask us to review it through the <Link href="/help">Help page</Link>.
      </p>
      <p>
        <strong>Scam reports.</strong> ID-verified members can report a scam that happened
        outside NoDitto. Reports are seen only by NoDitto staff and are never published. We
        cannot recover money paid outside NoDitto and are not obliged to act on a report. A
        report must be true to the best of your knowledge; filing one you know to be false, or
        to harm someone, is a serious breach of these Terms. A member whose details match a
        report is told before we decide anything and given 14 days to respond.
      </p>

      <h2 id="conduct">13. Using NoDitto fairly</h2>
      <p>You must not:</p>
      <ul>
        <li>arrange to complete a NoDitto sale or trade off NoDitto to avoid its fees or protections;</li>
        <li>use NoDitto to defraud, harass, threaten or mislead anyone;</li>
        <li>open more than one account, or use another person’s account, card or identity;</li>
        <li>scrape, copy or bulk-download NoDitto, or interfere with its security or operation;</li>
        <li>break any law, or anyone else’s rights, while using NoDitto.</li>
      </ul>
      <p>
        <strong>Deals off NoDitto are not protected.</strong> If you pay someone directly (for
        example by bank transfer, PayID or PayPal friends and family), none of the protections
        in these Terms applies. Messages that suggest moving a deal off NoDitto may be flagged
        for our team.
      </p>

      <h2 id="service">14. The service</h2>
      <p>
        We provide NoDitto with due care and skill and work to keep it available, but it may be
        interrupted for maintenance or by events outside our control. We may change or
        discontinue features. If we close NoDitto, we will give reasonable notice and complete
        or unwind open contracts and pay out or refund money we hold.
      </p>

      <h2 id="liability">15. Our liability</h2>
      <p>
        Where the Australian Consumer Law or another law gives you a guarantee about our
        services that we cannot exclude, our liability for failing to meet it is, where the law
        allows, limited to supplying the services again or paying the cost of having them
        supplied again.
      </p>
      <p>To the extent the law allows:</p>
      <ul>
        <li>
          we are not liable for the acts or omissions of members, carriers, or other third
          parties, including goods that are not as described, not delivered, or not genuine,
          except to the extent our own breach or negligence caused the loss;
        </li>
        <li>we are not liable for indirect or consequential loss, or loss of profit or opportunity; and</li>
        <li>
          our total liability to you in connection with NoDitto is limited to the greater of
          the fees you paid us in the 12 months before the claim and A$100, plus any money of
          yours we hold.
        </li>
      </ul>
      <p>
        These limits do not apply to liability for our fraud, wilful misconduct or gross
        negligence, or to personal injury or death caused by our negligence.
      </p>

      <h2 id="indemnity">16. Your responsibility to us</h2>
      <p>
        If you breach these Terms or the law, or act fraudulently, and that causes NoDitto a
        loss or a claim by someone else (for example a card dispute fee or a payment we must
        make to another member), you are responsible for that loss to the extent you caused it.
        We may recover it from money we hold for you.
      </p>

      <h2 id="changes">17. Changes to these Terms</h2>
      <p>
        We may update these Terms to reflect changes to NoDitto, the law, or our providers. For a
        change that materially affects you we will give you at least 14 days’ notice by email
        or in the app before it takes effect, unless the change is required sooner by law or to
        protect members. If you do not agree, you may close your account before the change
        takes effect. A contract already paid continues on the Terms in force when it was paid.
      </p>

      <h2 id="law">18. Governing law</h2>
      <p>
        These Terms are governed by the law of {LEGAL.governingLaw}, and the courts there have
        non-exclusive jurisdiction. If you are a consumer living elsewhere, you also keep the
        protection of the mandatory laws of your own country and may bring proceedings in its
        courts.
      </p>

      <h2 id="contact">19. Contact and complaints</h2>
      <p>
        For help or a complaint, contact us through the <Link href="/help">Help page</Link> or
        at <a href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a>. We aim to
        acknowledge a complaint within 2 business days and respond within 14 days. If we
        cannot resolve it, you may contact your local consumer protection agency (in Australia,
        your state or territory fair trading office).
      </p>
      <p>
        If any part of these Terms is invalid, the rest still applies. If we do not enforce a
        term straight away, we can still enforce it later. You may not transfer your rights
        under these Terms; we may transfer ours to a business that takes over NoDitto, with
        notice to you.
      </p>
    </PolicyArticle>
  );
}
