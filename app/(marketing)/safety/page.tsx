import type { Metadata } from 'next';
import Link from 'next/link';

import { TabbedPanels, type TabDescriptor } from '@/components/ui/tabbed-panels';

import { RolePanel, SafetyList, SafetySection, type Stage } from './stage-rail';

// app/(marketing)/safety/page.tsx
//
// Member-facing safety guidance, ordered by WHEN rather than by topic. See
// `stage-rail.tsx` for why the ordinals and the per-stage window carry the design.
//
// COPY RULES, both load-bearing.
//
// 1. One line per move, imperative, and the fact comes before the reason. This page is
//    scanned by someone mid-deal, not read. An earlier draft explained the reasoning
//    behind every precaution and buried the precaution.
// 2. Never promise a protection that is not built, and match `/help` on the hedges:
//    trade collateral is a temporary card hold and never "escrow", a binder or bulk
//    listing always states that nothing is held, and freeze-and-review is operational
//    rather than a promise that losses are covered. "What NoDitto cannot do" is not a
//    section to trim for length.
//
// THE PHOTO ADVICE IS A HABIT WE ASK FOR, NOT A STEP WE ENFORCE.
// `RecordShipmentDialog` captures no media and `dispute_evidence` is authored after a
// dispute opens, by a motivated party — so the record that would settle a
// swapped-contents claim is one nobody is prompted to make. If guided capture ever
// becomes a precondition of recording a shipment, this copy becomes description.

export const metadata: Metadata = {
  // "on NoDitto" is in the H1 but not here, where the suffix already says it.
  title: 'How to protect yourself · NoDitto',
  description:
    'What protects you at each stage of a purchase or trade on NoDitto, how long you have to act, and where the platform stops.',
};

type RoleId = 'buying' | 'selling' | 'trading';

const BUYING: Stage[] = [
  {
    title: 'Before you commit to buying',
    window: 'No limit',
    moves: [
      <>Check the seller is identity verified. This means that Stripe has accepted their photo ID.</>,
      <>Read the contract lines, not the listing title. We won't tolerate obvious scam ideas like selling a photo, but we can't help if you make a mistake.</>,
      <>
        Graded card? Look up the certificate number. It is checkable
        against the relevant grader&rsquo;s own registry.
      </>,
      <>Ask for any photos or more detail.</>,
      <>
        Until you hit buy, nothing is held for you.
      </>,
    ],
  },
  {
    title: 'When you pay',
    window: 'Until you pay. After that you are committed',
    moves: [
      <>Your money goes to NoDitto, not the seller, and stays there until you accept.</>,
      <>Check the delivery address and postage before paying.</>,
      <>NoDitto takes a flat 5% of the item price as a fee, built into the sale price. Postage is passed through at cost.</>,
    ],
  },
  {
    title: 'While it is in transit',
    window: 'However long the carrier takes',
    moves: [
      <>Use tracked postage. Carrier confirmation is what starts your inspection window.</>,
      <>Tracking says delivered but nothing came? Say so in the contract immediately.</>,
    ],
  },
  {
    title: 'The moment it arrives',
    window: 'The first few minutes, before you open it',
    moves: [
      <>Photograph the parcel sealed, label visible.</>,
      <>Film the opening in one take.</>,
      <>Keep the packaging until the contract closes.</>,
    ],
  },
  {
    title: 'Your inspection window',
    window: 'You will have 7 days from carrier-confirmed delivery to inspect the item',
    moves: [
      <>Accept or dispute inside it. The contract completes automatically afterwards.</>,
      <>Raise a dispute early even if you are still gathering evidence.</>,
      <>
        For an in-person deal there is a 72 hour inspection window after handover. Check
        the item first before accepting.
      </>,
    ],
  },
];

const SELLING: Stage[] = [
  {
    title: 'Before you list',
    window: 'No limit',
    moves: [
      <>Identity verification is required to list. Payouts are a separate step.</>,
      <>
        Set up payouts before your first sale completes. You can sell without it, but you
        cannot be paid.
      </>,
      <>
        Write the contract lines precisely. Support reads the contract, never the
        listing.
      </>,
    ],
  },
  {
    title: 'Before you agree the terms',
    window: 'Until payment is collected',
    moves: [
      <>Wait for payment to show as collected. Never post on a message or a screenshot.</>,
      <>
        Say no to posting early, to an address that is not on the contract, and to
        under-declaring value.
      </>,
      <>
        Your buyer may not be identity verified. Buyers are only ever refunded to their
        own card, so they are not asked to be.
      </>,
    ],
  },
  {
    title: 'Before it ships',
    window: 'While you pack, and not after',
    moves: [
      <>
        Photograph the item, the packed parcel, then the sealed parcel with the label in
        frame.
      </>,
      <>
        Note the weight off the receipt. Swap claims turn on weight, and the carrier
        records it too.
      </>,
      <>Tracked postage, recorded in the contract room rather than in chat.</>,
    ],
  },
  {
    title: 'While the buyer inspects',
    window: '7 days from carrier-confirmed delivery',
    moves: [
      <>The clock starts on the carrier&rsquo;s confirmation, not the buyer&rsquo;s word.</>,
      <>Answer questions in the contract conversation. It is part of the record.</>,
    ],
  },
  {
    title: 'After it completes',
    window: 'Payout is queued on completion',
    moves: [
      <>Payout needs an active payout account, or it waits.</>,
      <>
        A card payment can still be reversed weeks later. Your dispatch photos and
        tracking are the defence.
      </>,
    ],
  },
];

const TRADING: Stage[] = [
  {
    title: 'Before you agree terms',
    window: 'No limit',
    moves: [
      <>Both traders must be identity verified.</>,
      <>A saved card is required. Collateral cannot be placed without one.</>,
      <>
        Write exactly what you are receiving. &ldquo;Some cards from your binder&rdquo;
        cannot be arbitrated.
      </>,
    ],
  },
  {
    title: 'When collateral locks',
    window: 'About 7 days before the card hold expires on its own',
    moves: [
      <>
        Both sides get a temporary card hold for the agreed value. No money moves and
        nothing is charged.
      </>,
      <>If they will not complete that step, nothing is protecting you. Do not ship.</>,
    ],
  },
  {
    title: 'Before you ship',
    window: 'While you pack, both directions',
    moves: [
      <>Same photos as a sale. A swap posts both ways, so both of you need them.</>,
      <>Ship promptly and record it. If one side stalls, both holds lapse.</>,
    ],
  },
  {
    title: 'Handover or delivery',
    window: 'Your 72 hours starts here',
    moves: [
      <>
        In person: confirming records that you met and swapped. It is
        <strong className="font-semibold text-foreground"> not </strong>
        acceptance.
      </>,
      <>Posted: the window starts at the later of the two carrier confirmations.</>,
      <>
        No-show or lost parcel? Use handover failed. It freezes the trade and charges
        nothing.
      </>,
    ],
  },
  {
    title: 'Your inspection window',
    window: '72 hours, and never less than 24',
    moves: [
      <>Shorter than a purchase, because the card hold expires in about a week.</>,
      <>
        A condition disagreement costs a small fixed fee off the collateral of whoever is
        at fault. Fraud is different: collateral is captured, paid to the person
        defrauded, and the account banned.
      </>,
    ],
  },
];

const ROLES: TabDescriptor<RoleId>[] = [
  { id: 'buying', label: 'Buying', href: '/safety' },
  { id: 'selling', label: 'Selling', href: '/safety?role=selling' },
  { id: 'trading', label: 'Trading', href: '/safety?role=trading' },
];

export default async function SafetyPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string | string[] }>;
}) {
  const { role: rawRole } = await searchParams;

  // Resolved on the server so the first paint already shows the right panel. An
  // unrecognised `?role=` falls back to the first tab, which is what the strip does
  // when answering Back.
  const rawRoleValue = Array.isArray(rawRole) ? rawRole[0] : rawRole;
  const initialRole: RoleId = ROLES.find((entry) => entry.id === rawRoleValue)?.id ?? 'buying';

  return (
    <article className="mx-auto max-w-3xl px-group py-section sm:px-6 md:py-12 lg:px-section">
      {/* Header geometry MIRRORS `PolicyArticle` rather than out-dressing it. This page
          used to open on an eyebrow and a `display` title, one step above /help, /terms
          and /privacy — four marketing pages, four header treatments. There is no
          in-page back link either: the wordmark in `MarketingChrome` and in the desktop
          header both go to `/` and render for signed-in and signed-out alike, so the
          link was a third route to the same place. */}
      <header>
        <h1 className="text-subhead font-semibold tracking-tight text-foreground md:text-head">
          How to protect yourself on NoDitto
        </h1>
        {/* `mt-snug` / `md:mt-cozy` are `PolicyArticle`'s lede offsets, not a guess —
            the header no longer has a `space-y` wrapper to supply them. */}
        <p className="mt-snug max-w-prose text-pretty text-body text-muted-foreground md:mt-cozy md:text-lead">
          We will try our best to protect you, but there&rsquo;s a limit to what we can
          do without your help.
        </p>
      </header>

      {/* THE ONE RULE, ABOVE THE TABS: it is the only guidance here that does not
          depend on role or stage, and off-platform payment is the scam that makes
          everything below it irrelevant. `.cardtrade-warning` is the product's caution
          tone and carries its own defined edge. */}
      <div className="cardtrade-warning mt-section rounded-lg border p-group">
        <p className="market-label">Before anything else</p>
        <p className="mt-snug text-body font-semibold text-foreground">
          Keep the whole deal on NoDitto.
        </p>
        <p className="mt-tight text-pretty text-body">
          Being steered off NoDitto is the clearest sign of a scam - you will be warned if this is attempted. If the contract is not conducted on NoDitto, we cannot provide any protection.
        </p>
      </div>

      {/* NO JUMP-NAV ABOVE THE STRIP. An "on this page" row sitting directly on the
          role tabs read as two competing navigations stacked on each other — the same
          reason `TabbedPanels` does not put an underlined strip under a phone's bottom
          bar. The strip is this page's navigation; the sections below the rule carry
          their own headings. */}
      <div className="mt-section">
        <TabbedPanels
          tabs={ROLES}
          initialTab={initialRole}
          label="Safety guidance by role"
          layoutId="safety-roles"
          param="role"
          panels={{
            buying: (
              <RolePanel
                headingId="buying-heading"
                heading="If you are buying"
                idPrefix="buying"
                lede="Your money sits with NoDitto until you accept what arrived. You have a limited time to check it and say something."
                stages={BUYING}
              />
            ),
            selling: (
              <RolePanel
                headingId="selling-heading"
                heading="If you are selling"
                idPrefix="selling"
                lede="Sellers lose money to false claims and to card payments reversed weeks later. Photos and tracking are what defend you, and you can only take them before you post."
                stages={SELLING}
              />
            ),
            trading: (
              <RolePanel
                headingId="trading-heading"
                heading="If you are trading"
                idPrefix="trading"
                lede="A trade is backed by a temporary hold on both traders' cards. That hold expires after about a week, which is why every deadline in a trade is shorter than in a purchase."
                stages={TRADING}
              />
            ),
          }}
        />
      </div>

      <div className="mt-region space-y-section border-t border-border pt-section">
        {/* SEALED PRODUCT IS THE ONE CATEGORY THE INSPECTION WINDOW CANNOT SERVE, so it
            gets its own section rather than a bullet inside a stage. Checking the
            contents means destroying the premium, so the window forces a choice instead
            of offering a remedy — and a member who does not know that before they pay
            will discover it years later when nothing can be done.

            AMBER, NOT RED. This is not a scam signal; it is a limit on what any
            marketplace can offer, and the advice below is how to work inside it. Red is
            reserved for "walk away".

            DO NOT SOFTEN THE CALLOUT INTO A REASSURANCE. Buyer protection here runs 7
            days from carrier-confirmed delivery and `DISPUTABLE_STATUSES` in
            `cashSaleOrchestrator` has no COMPLETED entry, so a dispute after completion
            returns INVALID_STATE. Verified elsewhere at the time of writing: eBay's
            money-back guarantee and PayPal's not-as-described claims both run 30 days
            from delivery, and eBay's trading-card authentication covers single cards
            only, not sealed cases. Weeks everywhere, against a product held for years.

            THE ORDER OF THE LIST IS THE ADVICE. Tampering signs and seller history come
            first because they are the only two defences that work before the money moves
            and without breaking the seal. Everything after them is either a second
            opinion (weight) or a record for later (photographs) — useful, but no help to
            a member deciding whether to buy at all.

            The weighing and case-code advice is a HABIT we ask for, like the photographs
            — nothing in the product captures or compares a weight today. */}
        <SafetySection id="sealed" title="Sealed and unopened product">
          <div className="cardtrade-warning rounded-lg border p-group">
            <p className="text-body font-semibold text-foreground">
              Your 7 days runs whether you open it or not.
            </p>
            <p className="mt-tight text-pretty text-body">
              Opening a sealed case is the only way to confirm what is inside, and it
              destroys most of what you paid for. Leave it sealed and the contract
              completes on schedule, and once it has completed there is nothing we can do.
              Other platforms give you weeks at most. If you buy sealed and keep it
              sealed, you are accepting the contents unseen.
            </p>
          </div>
          <p className="max-w-prose text-pretty text-body text-muted-foreground">
            You cannot check the contents, so check the packaging and check the seller.
            Both are free and both have to happen before you pay.
          </p>
          <SafetyList
            items={[
              <>
                Check the wrap and the seams first. Resealing leaves marks: wrinkled or
                re-shrunk film, glue residue, re-taped flaps, film that is loose or
                doubled over, a seam somewhere the factory does not put one.
              </>,
              <>
                Ask for close photos of the seams, flaps and case code before you pay. A
                seller with nothing to hide sends them.
              </>,
              <>
                Check the seller&rsquo;s history. Open their seller page: completed sales,
                reviews from different buyers, how long they have been trading, and
                whether they have sold sealed product before.
              </>,
              <>
                A long run of completed sales tells you more than the star rating. If the
                history is thin, you do not know much yet, so keep the purchase small.
              </>,
              <>
                Weigh it the day it arrives, and ask for the weight off the
                seller&rsquo;s postage receipt before you pay. A factory case has a known
                weight, the carrier records it independently, and a swapped or padded one
                rarely matches.
              </>,
              <>
                Photograph the case code, lot number, seams and flaps on arrival, before
                you break anything.
              </>,
              <>
                Selling or reselling sealed? Photograph the case code and weigh it at the
                counter. Keep both. It is your answer if a buyer later says the case was
                opened and swapped.
              </>,
              <>
                Spending heavily? Consider having a third-party authenticator take
                delivery and verify the seal before it reaches you.
              </>,
            ]}
          />
        </SafetySection>

        <SafetySection id="in-person" title="Meeting in person">
          <SafetyList
            items={[
              <>
                Public, busy, daylight, cameras. A card shop, a game store, a shopping
                centre, a police station car park. 
              </>,
              <>Bring someone, and tell a third person where you will be.</>,
              <>Inspect properly. If you are being hurried, that is a warning.</>,
              <>
                <strong className="font-semibold text-foreground">
                  On a purchase, confirming completes the sale and releases the money.
                </strong>{' '}
                There is no window afterwards, so check before you confirm.
              </>,
              <>
                On a trade, confirming only records the swap. Your 72 hours starts from
                there.
              </>,
              <>Keep the meeting place and time in the contract.</>,
            ]}
          />
        </SafetySection>

        <SafetySection id="red-flags" title="Red flags">
          {/* DANGER, NOT CAUTION — deliberately a different tone from the callout above
              the tabs. That one is an instruction ("keep the deal here"); this is a list
              of things to walk away from, and amber for both made them read as two
              intensities of the same note. */}
          <div className="cardtrade-danger rounded-lg border p-group">
            <p className="text-body font-semibold text-foreground">
              Any one of these is a reason to stop and report, not to negotiate.
            </p>
            <ul className="mt-cozy list-disc space-y-snug pl-5 text-body marker:text-destructive">
              <li className="text-pretty">
                Any request to pay outside NoDitto - transfer, friends and family,
                crypto, gift cards, a payment link.
              </li>
              <li className="text-pretty">
                Pressure to move to WhatsApp, Instagram, Discord or email.
              </li>
              <li className="text-pretty">
                Being rushed: another buyer waiting, an account about to be limited.
              </li>
              <li className="text-pretty">
                Well under market on a high-value item. Nobody is that stupid.
              </li>
              <li className="text-pretty">
                Stock, reused or cropped photos, or refusal to send specific ones.
              </li>
              <li className="text-pretty">
                Shipping to an address that is not on the contract.
              </li>
              <li className="text-pretty">
                &ldquo;Support&rdquo; asking for your password, card number, or a code.
                We never do.
              </li>
              <li className="text-pretty">A new account pushing a large first deal.</li>
            </ul>
          </div>
          <p className="text-pretty text-body text-muted-foreground">
            Report a listing or a member from its page. Reports never move money, and the
            person you report is not told.
          </p>
        </SafetySection>

        <SafetySection id="wrong" title="If it goes wrong">
          <SafetyList
            items={[
              <>Raise it in the contract room inside your window, evidence or not.</>,
              <>
                Upload photos, video, packaging and tracking. Both sides can add to it
                and staff read all of it.
              </>,
              <>
                Keep talking in the contract conversation. You can withdraw a dispute if
                you settle it between you.
              </>,
              <>
                Awarded a full refund while holding the goods? They go back first. You
                get 7 days to lodge the parcel, and the refund is automatic on carrier
                confirmation.
              </>,
              <>
                Support can freeze a disputed contract while they look at it. That buys
                time to sort it out. It is not a promise that every loss is covered.
              </>,
            ]}
          />
        </SafetySection>

        <SafetySection id="limits" title="What NoDitto cannot do">
          <SafetyList
            items={[
              <>Authenticate anything. No card passes through our hands.</>,
              <>Help with a payment made off-platform. No contract, nothing to reverse.</>,
              <>
                Settle a claim when neither side has evidence. That is your word against
                theirs, and we were not there.
              </>,
              <>
                Act as police. A fraud finding here is about an account and its money,
                not a conviction, and we do not store anyone&rsquo;s identity
                documents to hand over. Serious fraud should also go to the police and ReportCyber.
              </>,
              <>Reserve a card on a binder or bulk listing.</>,
              <>Vouch for reviews. A thin history is a risk, not a clean record.</>,
            ]}
          />
          <p className="text-pretty text-body text-muted-foreground">
            <Link
              href="/help"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Help
            </Link>{' '}
            covers identity, holds and private deals.
          </p>
        </SafetySection>
      </div>
    </article>
  );
}
