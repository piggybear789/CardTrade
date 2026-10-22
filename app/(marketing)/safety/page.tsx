import type { Metadata } from 'next';
import Link from 'next/link';

import { TRADE_INSPECTION_FLOOR_HOURS, TRADE_INSPECTION_HOURS } from '@/domain/fulfilment/inspection';
import { nodittoFeeRateLabel } from '@/lib/fees/feeLabels';

import { Guide, PageSection, Prose } from './stage-rail';

// app/(marketing)/safety/page.tsx
//
// Member-facing safety guidance, written as plain conversational prose rather than
// bullet fragments. One column, one section pattern (`PageSection`), typography only.
//
// COPY RULES, both load-bearing.
//
// 1. Write it the way you'd explain it to a friend across the counter: full sentences,
//    casual, no fragments, no marketing voice. Put what to do before why.
// 2. Never promise a protection that is not built, and match `/help` on the hedges:
//    trade collateral is a temporary card hold and never "escrow", a binder or bulk
//    listing always says nothing is held, and a frozen dispute is not a promise that
//    every loss is covered. The "What we can't do" guide is not one to delete.
//
// The photo and weight advice is a habit we ask for, not a step the product enforces.
// The sealed-product warning must not be softened: `DISPUTABLE_STATUSES` has no
// COMPLETED entry, so once the 7 days pass there is no remedy.

export const metadata: Metadata = {
  title: 'How to protect yourself · NoDitto',
  description:
    'How NoDitto protects your purchases and trades, the warning signs to walk away from, and what to do at each step.',
};

const strong = 'font-semibold text-foreground';

export default function SafetyPage() {
  const buyerFee =
    `The price you see includes the service fee, a fixed rate shown before you pay that covers Stripe's costs plus about ${nodittoFeeRateLabel()} to NoDitto. Postage is passed through at cost.`;
  const sellerFee =
    "You'll receive your full price and postage. The buyer pays the service fee on top.";

  return (
    <article className="mx-auto max-w-2xl px-group py-section sm:px-6 md:py-12">
      <header>
        <h1 className="text-subhead font-semibold tracking-tight text-foreground md:text-head">
          Staying safe on NoDitto
        </h1>
        <Prose className="mt-cozy md:text-lead">
          <p>
            Most deals on NoDitto go off without a hitch, and the system is built so that when one
            doesn&rsquo;t, you&rsquo;ve still got a way back. This page explains how that works and
            what you can do to keep yourself covered.
          </p>
        </Prose>
      </header>

      {/* THE ONE RULE, marked by a single amber rule on its left edge. */}
      <div className="mt-section border-l-2 border-action-edge pl-group">
        <Prose>
          <p>
            <strong className={strong}>The one thing that matters most is keeping the whole deal on
            NoDitto.</strong>{' '}
            Pay here, chat here, and record your postage here. Everything we can do to help depends on
            the deal having happened on the platform, and if someone tries to move you somewhere else,
            that&rsquo;s usually the first sign something&rsquo;s off.
          </p>
        </Prose>
      </div>

      <div className="mt-region space-y-region">
        <PageSection id="protected" title="How you're protected">
          <Prose>
            <p>
              When you buy a card, the seller doesn&rsquo;t get paid straight away. We hold your
              payment until you&rsquo;ve received the card and accepted it, or until your inspection
              time runs out without a dispute. That inspection time is 7 days from when the carrier
              confirms delivery, and on a trade it&rsquo;s {TRADE_INSPECTION_HOURS} hours.
            </p>
            <p>
              If something&rsquo;s wrong, raising a dispute within that time freezes the money, so
              nothing gets paid out while our case team looks into it. And anyone who lists, sells or
              trades has had their photo ID and a selfie checked by Stripe first, so you always know
              there&rsquo;s a real, verified person on the other side.
            </p>
          </Prose>
        </PageSection>

        <PageSection id="red-flags" title="When to walk away">
          <Prose>
            <p>
              Scams on card marketplaces tend to look the same. The most common is someone asking you
              to pay another way, whether that&rsquo;s a bank transfer, crypto, gift cards or a payment
              link, or asking to carry on the conversation over WhatsApp, Instagram, Discord or email.
              Once you leave NoDitto, there&rsquo;s nothing we can reverse.
            </p>
            <p>
              Be wary too if you&rsquo;re being rushed because &ldquo;another buyer is waiting&rdquo;,
              if a valuable card is priced well under what it&rsquo;s worth, if the seller won&rsquo;t
              take the extra photos you ask for, or if you&rsquo;re asked to post to an address
              that isn&rsquo;t on the contract. We&rsquo;ll also never ask for your password, your card
              number or a code, so anyone claiming to be NoDitto support who does isn&rsquo;t us.
            </p>
            <p>
              If something feels wrong, you can report the listing or the member from their page. They
              won&rsquo;t be told who reported them.
            </p>
          </Prose>
        </PageSection>

        <PageSection
          id="guides"
          title="Step by step"
          lede="These go into more detail. Open whichever one fits what you're doing."
        >
          <div className="border-t border-border">
            <Guide id="buying" title="Buying a card">
              <p>
                Before you pay, take your time. Nothing is held for you until you pay, and paying is
                what commits you to the deal. Check that the seller shows as identity verified, and read
                the contract lines carefully, because they describe exactly what you&rsquo;re buying in
                a way the listing title doesn&rsquo;t. If it&rsquo;s a graded card, look the certificate
                number up on the grader&rsquo;s own website. {buyerFee}
              </p>
              <p>
                When the parcel turns up, photograph it before you open it, with the label in view, and
                then film yourself opening it in one continuous take. Hang on to the packaging until the
                sale is finished. It sounds like a lot, but if anything&rsquo;s wrong, that footage is
                what settles it.
              </p>
              <p>
                You then have 7 days from carrier-confirmed delivery to accept the card or raise a
                dispute. If you do neither, the sale completes on its own. If you&rsquo;re meeting the
                seller in person instead, there&rsquo;s no inspection time afterwards, because confirming
                the handover completes the sale, so check the card properly before you confirm.
              </p>
            </Guide>

            <Guide id="selling" title="Selling a card">
              <p>
                You&rsquo;ll need to verify your identity before you can list, and it&rsquo;s worth
                setting up payouts at the same time so there&rsquo;s nothing holding up your money later.
                Describe each card precisely, because if there&rsquo;s ever a dispute, it gets decided on
                what the contract says rather than on the listing. {sellerFee}
              </p>
              <p>
                Once the buyer has paid, you&rsquo;ve got 3 business days to post. Only send it once the
                contract itself shows the payment as collected, never because of a message or a
                screenshot. Before you seal the parcel, photograph the card and the packed box, then
                photograph the sealed parcel with the label showing, and keep your postage receipt. Use
                tracked postage and record the tracking in the contract room.
              </p>
              <p>
                Your payout is sent once the sale completes and your payout account is active. Keep your
                photos and tracking even after that, since a card payment can occasionally be reversed by
                the buyer&rsquo;s bank weeks later, and they&rsquo;re your defence if it is.
              </p>
            </Guide>

            <Guide id="trading" title="Trading cards">
              <p>
                A trade works a little differently, because instead of anyone paying, both of you put a
                temporary hold on your card for the value of your side. Nothing is charged and no money
                moves, but that hold only lasts about a week, which is why the deadlines on a trade are
                shorter than on a purchase.
              </p>
              <p>
                You&rsquo;ll both need verified identity and a saved card. When you agree the terms,
                write down exactly which cards you&rsquo;re getting, then wait until both holds are in
                place before you post anything or meet up. Photograph your card before it leaves your
                hands, and either post it tracked or meet somewhere public.
              </p>
              <p>
                If you meet in person, confirming the handover only records that you swapped. It
                isn&rsquo;t the same as accepting the card. If the other person doesn&rsquo;t show or a
                parcel goes missing, use &ldquo;Handover failed&rdquo;, which freezes the trade without
                charging anyone.
              </p>
              <p>
                After the swap, you get {TRADE_INSPECTION_HOURS} hours to inspect, and never less than{' '}
                {TRADE_INSPECTION_FLOOR_HOURS}. That clock starts at the agreed meeting time, or when the
                later of the two parcels is delivered. If the other trader turns out to have committed
                fraud, their hold is captured and paid to you, and their account is banned.
              </p>
            </Guide>

            <Guide id="in-person" title="Meeting in person">
              <p>
                Pick somewhere public and busy with cameras around, like a card shop or a shopping
                centre, and either bring someone along or let someone know where you&rsquo;ll be. Take
                your time checking the card. If the other person is hurrying you, treat that as a warning
                sign.
              </p>
              <p>
                It helps to know what confirming the handover actually does. On a purchase, it completes
                the sale and releases the money to the seller, so there&rsquo;s no going back. On a trade,
                it only records the swap, and you still have {TRADE_INSPECTION_HOURS} hours to inspect
                what you received.
              </p>
            </Guide>

            <Guide id="sealed" title="Buying sealed product">
              <p>
                Sealed boxes and cases are the one thing the inspection window can&rsquo;t really help
                with. Your 7 days runs whether you open it or not, and opening it is usually what
                destroys its value. If you keep it sealed, you&rsquo;re accepting the contents without
                seeing them, and once the sale completes there&rsquo;s nothing we can do.
              </p>
              <p>
                So the checking has to happen before you pay. Ask for close-up photos of the seams, flaps
                and case code, and look for signs of resealing like wrinkled or re-shrunk film, glue, or
                re-taped flaps. Check that the seller has a history of completed sealed sales, ask for the
                weight on their postage receipt, and weigh it yourself the day it arrives.
              </p>
            </Guide>

            <Guide id="wrong" title="If something goes wrong">
              <p>
                Raise a dispute in the contract room while you&rsquo;re still inside your inspection
                time, even if you haven&rsquo;t gathered your evidence yet. You can add photos, video and
                tracking afterwards, and our case team reads everything both of you send. If you manage
                to sort it out between yourselves, you can withdraw the dispute.
              </p>
              <p>
                If you&rsquo;re refunded and you&rsquo;ve still got the card, you&rsquo;ll need to post it
                back within 7 days, and the refund goes through automatically once the carrier confirms
                it&rsquo;s been delivered. A dispute freezes the money while we review it, which gives
                everyone time to sort things out, but it isn&rsquo;t a promise that every loss will be
                covered.
              </p>
            </Guide>

            <Guide id="limits" title="What we can't do">
              <p>
                We never handle the cards ourselves, so we can&rsquo;t authenticate them, and we
                can&rsquo;t help with anything that was paid for outside NoDitto. When neither side has
                any evidence, we usually can&rsquo;t decide a claim either way. Binder and bulk listings
                don&rsquo;t reserve individual cards, so nothing on them is held for you. And we&rsquo;re
                not a replacement for the police, so if you&rsquo;ve been the victim of serious fraud,
                report it to them and to ReportCyber as well.
              </p>
              <p>
                If you were scammed outside NoDitto, we still can&rsquo;t get your money back, but you
                can{' '}
                <Link href="/report-scam" className="font-medium text-iris-ink underline-offset-4 hover:underline">
                  tell us about it
                </Link>
                . We check every report by hand and watch for the same person turning up here.
              </p>
            </Guide>
          </div>
        </PageSection>

        <Prose>
          <p>
            For more on identity checks, card holds and private deals, have a look at the{' '}
            <Link href="/help" className="font-medium text-iris-ink underline-offset-4 hover:underline">
              Help page
            </Link>
            .
          </p>
        </Prose>
      </div>
    </article>
  );
}
