'use client';

// components/deals/NewDealForm.tsx
//
// Creates a private deal as a short, role-driven flow: identify the deal,
// choose the handover, then describe what the creator is offering. Conditional
// requirements are enforced both here for immediate feedback and by createDeal
// at the server boundary. Money crosses that boundary as integer AUD cents.

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  MapPin,
  Repeat,
  ShieldAlert,
  ShoppingCart,
  Tag,
  Truck,
  X,
} from 'lucide-react';

import { ShareDealLink } from '@/components/deals/ShareDealLink';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  createDeal,
  type CreateDealResult,
  type DealOfferKind,
  type DealPhotoUpload,
  type DealRole,
  type HandoverMethod,
} from '@/lib/actions/deals';
import {
  DEAL_CASH_MAX,
  DEAL_DEFAULT_COLLATERAL_CENTS,
  DEAL_DELIVERY_COST_MAX,
  DEAL_PHOTOS_MAX,
  DEAL_TEXT_MAX,
  DEAL_TITLE_MAX,
} from '@/lib/marketplace-constants';
import { formatAud } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Form fields that can own an inline validation message. */
type ErrorField =
  | 'title'
  | 'role'
  | 'offerKinds'
  | 'cash'
  | 'handover'
  | 'meetingLocation'
  | 'deliveryCost'
  | 'photos'
  | 'general';

type FormError = { field: ErrorField; message: string };

const ERROR_TARGETS: Record<ErrorField, string> = {
  title: 'deal-title',
  role: 'deal-role-BUYER',
  offerKinds: 'deal-offer-CARDS',
  cash: 'deal-cash',
  handover: 'deal-handover-IN_PERSON',
  meetingLocation: 'deal-meeting-location',
  deliveryCost: 'deal-delivery-cost',
  photos: 'deal-photos',
  general: 'deal-form-error',
};

/** Friendly copy and field ownership for typed createDeal failures. */
const ACTION_ERRORS: Record<
  string,
  { field: ErrorField; message: string }
> = {
  unauthenticated: { field: 'general', message: 'Please sign in to start a deal.' },
  'invalid-title': {
    field: 'title',
    message: 'Use a title between 3 and 120 characters.',
  },
  'invalid-role': {
    field: 'role',
    message: 'Choose whether you are buying, selling, or trading.',
  },
  'invalid-offer-kinds': {
    field: 'offerKinds',
    message: 'Choose at least one thing you are putting up.',
  },
  'invalid-cash': { field: 'cash', message: 'Enter a valid cash amount.' },
  'photos-required': {
    field: 'photos',
    message: 'Add at least one clear photo of what you are putting up.',
  },
  'too-many-photos': {
    field: 'photos',
    message: `You can add up to ${DEAL_PHOTOS_MAX} photos.`,
  },
  'upload-failed': {
    field: 'photos',
    message: 'Your photos could not be uploaded. Please try again.',
  },
  'invalid-handover': {
    field: 'handover',
    message: 'Choose how the goods change hands.',
  },
  'missing-meeting-location': {
    field: 'meetingLocation',
    message: 'Add where you plan to meet.',
  },
  'invalid-delivery-cost': {
    field: 'deliveryCost',
    message: 'Enter the delivery cost, or 0 for free delivery.',
  },
  'persistence-error': {
    field: 'general',
    message: 'Could not start the deal. Please try again.',
  },
};

function errorFromResult(
  result: Extract<CreateDealResult, { ok: false }>,
): FormError {
  return (
    ACTION_ERRORS[result.error] ?? {
      field: 'general',
      message: result.detail ?? 'Could not start the deal.',
    }
  );
}

/** Parse a plain AUD dollars input with no more than two decimal places. */
function dollarsToCents(raw: string): number | null {
  const value = raw.trim();
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(value)) return null;
  const dollars = Number(value);
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}
/** A required marker with accessible copy. */
function Required() {
  return (
    <>
      <span className="text-destructive" aria-hidden>
        {' '}*
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

/** Consistent inline validation message. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** Numbered section wrapper for a short, scannable form flow. */
function FormSection({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-6 first:pt-0 last:pb-0" aria-labelledby={`step-${number}`}>
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {number}
        </span>
        <div>
          <h2 id={`step-${number}`} className="font-semibold leading-7">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-5 sm:pl-10">{children}</div>
    </section>
  );
}

/** The three sides a creator can be on. */
const ROLE_OPTIONS: {
  value: DealRole;
  label: string;
  hint: string;
  icon: typeof ShoppingCart;
}[] = [
  { value: 'BUYER', label: 'Buying', hint: 'I pay cash', icon: ShoppingCart },
  { value: 'SELLER', label: 'Selling', hint: 'I receive cash', icon: Tag },
  {
    value: 'TRADER',
    label: 'Trading',
    hint: 'I put up cards, cash or items',
    icon: Repeat,
  },
];

/** How the goods change hands. */
const HANDOVER_OPTIONS: {
  value: HandoverMethod;
  label: string;
  hint: string;
  icon: typeof MapPin;
}[] = [
  {
    value: 'IN_PERSON',
    label: 'Face to face',
    hint: 'Meet and exchange in person',
    icon: MapPin,
  },
  {
    value: 'DELIVERY',
    label: 'Delivery',
    hint: 'Post it with a separate delivery cost',
    icon: Truck,
  },
];

/** What a trader can put up. `ITEMS` makes photos mandatory. */
const OFFER_OPTIONS: { value: DealOfferKind; label: string; hint: string }[] = [
  { value: 'CARDS', label: 'Cards', hint: 'Graded or raw cards' },
  { value: 'CASH', label: 'Cash', hint: 'A cash amount on top' },
  { value: 'ITEMS', label: 'Other items', hint: 'Photos required' },
];

type CreatedDeal = { dealId: string; shareToken: string; title: string };

export interface NewDealFormProps {
  /**
   * True when the creator is not identity verified, so collateral will be held
   * on BOTH sides once the deal is confirmed. Presentation only — the amount is
   * resolved server-side by `confirmDeal`.
   */
  collateralRequired?: boolean;
}

/** A form for creating a private 1:1 deal and revealing its share link. */
export function NewDealForm({ collateralRequired = false }: NewDealFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [role, setRole] = useState<DealRole | null>(null);
  const [description, setDescription] = useState('');
  const [handover, setHandover] = useState<HandoverMethod | null>(null);
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingAt, setMeetingAt] = useState('');
  const [offerKinds, setOfferKinds] = useState<DealOfferKind[]>([]);
  const [cash, setCash] = useState('');
  const [deliveryCost, setDeliveryCost] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<FormError | null>(null);
  const [created, setCreated] = useState<CreatedDeal | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tradesCash = role === 'TRADER' && offerKinds.includes('CASH');
  const tradesItems = role === 'TRADER' && offerKinds.includes('ITEMS');
  const cashRequired = role === 'BUYER' || role === 'SELLER' || tradesCash;
  const showPhotos = role === 'SELLER' || role === 'TRADER';
  const photosRequired = role === 'SELLER' || tradesItems;

  const cashLabel =
    role === 'BUYER'
      ? 'Amount you pay'
      : role === 'SELLER'
        ? 'Amount you receive'
        : 'Cash you put up';

  // What each side is held for while the creator stays unverified: the deal's own
  // cash value, or the flat default for a pure swap. The server resolves the real
  // figure at confirmation time — this is the live estimate as the form is filled.
  const enteredCash = cashRequired ? dollarsToCents(cash) : null;
  const collateralStakeCents =
    enteredCash && enteredCash > 0 ? enteredCash : DEAL_DEFAULT_COLLATERAL_CENTS;

  function messageFor(field: ErrorField): string | undefined {
    return error?.field === field ? error.message : undefined;
  }

  function clearError(field: ErrorField) {
    setError((current) => (current?.field === field ? null : current));
  }

  function fail(field: ErrorField, message: string, targetId: string) {
    setError({ field, message });
    window.setTimeout(() => document.getElementById(targetId)?.focus(), 0);
  }

  function chooseRole(nextRole: DealRole) {
    setRole(nextRole);
    clearError('role');
    if (nextRole !== 'TRADER') setOfferKinds([]);
    if (nextRole === 'BUYER') setPhotos([]);
  }

  function toggleOfferKind(kind: DealOfferKind) {
    setOfferKinds((current) =>
      current.includes(kind)
        ? current.filter((selected) => selected !== kind)
        : [...current, kind],
    );
    clearError('offerKinds');
  }

  function handlePhotosSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (photos.length + picked.length > DEAL_PHOTOS_MAX) {
      setError({
        field: 'photos',
        message: `You can add up to ${DEAL_PHOTOS_MAX} photos.`,
      });
    } else if (picked.length > 0) {
      setPhotos((current) => [...current, ...picked]);
      clearError('photos');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removePhoto(index: number) {
    setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const dealTitle = title.trim();
    if (dealTitle.length < 3) {
      fail('title', 'Use at least 3 characters.', 'deal-title');
      return;
    }
    if (role === null) {
      fail('role', 'Choose whether you are buying, selling, or trading.', 'deal-role-BUYER');
      return;
    }
    if (handover === null) {
      fail('handover', 'Choose face to face or delivery.', 'deal-handover-IN_PERSON');
      return;
    }
    if (handover === 'IN_PERSON' && !meetingLocation.trim()) {
      fail('meetingLocation', 'Add where you plan to meet.', 'deal-meeting-location');
      return;
    }
    if (role === 'TRADER' && offerKinds.length === 0) {
      fail('offerKinds', 'Choose at least one thing you are putting up.', 'deal-offer-CARDS');
      return;
    }

    let cashAmountCents: number | undefined;
    if (cashRequired) {
      cashAmountCents = dollarsToCents(cash) ?? undefined;
      if (cashAmountCents === undefined || cashAmountCents <= 0) {
        fail('cash', 'Enter an amount greater than zero.', 'deal-cash');
        return;
      }
      if (cashAmountCents > DEAL_CASH_MAX) {
        fail('cash', 'That amount is too large.', 'deal-cash');
        return;
      }
    }

    let deliveryCostCents: number | undefined;
    if (handover === 'DELIVERY') {
      deliveryCostCents = dollarsToCents(deliveryCost) ?? undefined;
      if (deliveryCostCents === undefined) {
        fail(
          'deliveryCost',
          'Enter the delivery cost, or 0 for free delivery.',
          'deal-delivery-cost',
        );
        return;
      }
      if (deliveryCostCents > DEAL_DELIVERY_COST_MAX) {
        fail('deliveryCost', 'That delivery cost is too large.', 'deal-delivery-cost');
        return;
      }
    }

    if (photosRequired && photos.length === 0) {
      fail(
        'photos',
        role === 'SELLER'
          ? 'Add at least one photo of the item you are selling.'
          : 'Add at least one photo of the items you are putting up.',
        'deal-photos',
      );
      return;
    }

    startTransition(async () => {
      try {
        const result = await createDeal({
          title: dealTitle,
          role,
          description: description.trim() || undefined,
          handoverMethod: handover,
          meetingLocation:
            handover === 'IN_PERSON' ? meetingLocation.trim() : undefined,
          meetingAt:
            handover === 'IN_PERSON' && meetingAt
              ? new Date(meetingAt).toISOString()
              : null,
          cashAmountCents,
          deliveryCostCents,
          offerKinds: role === 'TRADER' ? offerKinds : undefined,
          photos: showPhotos
            ? (photos as unknown as DealPhotoUpload[])
            : undefined,
        });

        if (result.ok) {
          toast.success('Deal created — share the link.');
          setCreated({
            dealId: result.dealId,
            shareToken: result.shareToken,
            title: dealTitle,
          });
          return;
        }

        const nextError = errorFromResult(result);
        setError(nextError);
        if (nextError.field === 'general') {
          toast.error(nextError.message);
        } else {
          window.setTimeout(
            () => document.getElementById(ERROR_TARGETS[nextError.field])?.focus(),
            0,
          );
        }
      } catch {
        const message = 'Something went wrong. Please try again.';
        setError({ field: 'general', message });
        toast.error(message);
      }
    });
  }

  if (created) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
              Deal created
            </h2>
          </CardTitle>
          <CardDescription>
            Send this private link to the person you&apos;re dealing with. They can
            review the terms before joining.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ShareDealLink shareToken={created.shareToken} title={created.title} />
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            The first person to open the link and join takes the other seat. Only
            share it with the person you intend to deal with.
          </p>
          {collateralRequired ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="flex items-center gap-2 font-medium">
                <ShieldAlert className="size-4 shrink-0" aria-hidden />
                Collateral applies to this deal
              </p>
              <p className="mt-1">
                You skipped verification, so when you both confirm, each side is
                held for the deal&apos;s value. Verify before then and nothing is
                held.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href="/profile#payouts">Verify my identity</Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col-reverse items-stretch gap-2 sm:flex-row sm:justify-end">
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/deals">All deals</Link>
          </Button>
          <Button asChild className="w-full sm:w-auto">
            <Link href={`/deals/${created.dealId}`}>Open deal room</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const titleError = messageFor('title');
  const roleError = messageFor('role');
  const handoverError = messageFor('handover');
  const locationError = messageFor('meetingLocation');
  const offerError = messageFor('offerKinds');
  const cashError = messageFor('cash');
  const deliveryError = messageFor('deliveryCost');
  const photosError = messageFor('photos');
  const generalError = messageFor('general');

  return (
    <Card>
      <form onSubmit={handleSubmit} noValidate aria-busy={isPending}>
        <fieldset disabled={isPending} className="contents">
          {collateralRequired ? (
            <div className="mx-6 mt-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="flex items-center gap-2 font-medium">
                <ShieldAlert className="size-4 shrink-0" aria-hidden />
                Backing this deal with collateral
              </p>
              <p className="mt-1">
                You&apos;re unverified, so both sides will be held for about{' '}
                {formatAud(collateralStakeCents)} once you both confirm — released
                when you both mark the deal complete.{' '}
                <Link
                  href="/profile#payouts"
                  className="font-medium underline underline-offset-4"
                >
                  Verify instead
                </Link>{' '}
                and your card stays out of it.
              </p>
            </div>
          ) : null}
          <CardContent className="divide-y pt-6">
            <FormSection
              number={1}
              title="Deal basics"
              description="Name the deal and choose your side."
            >
              <div className="space-y-2">
                <Label htmlFor="deal-title">
                  Deal title
                  <Required />
                </Label>
                <Input
                  id="deal-title"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    clearError('title');
                  }}
                  placeholder="Charizard for Blastoise + $50"
                  maxLength={DEAL_TITLE_MAX}
                  required
                  aria-invalid={titleError ? true : undefined}
                  aria-describedby={titleError ? 'deal-title-error' : undefined}
                />
                <FieldError id="deal-title-error" message={titleError} />
              </div>

              <fieldset
                className="space-y-2"
                aria-invalid={roleError ? true : undefined}
                aria-describedby={roleError ? 'deal-role-error' : undefined}
              >
                <legend className="text-sm font-medium">
                  Your role
                  <Required />
                </legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {ROLE_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const selected = role === option.value;
                    return (
                      <label
                        key={option.value}
                        htmlFor={`deal-role-${option.value}`}
                        className={cn(
                          'flex min-h-20 cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                          selected
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'hover:border-foreground/20 hover:bg-muted/50',
                          roleError && 'border-destructive',
                        )}
                      >
                        <input
                          id={`deal-role-${option.value}`}
                          type="radio"
                          name="deal-role"
                          value={option.value}
                          checked={selected}
                          onChange={() => chooseRole(option.value)}
                          className="size-4 shrink-0"
                          required
                        />
                        <span>
                          <span className="flex items-center gap-1.5 font-medium">
                            <Icon className="size-4 text-primary" aria-hidden />
                            {option.label}
                          </span>
                          <span className="mt-1 block text-xs leading-4 text-muted-foreground">
                            {option.hint}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <FieldError id="deal-role-error" message={roleError} />
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="deal-description">
                  Description{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="deal-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Items, condition, grading and anything else both sides should know"
                  maxLength={DEAL_TEXT_MAX}
                  rows={4}
                  aria-describedby="deal-description-hint"
                />
                <p id="deal-description-hint" className="text-xs text-muted-foreground">
                  Be specific about condition and flaws. This description may be
                  used if the deal needs arbitration.
                </p>
              </div>
            </FormSection>

            <FormSection
              number={2}
              title="Handover"
              description="Choose how the items will change hands."
            >
              <fieldset
                className="space-y-2"
                aria-invalid={handoverError ? true : undefined}
                aria-describedby={handoverError ? 'deal-handover-error' : undefined}
              >
                <legend className="sr-only">Handover method</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {HANDOVER_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const selected = handover === option.value;
                    return (
                      <label
                        key={option.value}
                        htmlFor={`deal-handover-${option.value}`}
                        className={cn(
                          'flex min-h-20 cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                          selected
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'hover:border-foreground/20 hover:bg-muted/50',
                          handoverError && 'border-destructive',
                        )}
                      >
                        <input
                          id={`deal-handover-${option.value}`}
                          type="radio"
                          name="deal-handover"
                          value={option.value}
                          checked={selected}
                          onChange={() => {
                            setHandover(option.value);
                            clearError('handover');
                          }}
                          className="size-4 shrink-0"
                          required
                        />
                        <span>
                          <span className="flex items-center gap-1.5 font-medium">
                            <Icon className="size-4 text-primary" aria-hidden />
                            {option.label}
                          </span>
                          <span className="mt-1 block text-xs leading-4 text-muted-foreground">
                            {option.hint}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <FieldError id="deal-handover-error" message={handoverError} />
              </fieldset>

              {handover === 'IN_PERSON' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="deal-meeting-location">
                      Meeting place
                      <Required />
                    </Label>
                    <Input
                      id="deal-meeting-location"
                      value={meetingLocation}
                      onChange={(event) => {
                        setMeetingLocation(event.target.value);
                        clearError('meetingLocation');
                      }}
                      placeholder="Melbourne Central, main entrance"
                      maxLength={DEAL_TEXT_MAX}
                      required
                      aria-invalid={locationError ? true : undefined}
                      aria-describedby={
                        locationError ? 'deal-location-error' : undefined
                      }
                    />
                    <FieldError id="deal-location-error" message={locationError} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="deal-meeting-at">
                      Date and time{' '}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="deal-meeting-at"
                      type="datetime-local"
                      value={meetingAt}
                      onChange={(event) => setMeetingAt(event.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </FormSection>

            <FormSection
              number={3}
              title="Your side of the deal"
              description="Add the amount, items and evidence you are putting forward."
            >
              {role === null ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Choose your role above to see what is required from you.
                </p>
              ) : null}

              {role === 'TRADER' ? (
                <fieldset
                  className="space-y-2"
                  aria-invalid={offerError ? true : undefined}
                  aria-describedby={offerError ? 'deal-offer-error' : undefined}
                >
                  <legend className="text-sm font-medium">
                    What are you putting up?
                    <Required />
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {OFFER_OPTIONS.map((option) => {
                      const selected = offerKinds.includes(option.value);
                      return (
                        <label
                          key={option.value}
                          htmlFor={`deal-offer-${option.value}`}
                          className={cn(
                            'flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                            selected
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'hover:border-foreground/20 hover:bg-muted/50',
                            offerError && 'border-destructive',
                          )}
                        >
                          <input
                            id={`deal-offer-${option.value}`}
                            type="checkbox"
                            name="deal-offer"
                            value={option.value}
                            checked={selected}
                            onChange={() => toggleOfferKind(option.value)}
                            className="mt-0.5 size-4"
                          />
                          <span>
                            <span className="font-medium">{option.label}</span>
                            <span className="mt-1 block text-xs leading-4 text-muted-foreground">
                              {option.hint}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <FieldError id="deal-offer-error" message={offerError} />
                </fieldset>
              ) : null}

              {role !== null && (cashRequired || handover === 'DELIVERY') ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {cashRequired ? (
                    <div className="space-y-2">
                      <Label htmlFor="deal-cash">
                        {cashLabel} (AUD)
                        <Required />
                      </Label>
                      <div className="relative">
                        <span
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                          aria-hidden
                        >
                          $
                        </span>
                        <Input
                          id="deal-cash"
                          type="number"
                          inputMode="decimal"
                          min="0.01"
                          step="0.01"
                          placeholder="0.00"
                          value={cash}
                          onChange={(event) => {
                            setCash(event.target.value);
                            clearError('cash');
                          }}
                          className="pl-7"
                          required
                          aria-invalid={cashError ? true : undefined}
                          aria-describedby={cashError ? 'deal-cash-error' : undefined}
                        />
                      </div>
                      <FieldError id="deal-cash-error" message={cashError} />
                      <p className="text-xs text-muted-foreground">
                        {role === 'TRADER'
                          ? 'Cash included on your side.'
                          : 'For the goods only. Delivery is separate.'}
                      </p>
                    </div>
                  ) : null}

                  {handover === 'DELIVERY' ? (
                    <div className="space-y-2">
                      <Label htmlFor="deal-delivery-cost">
                        Delivery cost (AUD)
                        <Required />
                      </Label>
                      <div className="relative">
                        <span
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                          aria-hidden
                        >
                          $
                        </span>
                        <Input
                          id="deal-delivery-cost"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={deliveryCost}
                          onChange={(event) => {
                            setDeliveryCost(event.target.value);
                            clearError('deliveryCost');
                          }}
                          className="pl-7"
                          required
                          aria-invalid={deliveryError ? true : undefined}
                          aria-describedby={
                            deliveryError
                              ? 'deal-delivery-error'
                              : 'deal-delivery-hint'
                          }
                        />
                      </div>
                      <FieldError
                        id="deal-delivery-error"
                        message={deliveryError}
                      />
                      {!deliveryError ? (
                        <p
                          id="deal-delivery-hint"
                          className="text-xs text-muted-foreground"
                        >
                          Added on top. Enter 0 for free delivery.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {showPhotos ? (
                <div className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <Label htmlFor="deal-photos">
                        Item photos
                        {photosRequired ? <Required /> : null}
                      </Label>
                      <p
                        id="deal-photos-hint"
                        className="mt-1 text-xs text-muted-foreground"
                      >
                        Clear front, back and flaw photos give both sides a fair
                        record.
                      </p>
                    </div>
                    <span
                      className="shrink-0 text-xs tabular-nums text-muted-foreground"
                      aria-live="polite"
                    >
                      {photos.length}/{DEAL_PHOTOS_MAX}
                    </span>
                  </div>

                  <label
                    htmlFor="deal-photos"
                    className={cn(
                      'flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 py-5 text-center transition-colors hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
                      photosError && 'border-destructive',
                    )}
                  >
                    <ImagePlus className="mb-2 size-5 text-muted-foreground" aria-hidden />
                    <span className="text-sm font-medium">Choose photos</span>
                    <span className="mt-1 text-xs text-muted-foreground">
                      JPG, PNG, WebP or GIF
                    </span>
                    <Input
                      id="deal-photos"
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handlePhotosSelected}
                      className="sr-only"
                      required={photosRequired && photos.length === 0}
                      aria-invalid={photosError ? true : undefined}
                      aria-describedby={
                        photosError ? 'deal-photos-error' : 'deal-photos-hint'
                      }
                    />
                  </label>
                  <FieldError id="deal-photos-error" message={photosError} />

                  {photos.length > 0 ? (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {photos.map((file, index) => (
                        <li
                          key={`${file.name}-${file.lastModified}-${index}`}
                          className="relative aspect-square overflow-hidden rounded-lg border bg-muted"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={URL.createObjectURL(file)}
                            alt={file.name}
                            className="h-full w-full object-cover"
                            onLoad={(event) =>
                              URL.revokeObjectURL(
                                (event.target as HTMLImageElement).src,
                              )
                            }
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            onClick={() => removePhoto(index)}
                            className="absolute right-1.5 top-1.5 size-10 rounded-full bg-background/90 shadow-sm"
                            aria-label={`Remove ${file.name}`}
                          >
                            <X aria-hidden />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </FormSection>

            {generalError ? (
              <p
                role="alert"
                className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {generalError}
              </p>
            ) : null}
          </CardContent>

          <CardFooter className="flex-col-reverse items-stretch gap-2 border-t bg-muted/20 px-6 pb-4 pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/deals')}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button type="submit" className="w-full sm:w-auto">
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Creating deal…' : 'Create deal & get link'}
            </Button>
          </CardFooter>
        </fieldset>
      </form>
    </Card>
  );
}
