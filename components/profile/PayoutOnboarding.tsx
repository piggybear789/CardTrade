'use client';

// components/profile/PayoutOnboarding.tsx
//
// Seller payout onboarding (Req 3.9, 4.8-4.12). Three states in one card:
//
//   NONE / REJECTED -> the onboarding form. Submitting creates the Managed
//     Merchant at the provider and records the buyer-visible identity, gated on
//     an explicit disclosure consent checkbox.
//   PENDING         -> "awaiting review", plus the test-mode simulator control
//     when the server says it is available.
//   APPROVED        -> the exact identity buyers see at checkout.
//
// Bank details are submitted straight through to the provider and never stored
// by CardTrade, so they are write-only here: the form never renders back an
// account number, and nothing in `MerchantStateData` carries one.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BadgeCheck, Loader2, ShieldAlert, ShieldCheck, Wallet } from 'lucide-react';

import {
  simulateMerchantCompliance,
  submitMerchantOnboarding,
  type MerchantStateData,
  type PayoutSetupContext,
  type SimulateComplianceInput,
} from '@/lib/actions/merchant';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * The onboarding ask, split into three steps. Every field stays mounted (hidden
 * steps are `display:none`) so a single FormData read on submit still sees the
 * whole submission and nothing is lost moving between steps.
 */
const STEPS = [
  {
    id: 'identity',
    title: 'Who is selling',
    dialogTitle: 'Verify your identity',
    dialogDescription: 'The legal name and registration buyers see before they pay.',
  },
  {
    id: 'account',
    title: 'Where to pay you',
    dialogTitle: 'Payout account',
    dialogDescription: 'Where we send your money, sent straight to the provider.',
  },
] as const;

/** Which step owns each field, so a server error can reopen the right one. */
const FIELD_STEP: Record<string, number> = {
  legalEntityName: 0,
  tradingName: 0,
  businessRegistrationNumber: 0,
  businessEmail: 0,
  bankAccountName: 1,
  bankAccountBsb: 1,
  bankAccountNumber: 1,
  buyerDisclosureConsent: 1,
};

const STATUS_BADGE: Record<
  MerchantStateData['merchantStatus'],
  { variant: NonNullable<BadgeProps['variant']>; label: string }
> = {
  APPROVED: { variant: 'default', label: 'Verified' },
  PENDING: { variant: 'secondary', label: 'Being checked' },
  REJECTED: { variant: 'destructive', label: 'Rejected' },
  NONE: { variant: 'destructive', label: 'Unverified' },
};

/** Format an ABN/ACN for display without altering the stored digits. */
function formatRegistration(value: string): string {
  if (/^\d{11}$/.test(value)) {
    return value.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4');
  }
  if (/^\d{9}$/.test(value)) {
    return value.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  }
  return value;
}

// ---------------------------------------------------------------------------
// Live, in-field validation. Runs as the user types/blurs rather than only on
// submit, so a wrong-length BSB or ABN is caught before they ever reach the
// server. Numeric fields also reject non-digit keystrokes outright.
// ---------------------------------------------------------------------------

/** Strip everything but digits, then cap at `max` characters. */
function digitsOnly(value: string, max: number): string {
  return value.replace(/\D+/g, '').slice(0, max);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface OnboardingValues {
  legalEntityName: string;
  tradingName: string;
  businessRegistrationNumber: string;
  businessEmail: string;
  bankAccountName: string;
  bankAccountBsb: string;
  bankAccountNumber: string;
}

const EMPTY_VALUES: OnboardingValues = {
  legalEntityName: '',
  tradingName: '',
  businessRegistrationNumber: '',
  businessEmail: '',
  bankAccountName: '',
  bankAccountBsb: '',
  bankAccountNumber: '',
};

/** Which fields are digit-only, and how many digits each caps out at. */
const DIGIT_FIELDS: Partial<Record<keyof OnboardingValues, number>> = {
  businessRegistrationNumber: 11,
  bankAccountBsb: 6,
  bankAccountNumber: 9,
};

/**
 * Live validation message for one field, or `undefined` when it currently
 * reads as valid. Required-but-empty only reports once the field has been
 * visited, so nothing shows red before the user has had a chance to type.
 */
function liveErrorFor(field: keyof OnboardingValues, value: string, touched: boolean): string | undefined {
  const trimmed = value.trim();
  switch (field) {
    case 'legalEntityName':
    case 'bankAccountName':
      return touched && !trimmed ? 'This field is required.' : undefined;
    case 'businessRegistrationNumber':
      if (!trimmed) return touched ? 'This field is required.' : undefined;
      return trimmed.length === 9 || trimmed.length === 11
        ? undefined
        : `Enter a 9-digit ACN or 11-digit ABN (${trimmed.length} so far).`;
    case 'businessEmail':
      if (!trimmed) return touched ? 'This field is required.' : undefined;
      return EMAIL_PATTERN.test(trimmed) ? undefined : 'Enter a valid email address.';
    case 'bankAccountBsb':
      if (!trimmed) return touched ? 'This field is required.' : undefined;
      return trimmed.length === 6 ? undefined : `BSB must be 6 digits (${trimmed.length} so far).`;
    case 'bankAccountNumber':
      if (!trimmed) return touched ? 'This field is required.' : undefined;
      return trimmed.length >= 3 ? undefined : `Account number must be at least 3 digits.`;
    default:
      return undefined;
  }
}

/** Whether every field in `fields` currently passes {@link liveErrorFor}, ignoring `touched`. */
function stepIsValid(values: OnboardingValues, fields: (keyof OnboardingValues)[]): boolean {
  return fields.every((field) => liveErrorFor(field, values[field], true) === undefined);
}

const STEP_FIELDS: (keyof OnboardingValues)[][] = [
  ['legalEntityName', 'businessRegistrationNumber', 'businessEmail'],
  ['bankAccountName', 'bankAccountBsb', 'bankAccountNumber'],
];

/** A labelled text input with optional inline error wiring. */
function Field({
  id,
  label,
  hint,
  error,
  disabled,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        disabled={disabled}
        {...props}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function PayoutOnboarding({ context }: { context: PayoutSetupContext }) {
  const router = useRouter();
  const [state, setState] = useState(context.state);
  const [canSimulate, setCanSimulate] = useState(context.canSimulateCompliance);
  const [consent, setConsent] = useState(false);
  /** The long onboarding form lives in a modal so the card stays a summary. */
  const [formOpen, setFormOpen] = useState(false);
  /** Index into {@link STEPS}: the form is asked for in three shorter passes. */
  const [step, setStep] = useState(0);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Controlled values so digit-only fields can be filtered as the user types
  // and every field can be validated live rather than only on submit.
  const [values, setValues] = useState<OnboardingValues>(EMPTY_VALUES);
  const [touched, setTouched] = useState<Partial<Record<keyof OnboardingValues, boolean>>>({});

  const badge = STATUS_BADGE[state.merchantStatus] ?? STATUS_BADGE.NONE;
  const showForm = state.merchantStatus === 'NONE' || state.merchantStatus === 'REJECTED';

  /** Update a field's value, applying digit-filtering for numeric fields. */
  function setValue(field: keyof OnboardingValues, raw: string) {
    const max = DIGIT_FIELDS[field];
    setValues((current) => ({
      ...current,
      [field]: max !== undefined ? digitsOnly(raw, max) : raw,
    }));
  }

  function markTouched(field: keyof OnboardingValues) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  /** Live error for a field, falling back to the last server-reported error. */
  function errorFor(field: string): string | undefined {
    if (field in EMPTY_VALUES) {
      const key = field as keyof OnboardingValues;
      const live = liveErrorFor(key, values[key], Boolean(touched[key]));
      if (live) return live;
    }
    return fieldError?.field === field ? fieldError.message : undefined;
  }

  /** Advance a step, marking its fields touched so any remaining gaps show red. */
  function handleNext() {
    for (const field of STEP_FIELDS[step]) markTouched(field);
    if (!stepIsValid(values, STEP_FIELDS[step])) return;
    setStep((current) => current + 1);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);

    // Touch every field so a submit from any step surfaces every remaining gap.
    setTouched({
      legalEntityName: true,
      tradingName: true,
      businessRegistrationNumber: true,
      businessEmail: true,
      bankAccountName: true,
      bankAccountBsb: true,
      bankAccountNumber: true,
    });
    const allFields = [...STEP_FIELDS[0], ...STEP_FIELDS[1]];
    if (!stepIsValid(values, allFields)) {
      // Jump to the earliest step with an invalid field so it's visible.
      const invalidStep = STEP_FIELDS.findIndex(
        (fields) => !stepIsValid(values, fields),
      );
      if (invalidStep >= 0) setStep(invalidStep);
      return;
    }

    if (!consent) {
      setFieldError({
        field: 'buyerDisclosureConsent',
        message: 'Buyers must be able to see who they are paying, so this is required.',
      });
      setStep(STEPS.length - 1);
      return;
    }

    startTransition(async () => {
      const result = await submitMerchantOnboarding({
        legalEntityName: values.legalEntityName.trim(),
        tradingName: values.tradingName.trim() || undefined,
        businessEmail: values.businessEmail.trim(),
        businessRegistrationNumber: values.businessRegistrationNumber.trim(),
        bankAccountName: values.bankAccountName.trim(),
        bankAccountBsb: values.bankAccountBsb.trim(),
        bankAccountNumber: values.bankAccountNumber.trim(),
        organisationType: 'individual',
        buyerDisclosureConsent: true,
      });

      if (result.ok) {
        setState(result.data);
        setFormOpen(false);
        toast.success('Identity submitted for verification.');
        router.refresh();
        return;
      }
      setFieldError({ field: result.field, message: result.message });
      // Reopen the step that owns the offending field, so the error is visible.
      if (result.field && FIELD_STEP[result.field] !== undefined) {
        setStep(FIELD_STEP[result.field]);
      }
      toast.error(result.message);
    });
  }

  function handleSimulate(outcome: SimulateComplianceInput) {
    startTransition(async () => {
      const result = await simulateMerchantCompliance(outcome);
      if (result.ok) {
        setState(result.data);
        setCanSimulate(Boolean(result.data.merchantRef));
        toast.success(`Provider decision delivered: ${outcome}.`);
        router.refresh();
        return;
      }
      toast.error(result.message);
    });
  }

  const generalError = fieldError && !fieldError.field ? fieldError.message : undefined;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="text-xl">Identity verification</CardTitle>
            <CardDescription>
              Verifying is what unlocks listing and drops trade collateral to
              zero. It doubles as payout setup: buyers see your legal name and
              registration before they pay.
            </CardDescription>
          </div>
          <Badge variant={badge.variant} aria-label={`Verification status: ${badge.label}`}>
            {badge.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* NONE: nothing submitted yet — the strongest call to action, since
            this is the one thing that fully blocks listing. */}
        {state.merchantStatus === 'NONE' ? (
          <div className="flex items-start gap-3 rounded-lg border border-gold/50 bg-gold/10 p-4">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
            <div>
              <p className="font-semibold">You are not verified</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You cannot list an item yet, and trades hold collateral against
                you until this is approved.
              </p>
            </div>
          </div>
        ) : null}

        {/* APPROVED: show exactly what a buyer is shown at checkout. */}
        {state.merchantStatus === 'APPROVED' && state.legalEntityName ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <BadgeCheck className="h-4 w-4" aria-hidden />
              What buyers see
            </div>
            <dl className="grid gap-2 text-sm">
              {state.tradingName ? (
                <div>
                  <dt className="text-muted-foreground">Store</dt>
                  <dd className="font-medium">{state.tradingName}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground">Legal seller</dt>
                <dd className="font-medium">{state.legalEntityName}</dd>
              </div>
              {state.registrationNumber ? (
                <div>
                  <dt className="text-muted-foreground">Registration</dt>
                  <dd className="font-medium">
                    {formatRegistration(state.registrationNumber)}
                  </dd>
                </div>
              ) : null}
              {state.identityVerifiedAt ? (
                <div>
                  <dt className="text-muted-foreground">Approved</dt>
                  <dd>{new Date(state.identityVerifiedAt).toLocaleDateString('en-AU')}</dd>
                </div>
              ) : null}
            </dl>
            {!state.settlementsEnabled ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Settlements are not enabled yet, so direct payouts stay paused.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* PENDING: waiting on the provider's human review. */}
        {state.merchantStatus === 'PENDING' ? (
          <div className="rounded-lg border p-4 text-sm">
            <p className="font-medium">Checking your bank details</p>
            <p className="mt-1 text-muted-foreground">
              Our payment provider is confirming the account before money can be
              sent to it. You can keep listing and trading while it happens.
            </p>
            {state.complianceStatus ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Provider status: {state.complianceStatus}
              </p>
            ) : null}
          </div>
        ) : null}

        {state.merchantStatus === 'REJECTED' ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium">Your verification was declined</p>
            <p className="mt-1 text-muted-foreground">
              Check your details and send them again.
            </p>
          </div>
        ) : null}

        {showForm ? (
          <Dialog open={formOpen} onOpenChange={setFormOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant={state.merchantStatus === 'NONE' ? 'default' : 'outline'}
                // Always start at the first step when reopening.
                onClick={() => setStep(0)}
              >
                <Wallet aria-hidden />
                {state.merchantStatus === 'REJECTED'
                  ? 'Fix and resubmit'
                  : 'Verify my identity'}
              </Button>
            </DialogTrigger>
            {/* Wider than the default so the field pairs sit side by side and the
                dialog reads as a landscape panel rather than a tall column. Also
                overrides the base component's 30rem height cap — at this width the
                two-column step content comfortably fits without scrolling on
                typical viewports. */}
            <DialogContent className="max-w-2xl max-h-[calc(100dvh-3rem)] gap-3">
              <DialogHeader>
                <DialogTitle>{STEPS[step].dialogTitle}</DialogTitle>
                <DialogDescription>{STEPS[step].dialogDescription}</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                {/* Two columns so each step fills the width instead of running tall.
                    Inactive steps stay mounted but hidden, preserving their values. */}
                <fieldset
                  className={cn(
                    'gap-4 sm:grid-cols-2',
                    step === 0 ? 'grid' : 'hidden',
                  )}
                  disabled={isPending}
                >
                  {/* The step footer already names this step, so the legend is
                      visually redundant — kept for screen readers only. */}
                  <legend className="sr-only">Legal seller identity</legend>
                  <Field
                    id="legalEntityName"
                    label="Legal name or registered entity"
                    hint="The person or company that legally receives the money."
                    autoComplete="organization"
                    maxLength={255}
                    required
                    value={values.legalEntityName}
                    onChange={(e) => setValue('legalEntityName', e.target.value)}
                    onBlur={() => markTouched('legalEntityName')}
                    error={errorFor('legalEntityName')}
                  />
                  <Field
                    id="tradingName"
                    label="Store name (optional)"
                    hint="Shown to buyers alongside your legal name."
                    maxLength={255}
                    value={values.tradingName}
                    onChange={(e) => setValue('tradingName', e.target.value)}
                    error={errorFor('tradingName')}
                  />
                  <Field
                    id="businessRegistrationNumber"
                    label="ABN or ACN"
                    hint="11 digits for an ABN, 9 for an ACN. Shown to buyers so they know who they are paying."
                    inputMode="numeric"
                    required
                    value={values.businessRegistrationNumber}
                    onChange={(e) => setValue('businessRegistrationNumber', e.target.value)}
                    onBlur={() => markTouched('businessRegistrationNumber')}
                    error={errorFor('businessRegistrationNumber')}
                  />
                  <Field
                    id="businessEmail"
                    label="Business email"
                    type="email"
                    autoComplete="email"
                    required
                    value={values.businessEmail}
                    onChange={(e) => setValue('businessEmail', e.target.value)}
                    onBlur={() => markTouched('businessEmail')}
                    error={errorFor('businessEmail')}
                  />
                </fieldset>

                <fieldset
                  className={cn('gap-4 sm:grid-cols-2', step === 1 ? 'grid' : 'hidden')}
                  disabled={isPending}
                >
                  <legend className="sr-only">Payout account</legend>
                  <div className="sm:col-span-2">
                    <Field
                      id="bankAccountName"
                      label="Account name"
                      maxLength={255}
                      required
                      value={values.bankAccountName}
                      onChange={(e) => setValue('bankAccountName', e.target.value)}
                      onBlur={() => markTouched('bankAccountName')}
                      error={errorFor('bankAccountName')}
                    />
                  </div>
                  <Field
                    id="bankAccountBsb"
                    label="BSB"
                    hint="6 digits"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    value={values.bankAccountBsb}
                    onChange={(e) => setValue('bankAccountBsb', e.target.value)}
                    onBlur={() => markTouched('bankAccountBsb')}
                    error={errorFor('bankAccountBsb')}
                  />
                  <Field
                    id="bankAccountNumber"
                    label="Account number"
                    hint="3-9 digits"
                    inputMode="numeric"
                    autoComplete="off"
                    required
                    value={values.bankAccountNumber}
                    onChange={(e) => setValue('bankAccountNumber', e.target.value)}
                    onBlur={() => markTouched('bankAccountNumber')}
                    error={errorFor('bankAccountNumber')}
                  />

                  {/* Contact, DOB and address are optional on the provider's create
                      call and prove nothing on their own — the provider verifies a
                      seller from documents, not typed details. They are collected at
                      document-upload time instead of padding this form. */}

                  <label className="col-span-full mt-2 flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4"
                      disabled={isPending}
                      aria-describedby={
                        errorFor('buyerDisclosureConsent')
                          ? 'buyerDisclosureConsent-error'
                          : undefined
                      }
                    />
                    <span>
                      I agree that my legal name, store name and registration number
                      are shown to buyers before they pay.
                    </span>
                  </label>
                  {errorFor('buyerDisclosureConsent') ? (
                    <p
                      id="buyerDisclosureConsent-error"
                      role="alert"
                      className="col-span-full text-sm text-destructive"
                    >
                      {errorFor('buyerDisclosureConsent')}
                    </p>
                  ) : null}
                </fieldset>

                {generalError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {generalError}
                  </p>
                ) : null}

                {/* Step controls. Only the last step submits, so an early Enter
                    keypress advances instead of sending a half-filled form. */}
                <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    Step {step + 1} of {STEPS.length} · {STEPS[step].title}
                  </p>
                  <div className="flex gap-2 sm:justify-end">
                    {step > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setStep((current) => current - 1)}
                        disabled={isPending}
                      >
                        Back
                      </Button>
                    ) : null}
                    {step < STEPS.length - 1 ? (
                      <Button type="button" onClick={handleNext} disabled={isPending}>
                        Next
                      </Button>
                    ) : (
                      <Button type="submit" disabled={isPending} aria-busy={isPending}>
                        {isPending ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : null}
                        {isPending ? 'Sending…' : 'Submit for verification'}
                      </Button>
                    )}
                  </div>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}

        {/* Test-mode only. The server decides availability; this control asks the
            provider integration to deliver a signed compliance webhook to our own
            handler, so the real decision path runs. */}
        {canSimulate ? (
          <div className="rounded-lg border border-dashed p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Test mode: simulate the provider decision
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Compliance review is a manual step at the provider, so test mode
              delivers a signed decision webhook instead of waiting for it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => handleSimulate('approved')}
                disabled={isPending}
              >
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleSimulate('in-review')}
                disabled={isPending}
              >
                Put in review
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleSimulate('rejected')}
                disabled={isPending}
              >
                Reject
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
