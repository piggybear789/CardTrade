// components/payouts/PayoutSummary.tsx
//
// The four things money does here: the figure a member came to check, then the three
// that account for the rest.
//
// FOUR, NOT THREE. "Paid out" was missing, and its absence had a specific cost: a
// seller whose only sale settled last week opened this to three zeroes, with the money
// that had actually arrived recorded nowhere except a sentence part-way down the
// transfer list. The four now close over the whole lifecycle — coming, held, frozen,
// gone — so a zero in the top three reads as "nothing pending" rather than "nothing
// ever happened".
//
// WHY NOT FOUR TILES. They were three equal cards, each an icon medallion above a
// label above a figure above a caption. Stacked on a phone that is roughly 700px —
// more than a full viewport — to deliver three numbers that are usually all `$0.00`,
// and the dashboard they introduce started below the fold on every visit. Three
// identical cards also give three equal claims on attention when only one of them
// answers "what am I owed"; a fourth would have made that worse, not better, which is
// why the KPI row the design board drew is a list here.
//
// IT REUSES THE LIST VOCABULARY rather than inventing a figures layout. The two
// supporting balances are ordinary settings rows — label left, figure right — so the
// Payouts tab is built from the same parts as the other two. The first pass had them
// as a two-cell grid with a rule down the middle, which read as a fragment of a table
// that had lost its header.
//
// A ZERO IS NOT AN ANNOUNCEMENT. The headline figure drops to muted when there is
// nothing owed: `$0.00` set in near-black at display size is the page shouting a
// non-event at you. Tone is never the only signal — the caption says the same thing
// in words (never rely on colour alone for payment state).

import type { PayoutReadModel } from '@/domain/payouts/payoutReadModel';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SettingsGroup, SettingsListRow, SettingsPanelRow } from '@/components/account/SettingsPrimitives';

/** Money in a row's value slot: tabular, and never dimmed by the row's muted colour. */
function Figure({ cents, tone, currency }: { cents: number; tone?: 'flag'; currency: string }) {
  return (
    <span
      className={cn(
        'display-value',
        cents === 0 ? 'text-muted-foreground' : tone === 'flag' ? 'text-iris-ink' : 'text-foreground',
      )}
    >
      {formatMoney(cents, currency)}
    </span>
  );
}

export function PayoutSummary({ model, currency }: { model: PayoutReadModel; currency: string }) {
  const owed = model.releasingNowCents;

  return (
    <SettingsGroup>
      <SettingsPanelRow>
        <h3 className="text-body text-muted-foreground">Owed to you</h3>
        {/* INK WHEN THERE IS MONEY, whether or not part of it is stuck.
            This went violet on `hasBlockedRelease`, which put a THIRD colour on one
            fact: the figure in violet, the caption under it in grey saying "part of
            this is held up", and the banner immediately below it in red saying the
            same thing with the amount. Violet is the marker hue and means nothing
            about money being blocked; the banner is what carries that, and it does it
            in the colour the rest of the app uses for a problem. */}
        <p
          className={cn(
            'display-value mt-tight text-head',
            owed === 0 ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {formatMoney(owed, currency)}
        </p>
        <p className="mt-tight text-body text-muted-foreground">
          {model.hasBlockedRelease
            ? 'Part of this is held up'
            : 'Released automatically'}
        </p>
      </SettingsPanelRow>

      <SettingsListRow
        label="Held for open sales"
        value={<Figure cents={model.upcomingProceedsCents} currency={currency} />}
      />
      <SettingsListRow
        label="Under dispute"
        value={<Figure cents={model.atRiskProceedsCents} tone="flag" currency={currency} />}
      />
      {/* LAST, AND WITHOUT THE FLAG TONE. It is the only one of the four that is not a
          claim on anybody — reading it in the same colour as the disputed figure would
          make settled money look like a problem. */}
      <SettingsListRow
        label="Paid out"
        value={<Figure cents={model.settledCents} currency={currency} />}
      />

      {/* SAYS WHERE THE MONEY IS, ONCE.
          The three figures above are amounts NoDitto holds, and a member has every
          reason to read a balance on a screen as a balance in an account. It is not
          one: proceeds sit with Stripe in a platform balance until a release is
          queued, which is inherent to holding funds before a buyer accepts rather
          than an implementation detail that better engineering removes. Saying so
          plainly is cheaper than letting someone find out by trying to withdraw —
          and there is deliberately no withdraw control anywhere on this page. */}
      <SettingsPanelRow>
        <p className="text-meta text-muted-foreground">
          NoDitto is not a bank. What we hold for you sits with Stripe, our payment
          provider, until a sale settles and it is released to your payout account
          automatically. It earns no interest and there is nothing here to withdraw.
        </p>
      </SettingsPanelRow>
    </SettingsGroup>
  );
}
