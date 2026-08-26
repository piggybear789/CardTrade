'use client';

// TEMPORARY design harness — delete before committing.

import { CreditCard, ShieldCheck, Wallet } from 'lucide-react';

import { AccountTabs } from '@/components/account/AccountTabs';
import {
  SettingsGroup,
  SettingsListRow,
  SettingsPanelRow,
  TrustLine,
} from '@/components/account/SettingsPrimitives';
import { PayoutSummary } from '@/components/payouts/PayoutSummary';
import type { PayoutReadModel } from '@/domain/payouts/payoutReadModel';

const MODEL = {
  releasingNowCents: 0,
  upcomingProceedsCents: 24500,
  atRiskProceedsCents: 0,
  hasBlockedRelease: false,
} as unknown as PayoutReadModel;

const noop = () => {};

function Header({ verified = true, payouts = true }) {
  return (
    <header className="mb-group flex items-center gap-group px-tight md:mb-section">
      <div
        className="grid size-16 shrink-0 place-items-center rounded-full bg-muted text-subhead font-semibold text-muted-foreground"
        aria-hidden
      >
        A
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <h2 className="truncate text-subhead font-semibold tracking-[-0.02em] md:text-head">
          Alice Nguyen
        </h2>
        <TrustLine identityVerified={verified} payoutsActive={payouts} />
      </div>
    </header>
  );
}

export default function SettingsPreview() {
  return (
    <main className="min-h-dvh bg-background px-group py-group">
      <div className="mx-auto w-full max-w-2xl space-y-region">
        <div>
          <Header />
          <AccountTabs activeTab="profile" />
          <div className="space-y-group md:space-y-section">
            <SettingsGroup>
              <SettingsListRow
                label="Name and email"
                value="alice@example.com"
                onClick={noop}
              />
              <SettingsListRow
                label="Bio"
                description="Vintage WOTC singles, mostly Base Set and Jungle. Same-day post."
                onClick={noop}
              />
              <SettingsListRow label="Links" value="2 links" onClick={noop} />
            </SettingsGroup>

            <SettingsGroup>
              <SettingsListRow
                icon={CreditCard}
                label="Payment method"
                value="Visa ···· 4242"
                onClick={noop}
              />
            </SettingsGroup>
          </div>
        </div>

        <div>
          <Header verified={false} payouts={false} />
          <AccountTabs activeTab="verification" />
          <div className="space-y-group md:space-y-section">
            <SettingsGroup>
              <SettingsPanelRow>
                <p className="text-body text-muted-foreground">
                  (two-step verification spine renders here)
                </p>
              </SettingsPanelRow>
            </SettingsGroup>
          </div>
        </div>

        <div>
          <Header />
          <AccountTabs activeTab="verification" />
          <div className="space-y-group md:space-y-section">
            <div className="px-tight">
              <h3 className="text-lead font-semibold">You&apos;re set up to sell</h3>
              <p className="mt-0.5 text-body text-muted-foreground">
                Both checks are complete. There is nothing else to do here.
              </p>
            </div>
            <SettingsGroup>
              <SettingsListRow
                icon={ShieldCheck}
                tone="verified"
                label="Identity"
                value="Alice Nguyen"
              />
              <SettingsListRow
                icon={Wallet}
                tone="verified"
                label="Payouts"
                value="Active"
              />
            </SettingsGroup>
          </div>
        </div>

        <div>
          <Header />
          <AccountTabs activeTab="payouts" />
          <div className="space-y-group md:space-y-section">
            <PayoutSummary model={MODEL} />
          </div>
        </div>
      </div>
    </main>
  );
}
