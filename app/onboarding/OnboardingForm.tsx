'use client';

// app/onboarding/OnboardingForm.tsx
//
// Two screens, then they are in:
//   1. The rules — buy, sell, trade, and the fraud ban. Accepting is the gate.
//   2. A public name
//
// Australia is assigned silently — it is the only live trading region, and a
// Connect payout account is later created in that country. Identity waits until
// they list or trade. A card waits until checkout. Payouts wait until money is
// owed.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { completeOnboarding } from '@/lib/actions/profile';
import { setTradingRegion } from '@/lib/actions/region';
import type { RegionCode } from '@/domain/region';
import { DittoNotWelcome } from '@/components/brand/DittoNotWelcome';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Step = 'welcome' | 'username';

const RULES = [
  {
    title: 'Verify before you sell or trade',
    detail: 'A photo ID and a selfie. Buying only needs a card.',
  },
  {
    title: 'Sale money stays held',
    detail: 'The buyer pays first. The seller is paid after inspection.',
  },
  {
    title: 'Both sides must lock a hold to trade',
    detail: 'Holds come off when the trade is confirmed.',
  },
  {
    title: 'Fraud is a permanent ban',
    detail: 'The ban follows you — not just this account.',
  },
] as const;

export function OnboardingForm({
  initialDisplayName,
  tradingRegion,
  redirectTo,
}: {
  initialDisplayName: string;
  tradingRegion: RegionCode;
  redirectTo: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('welcome');
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed.length < 2) {
      setError('Pick a name with at least 2 characters.');
      return;
    }

    // Region first: the Connect account is created with a country derived from
    // this value, and an account registered in the wrong country cannot be paid.
    setSaving(true);
    setError(null);
    const regionResult = await setTradingRegion(tradingRegion);
    if (!regionResult.ok) {
      setError(regionResult.message);
      setSaving(false);
      return;
    }

    const result = await completeOnboarding(trimmed);
    if (!result.ok) {
      setError(result.message);
      setSaving(false);
      return;
    }

    router.push(redirectTo ?? '/listings');
  }

  return (
    <main className="min-h-dvh bg-background" aria-label="Member onboarding">
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent
          mobile="center"
          animation="fade"
          showClose={false}
          className="w-[calc(100%-2rem)] max-w-md p-6 sm:p-8"
        >
          {step === 'welcome' ? (
            <div className="space-y-6">
              <DialogHeader className="items-center space-y-3 pr-0 text-center">
                <DittoNotWelcome compact />
                <div className="space-y-1.5">
                  <DialogTitle className="text-balance text-head">
                    Welcome to NoDitto
                  </DialogTitle>
                  <DialogDescription className="text-pretty text-foreground/80">
                    Buy, sell, and trade — protected both ways.
                  </DialogDescription>
                </div>
              </DialogHeader>

              <ol className="border-t border-border">
                {RULES.map((rule, index) => (
                  <li
                    key={rule.title}
                    className="flex gap-3 border-b border-border py-3.5"
                  >
                    <span
                      className="mt-0.5 w-4 shrink-0 text-meta font-semibold tabular-nums text-foreground/50"
                      aria-hidden
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{rule.title}</p>
                      <p className="mt-0.5 text-pretty text-body text-foreground/70">
                        {rule.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              <Button
                type="button"
                onClick={() => setStep('username')}
                className="w-full"
                size="lg"
              >
                I have read and accept the rules
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep('welcome');
                }}
                className="inline-flex items-center gap-1 text-body text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Back
              </button>

              <p className="sr-only">Step 2 of 2</p>

              <DialogHeader className="space-y-1.5 pr-0">
                <DialogTitle className="text-balance text-head">Choose a name</DialogTitle>
                <DialogDescription>This is what other members will see.</DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="displayName">Display name</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. PokeTrader99, Phil Y."
                  maxLength={255}
                  autoFocus={!initialDisplayName}
                  autoComplete="nickname"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleContinue();
                  }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'onboarding-error' : undefined}
                />
              </div>

              {error ? (
                <p id="onboarding-error" role="alert" className="text-body text-destructive">
                  {error}
                </p>
              ) : null}

              <Button
                type="button"
                onClick={() => void handleContinue()}
                disabled={!displayName.trim() || saving}
                className="w-full"
                size="lg"
              >
                {saving ? 'Saving…' : 'Continue'}
                <ArrowRight className="ml-2 size-4" aria-hidden />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
