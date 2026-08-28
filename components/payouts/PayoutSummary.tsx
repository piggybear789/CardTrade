// components/payouts/PayoutSummary.tsx
//
// The three payout balances: the figure a member came to check, then the two that
// account for the rest.
//
// WHY NOT THREE TILES. They were three equal cards, each an icon medallion above a
// label above a figure above a caption. Stacked on a phone that is roughly 700px —
// more than a full viewport — to deliver three numbers that are usually all `$0.00`,
// and the dashboard they introduce started below the fold on every visit. Three
// identical cards also give three equal claims on attention when only one of them
// answers "what am I owed".
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
import { formatAud } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SettingsGroup, SettingsListRow, SettingsPanelRow } from '@/components/account/SettingsPrimitives';

/** Money in a row's value slot: tabular, and never dimmed by the row's muted colour. */
function Figure({ cents, tone }: { cents: number; tone?: 'flag' }) {
  return (
    <span
      className={cn(
        'display-value',
        cents === 0 ? 'text-muted-foreground' : tone === 'flag' ? 'text-iris-ink' : 'text-foreground',
      )}
    >
      {formatAud(cents)}
    </span>
  );
}

export function PayoutSummary({ model }: { model: PayoutReadModel }) {
  const owed = model.releasingNowCents;

  return (
    <SettingsGroup>
      <SettingsPanelRow>
        <h3 className="text-body text-muted-foreground">Owed to you</h3>
        <p
          className={cn(
            'display-value mt-tight text-head',
            owed === 0
              ? 'text-muted-foreground'
              : model.hasBlockedRelease
                ? 'text-iris-ink'
                : 'text-foreground',
          )}
        >
          {formatAud(owed)}
        </p>
        <p className="mt-tight text-body text-muted-foreground">
          {model.hasBlockedRelease
            ? 'Part of this is held up'
            : 'Released automatically'}
        </p>
      </SettingsPanelRow>

      <SettingsListRow
        label="Held for open sales"
        value={<Figure cents={model.upcomingProceedsCents} />}
      />
      <SettingsListRow
        label="Under dispute"
        value={<Figure cents={model.atRiskProceedsCents} tone="flag" />}
      />
    </SettingsGroup>
  );
}
