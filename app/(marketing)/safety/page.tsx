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
    window: 'No limit. The only stage where that is true',
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
    window: 'The first few minutes, and you cannot get them back',
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
        Set up payouts before your first sale completes. You can sell without it; you
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
        Your buyer may not be verified — buyers are only ever refunded to their own card.
      </>,
    ],
  },
  {
    title: 'Before it ships',
    window: 'The minutes while you pack. Nothing later replaces them',
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
      <>A saved card is required — collateral cannot be placed without one.</>,
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
    window: 'The minutes while you pack, in both directions',
    moves: [
      <>Same photos as a sale. A swap posts both ways, so both traders owe them.</>,
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
      <p className="mb-group">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-body font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to home
        </Link>
      </p>

      <header className="space-y-cozy">
        <p className="market-label text-muted-foreground">Safety</p>
        <h1 className="text-head font-semibold tracking-tight text-foreground md:text-display">
          How to protect yourself on NoDitto
        </h1>
        <p className="max-w-prose text-pretty text-body text-muted-foreground md:text-lead">
          We will try our best to protect you, but there's a limit to what we can do without your help.
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
                lede="Your money sits with NoDitto until you accept what arrived. That protection runs on a clock."
                stages={BUYING}
              />
            ),
            selling: (
              <RolePanel
                headingId="selling-heading"
                heading="If you are selling"
                idPrefix="selling"
                lede="Sellers lose money to false claims and to reversed card payments. Records defend against both, and can only be made before you post."
                stages={SELLING}
              />
            ),
            trading: (
              <RolePanel
                headingId="trading-heading"
                heading="If you are trading"
                idPrefix="trading"
                lede="A trade is backed by a temporary hold on both traders' cards. That hold expires in about a week, so every window is shorter than a purchase."
                stages={TRADING}
              />
            ),
          }}
        />
      </div>

      <div className="mt-region space-y-section border-t border-border pt-section">
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
                Manufactured urgency: another buyer waiting, an account about to be
                limited.
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
                Support can freeze a disputed contract and review it. That is an
                operational hold, not a promise that every loss is covered.
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
                Settle a claim with no evidence on either side. Then it is one account of
                events against another.
              </>,
              <>
                Act as police. A fraud finding here is about an account and its money,
                not a conviction, and we do not store anyone&rsquo;s identity
                documents to hand over. Serious fraud should also go to the police and ReportCyber.
              </>,
              <>Reserve a card on a binder or bulk listing.</>,
              <>
                Vouch for reviews. Treat a thin history as unknown rather than good.
              </>,
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
