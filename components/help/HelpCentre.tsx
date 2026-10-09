'use client';

// components/help/HelpCentre.tsx
//
// "How can we help?": search, topics, short answers, and a way to reach a person.
//
// Help was four prose sections — no search, no task entry points ("Where's my
// payout?"), and no contact route — so a member with a question read the page top to
// bottom hoping it came up. Now the questions are the entry points: filter by typing or
// by topic, open the one you have, and if it is not here, message the team.
//
// THE OLD ANCHORS STILL WORK. Other pages link to `/help#holds`, `#identity`,
// `#passwords` and `#deals-as-trades`; each is now the id of the answer that replaced
// that section, and arriving on one opens it.
//
// Every answer follows the same rules as /safety: never promise a protection that is
// not built, and the windows come from the figures the product enforces.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { MessageQuestionIcon, Search01Icon } from '@hugeicons/core-free-icons';

import { StartDealTextLink } from '@/components/deals/StartDealButton';
import { FeedbackDialog } from '@/components/feedback/FeedbackDialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type TopicId = 'buying' | 'selling' | 'trades' | 'payouts-id' | 'account';

const TOPICS: { id: TopicId; label: string }[] = [
  { id: 'buying', label: 'Buying' },
  { id: 'selling', label: 'Selling' },
  { id: 'trades', label: 'Trades' },
  { id: 'payouts-id', label: 'Payouts and ID' },
  { id: 'account', label: 'Account' },
];

const LINK = 'font-medium text-iris-ink underline-offset-4 hover:underline';

interface Answer {
  /** Also the URL fragment that opens this answer. */
  id: string;
  topic: TopicId;
  question: string;
  /** Plain words the search matches beyond the question itself. */
  keywords: string;
  body: ReactNode;
}

function answers(tradeInspectionDays: number): Answer[] {
  return [
    {
      id: 'holds',
      topic: 'buying',
      question: 'How does paying work, and when is the seller paid?',
      keywords: 'payment held stripe escrow money fee checkout',
      body: (
        <>
          <p>
            You pay through Stripe when the deal is agreed. Stripe holds the payment and
            the seller is paid only after you accept the card, or your inspection window
            ends without a dispute. The buyer fee is included in the price you see before
            paying.
          </p>
          <p>
            What that hold legally is, and is not, is set out in the{' '}
            <Link href="/terms" className={LINK}>
              Terms
            </Link>
            .
          </p>
        </>
      ),
    },
    {
      id: 'inspection',
      topic: 'buying',
      question: 'How long do I have to check a card?',
      keywords: 'inspection window days accept dispute deadline',
      body: (
        <p>
          7 days from carrier-confirmed delivery on a posted purchase. Meeting in person,
          there is no window afterwards: confirming the handover completes the sale, so
          check the card before you confirm.
        </p>
      ),
    },
    {
      id: 'problem',
      topic: 'buying',
      question: 'Something is wrong with what arrived',
      keywords: 'dispute report problem damaged fake wrong refund not received',
      body: (
        <>
          <p>
            Raise it in the contract room inside your window, even if you are still
            gathering evidence. The money stays put while our case team reviews it, and
            both sides can add photos and tracking.
          </p>
          <p>
            <Link href="/safety#wrong" className={LINK}>
              What to do if it goes wrong
            </Link>
          </p>
        </>
      ),
    },
    {
      id: 'sell-start',
      topic: 'selling',
      question: 'What do I need before I can sell?',
      keywords: 'list listing verify identity requirements start selling',
      body: (
        <p>
          A Stripe identity check to list. To be paid you also set up payouts, a separate
          Stripe step — you can sell before it is done, but the money waits until it is.
        </p>
      ),
    },
    {
      id: 'payout-when',
      topic: 'selling',
      question: "Where's my payout?",
      keywords: 'paid payout money bank when sale completed',
      body: (
        <p>
          A payout is queued when the sale completes — when the buyer accepts or their
          window ends — and Stripe sends it to your bank on its payout schedule. Track it
          in{' '}
          <Link href="/profile?tab=payouts" className={LINK}>
            Payouts
          </Link>
          .
        </p>
      ),
    },
    {
      id: 'shipping',
      topic: 'selling',
      question: 'How do I post a sold card?',
      keywords: 'ship shipping tracking post carrier parcel',
      body: (
        <p>
          Post it tracked, then add the carrier and tracking number in the contract room.
          The buyer&rsquo;s window starts when the carrier confirms delivery.
        </p>
      ),
    },
    {
      id: 'trade-how',
      topic: 'trades',
      question: 'How do trades work?',
      keywords: 'trade swap collateral card hold meet',
      body: (
        <p>
          Trades are face to face. Both traders place a temporary hold on their card for
          what they receive — an uncaptured authorisation, so nothing is charged while the
          trade goes normally. You meet, swap, confirm, then have {tradeInspectionDays}{' '}
          days to check what you got.
        </p>
      ),
    },
    {
      id: 'deals-as-trades',
      topic: 'trades',
      question: 'What is a private deal?',
      keywords: 'private deal invite link friend',
      body: (
        <>
          <p>
            Two people who already know each other using NoDitto to hold the payment and
            run the handover. Cash for a card runs as a sale; cards both ways run as a
            trade. The cards stay unlisted.
          </p>
          <p>
            <StartDealTextLink className={LINK} /> to send a link.
          </p>
        </>
      ),
    },
    {
      id: 'identity',
      topic: 'payouts-id',
      question: 'How does the identity check work?',
      keywords: 'verify verification identity id photo selfie stripe',
      body: (
        <>
          <p>
            You submit a government document and a selfie to Stripe Identity; Stripe
            checks them and NoDitto records the result. A verified status says Stripe
            accepted that check — not a credit score or a guarantee of performance.
          </p>
          <p>
            Start from{' '}
            <Link href="/profile?tab=verification" className={LINK}>
              Verification
            </Link>
            .
          </p>
        </>
      ),
    },
    {
      id: 'payout-setup',
      topic: 'payouts-id',
      question: 'How do I set up payouts?',
      keywords: 'payouts bank stripe connect setup account',
      body: (
        <p>
          From{' '}
          <Link href="/profile?tab=verification" className={LINK}>
            Verification
          </Link>
          , after the identity check. Stripe collects your bank details directly;
          NoDitto never sees them.
        </p>
      ),
    },
    {
      id: 'passwords',
      topic: 'account',
      question: 'I forgot my password',
      keywords: 'password reset forgot sign in login',
      body: (
        <p>
          Use Forgot password on the sign-in form, or{' '}
          <Link href="/forgot-password" className={LINK}>
            request a reset
          </Link>
          . Signed in already? Account → Security sends the same link.
        </p>
      ),
    },
    {
      id: 'emails',
      topic: 'account',
      question: 'How do I change which emails I get?',
      keywords: 'email notifications unsubscribe settings',
      body: (
        <p>
          Account → Email has a switch for purchase requests and offers, shipping and
          payouts. Deadline and dispute emails always send.
        </p>
      ),
    },
  ];
}

export function HelpCentre({
  signedIn,
  tradeInspectionDays,
}: {
  signedIn: boolean;
  tradeInspectionDays: number;
}) {
  const all = useMemo(() => answers(tradeInspectionDays), [tradeInspectionDays]);
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<TopicId | null>(null);
  const [open, setOpen] = useState<string[]>([]);

  // Arriving on an old anchor opens the answer that replaced it.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id || !all.some((answer) => answer.id === id)) return;
    setOpen([id]);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }, [all]);

  const needle = query.trim().toLowerCase();
  const visible = all.filter(
    (answer) =>
      (!topic || answer.topic === topic) &&
      (!needle || `${answer.question} ${answer.keywords}`.toLowerCase().includes(needle)),
  );

  return (
    <div className="mt-section space-y-section">
      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          className="pointer-events-none absolute left-cozy top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search help, e.g. payout, tracking, dispute"
          aria-label="Search help"
          className="h-11 pl-10 md:h-11"
        />
      </div>

      <div className="flex flex-wrap gap-snug" role="group" aria-label="Topics">
        {TOPICS.map((entry) => {
          const selected = topic === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setTopic(selected ? null : entry.id)}
              className={cn(
                'inline-flex h-9 items-center rounded-full border px-group text-body font-medium transition-colors focus:outline-none focus-visible:border-iris',
                selected
                  ? 'border-foreground bg-foreground text-primary-foreground'
                  : 'border-border bg-card text-foreground hover:border-foreground/40',
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {visible.length > 0 ? (
        <Accordion type="multiple" value={open} onValueChange={setOpen} className="rounded-lg border bg-card px-group">
          {visible.map((answer) => (
            <AccordionItem key={answer.id} value={answer.id} id={answer.id} className="scroll-mt-24 last:border-b-0">
              <AccordionTrigger>{answer.question}</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-snug text-pretty text-body text-muted-foreground">{answer.body}</div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <p className="text-body text-muted-foreground" role="status">
          Nothing matches &ldquo;{query.trim()}&rdquo;. Try another word, or ask us below.
        </p>
      )}

      <section
        aria-labelledby="contact-heading"
        className="flex flex-col gap-cozy rounded-lg border bg-muted/60 p-group sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex gap-cozy">
          <HugeiconsIcon icon={MessageQuestionIcon} className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <h2 id="contact-heading" className="text-body font-semibold text-foreground">
              Still stuck?
            </h2>
            <p className="mt-0.5 text-body text-muted-foreground">
              Message our team. On a live deal, raise it in the contract room instead, where
              it is part of the record.
            </p>
          </div>
        </div>
        {signedIn ? (
          <FeedbackDialog
            trigger={
              <Button type="button" variant="outline" className="shrink-0">
                Contact support
              </Button>
            }
          />
        ) : (
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/sign-in?redirectTo=%2Fhelp">Sign in to contact us</Link>
          </Button>
        )}
      </section>
    </div>
  );
}
