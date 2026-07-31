'use client';

// components/deals/NewDealForm.tsx
//
// Creates a private deal as a short, role-driven flow: name the deal, pick your
// side, pick the handover. Everything that is detail rather than decision — the
// meeting place, the delivery cost, the photos and the write-up — folds into its
// own dialog behind a summary row, the same shape as the trade offer card, so the
// form's height never depends on which path you took.
//
// Conditional requirements are enforced both here for immediate feedback and by
// createDeal at the server boundary. Money crosses that boundary as integer AUD
// cents.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Loader2,
  MapPin,
  Repeat,
  ShieldAlert,
  ShoppingCart,
  Tag,
  Truck,
} from 'lucide-react';

import { ShareDealLink } from '@/components/deals/ShareDealLink';
import {
  DealGoodsDialog,
  type DealGoods,
} from '@/components/deals/DealGoodsDialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ChoiceTile } from '@/components/ui/choice-tile';
import { DialogRow } from '@/components/ui/dialog-row';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createDeal,
  type CreateDealResult,
  type DealOfferKind,
  type DealRole,
  type HandoverMethod,
} from '@/lib/actions/deals';
import {
  DEAL_CASH_MAX,
  DEAL_DEFAULT_COLLATERAL_CENTS,
  DEAL_PHOTOS_MAX,
  DEAL_TITLE_MAX,
} from '@/lib/marketplace-constants';
import { formatAud } from '@/lib/format';
import { uploadItemImages } from '@/lib/storage/uploadItemImages';
import { cn } from '@/lib/utils';

/** Form fields that can own an inline validation message. */
type ErrorField =
  | 'title'
  | 'role'
  | 'offerKinds'
  | 'cash'
  | 'handover'
  | 'photos'
  | 'description'
  | 'general';

type FormError = { field: ErrorField; message: string };

/**
 * Fields that live inside a dialog rather than on the card. A failure on one of
 * these has to reopen its window, or the message would point at nothing.
 */
const DIALOG_FIELDS: Partial<Record<ErrorField, 'goods'>> = {
  offerKinds: 'goods',
  photos: 'goods',
  description: 'goods',
};

const ERROR_TARGETS: Record<ErrorField, string> = {
  title: 'deal-title',
  role: 'deal-role-BUYER',
  offerKinds: 'deal-offer-CARDS',
  cash: 'deal-cash',
  handover: 'deal-handover-IN_PERSON',
  photos: 'deal-photos',
  description: 'deal-description',
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
  'item-details-required': {
    field: 'description',
    message: 'Describe the item or items you are putting up.',
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

/** The three sides a creator can be on. */
const ROLE_OPTIONS: {
  value: DealRole;
  label: string;
  hint: string;
  icon: typeof ShoppingCart;
}[] = [
  { value: 'BUYER', label: 'Buying', hint: 'I pay via Pinch', icon: ShoppingCart },
  { value: 'SELLER', label: 'Selling', hint: 'I get paid via Pinch', icon: Tag },
  { value: 'TRADER', label: 'Trading', hint: 'I put goods up', icon: Repeat },
];

/** How the goods change hands — details are agreed later in the deal room. */
const HANDOVER_OPTIONS: {
  value: HandoverMethod;
  label: string;
  hint: string;
  icon: typeof MapPin;
}[] = [
  {
    value: 'IN_PERSON',
    label: 'Face to face',
    hint: 'Goods & inspection',
    icon: MapPin,
  },
  {
    value: 'DELIVERY',
    label: 'Delivery',
    hint: 'Ship the goods',
    icon: Truck,
  },
];

type CreatedDeal = { dealId: string; shareToken: string; title: string };

export interface NewDealFormProps {
  /**
   * True when the creator is not identity verified, so collateral will be held
   * on BOTH sides once the deal is confirmed. When false (verified creator), the
   * form offers optional DittoEscrow opt-in. Presentation only — the amount is
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
  const [offerKinds, setOfferKinds] = useState<DealOfferKind[]>([]);
  const [cash, setCash] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [collateralOptIn, setCollateralOptIn] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [created, setCreated] = useState<CreatedDeal | null>(null);
  const [isPending, startTransition] = useTransition();
  /** Photos plus the write-up — edited away from the card. */
  const [goodsDialogOpen, setGoodsDialogOpen] = useState(false);

  const tradesCash = role === 'TRADER' && offerKinds.includes('CASH');
  const tradesGoods =
    role === 'TRADER' &&
    (offerKinds.includes('CARDS') || offerKinds.includes('ITEMS'));
  const cashRequired = role === 'BUYER' || role === 'SELLER' || tradesCash;
  /**
   * A trader's cash is part of what they are putting up, so it is edited in the
   * goods dialog beside the photos. A buyer's or seller's amount is the deal's
   * price, which stays on the card.
   */
  const cashInGoodsDialog = tradesCash;
  const showPhotos = role === 'SELLER' || tradesGoods;
  const photosRequired = showPhotos;
  /**
   * Whether this side has anything of its own to describe. A buyer is putting up
   * cash, so there is nothing for them to photograph and no goods row at all —
   * the item is the other side's to describe.
   */
  const putsGoodsUp = role === 'SELLER' || role === 'TRADER';

  const cashLabel =
    role === 'BUYER' ? 'Cash you pay (via Pinch)' : 'Cash you receive (via Pinch)';

  // What each side is held for while the creator stays unverified: the deal's own
  // cash value, or the flat default for a pure swap. The server resolves the real
  // figure at confirmation time — this is the live estimate as the form is filled.
  const enteredCash = cashRequired ? dollarsToCents(cash) : null;
  const collateralStakeCents =
    enteredCash && enteredCash > 0 ? enteredCash : DEAL_DEFAULT_COLLATERAL_CENTS;

  // Seeded from committed state so the dialog re-seed does not wipe typing.
  const goods = useMemo<DealGoods>(
    () => ({ description, photos, cashDollars: cash, offerKinds }),
    [description, photos, cash, offerKinds],
  );

  /** The goods row names the side it is describing, which is always your own. */
  const goodsLabel =
    role === 'SELLER' ? 'What you are selling' : 'What you are putting up';

  const goodsSummary = (() => {
    const parts: string[] = [];
    if (photos.length > 0) {
      parts.push(`${photos.length} photo${photos.length === 1 ? '' : 's'}`);
    }
    if (cashInGoodsDialog && enteredCash && enteredCash > 0) {
      parts.push(`${formatAud(enteredCash)} cash`);
    }
    if (description.trim() !== '') parts.push('described');
    if (parts.length > 0) return parts.join(' · ');
    if (role === 'TRADER') return 'Cards, cash or items';
    return 'Photos and description';
  })();

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
    // A buyer has no goods row, so nothing typed in one should still be sent.
    if (nextRole === 'BUYER') setDescription('');
    if (nextRole === 'BUYER') setPhotos([]);
  }

  /**
   * A validation failure the user cannot see, because the field lives in a
   * dialog: record it and open the window holding it.
   */
  function failInDialog(field: ErrorField, message: string, dialog: 'goods') {
    setError({ field, message });
    if (dialog === 'goods') setGoodsDialogOpen(true);
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
    if (role === 'TRADER' && offerKinds.length === 0) {
      failInDialog(
        'offerKinds',
        'Choose at least one thing you are putting up.',
        'goods',
      );
      return;
    }
    // Checks run in the order the card reads, so the first thing missing is the
    // first thing you see.
    if (photosRequired && photos.length === 0) {
      failInDialog(
        'photos',
        role === 'SELLER'
          ? 'Add at least one photo of the item you are selling.'
          : 'Add at least one photo of the items you are putting up.',
        'goods',
      );
      return;
    }
    if (photosRequired && description.trim() === '') {
      failInDialog(
        'description',
        role === 'SELLER'
          ? 'Describe the item you are selling.'
          : 'Describe the item or items you are putting up.',
        'goods',
      );
      return;
    }

    let cashAmountCents: number | undefined;
    if (cashRequired) {
      // A trader's amount lives in the goods dialog, so a failure has to reopen
      // it rather than point at a field that is not on the card.
      const failCash = (message: string) => {
        if (cashInGoodsDialog) failInDialog('cash', message, 'goods');
        else fail('cash', message, 'deal-cash');
      };
      cashAmountCents = dollarsToCents(cash) ?? undefined;
      if (cashAmountCents === undefined || cashAmountCents <= 0) {
        failCash('Enter an amount greater than zero.');
        return;
      }
      if (cashAmountCents > DEAL_CASH_MAX) {
        failCash('That amount is too large.');
        return;
      }
    }

    if (handover === null) {
      fail('handover', 'Choose face to face or delivery.', 'deal-handover-IN_PERSON');
      return;
    }

    startTransition(async () => {
      try {
        // Photos go browser → Storage first, and only their object paths travel
        // in the action call: bytes in a Server Action body hit Next's size cap,
        // and these photos are the arbitration evidence base, so the original
        // file and its EXIF are worth preserving intact.
        let photoPaths: string[] = [];
        if (showPhotos && photos.length > 0) {
          const uploaded = await uploadItemImages(photos);
          if (!uploaded.ok) {
            failInDialog('photos', uploaded.message, 'goods');
            return;
          }
          photoPaths = uploaded.paths;
        }

        const result = await createDeal({
          title: dealTitle,
          role,
          description: description.trim() || undefined,
          handoverMethod: handover,
          cashAmountCents,
          offerKinds: role === 'TRADER' ? offerKinds : undefined,
          photos: showPhotos ? photoPaths : undefined,
          // Unverified creators already force collateral; opt-in only matters when
          // the creator is verified (and both parties end up verified).
          collateralOptIn: collateralRequired ? undefined : collateralOptIn,
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
        const dialog =
          nextError.field === 'cash' && cashInGoodsDialog
            ? 'goods'
            : DIALOG_FIELDS[nextError.field];
        if (dialog) {
          // The field is in a window the user closed, so reopen it on the error.
          failInDialog(nextError.field, nextError.message, dialog);
          return;
        }
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
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-xl">
            <CheckCircle2 className="size-5 text-trust" aria-hidden />
            Deal created
          </CardTitle>
          <CardDescription>
            Send this link to the person you&apos;re dealing with. The first person
            to join takes the other seat.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ShareDealLink shareToken={created.shareToken} title={created.title} />
          {collateralRequired ? (
            <p className="cardtrade-warning flex items-start gap-2 rounded-lg border p-3 text-xs">
              <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden />
              <span>
                You skipped verification, so each side is held for the deal&apos;s
                value once you both confirm.{' '}
                <Link
                  href="/profile#payouts"
                  className="font-medium underline underline-offset-4"
                >
                  Use DittoShield instead
                </Link>{' '}
                and nothing is held.
              </span>
            </p>
          ) : collateralOptIn ? (
            <p className="flex items-start gap-2 rounded-lg border p-3 text-xs text-muted-foreground">
              <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden />
              <span>
                DittoEscrow is on — each side posts a Pinch hold once you both
                confirm, even if you are both verified.
              </span>
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col-reverse items-stretch gap-2 border-t bg-muted/20 px-6 pb-4 pt-4 sm:flex-row sm:justify-end">
          <Button asChild variant="ghost" className="w-full sm:w-auto">
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
  const offerError = messageFor('offerKinds');
  const cashError = messageFor('cash');
  const photosError = messageFor('photos');
  const descriptionError = messageFor('description');
  const generalError = messageFor('general');

  // Deliberately shaped like the trade offer card (components/trade/
  // TradeOfferForm.tsx): one narrow centred card, bordered choice tiles in a grid,
  // and conditional fields that appear only once the role or handover asks.
  return (
    <Card className="mx-auto w-full max-w-lg">
      <form onSubmit={handleSubmit} noValidate aria-busy={isPending}>
        <fieldset disabled={isPending} className="contents">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Start a private deal</CardTitle>
            <CardDescription>
              Nothing is binding until you both confirm.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {collateralRequired ? (
              <p className="cardtrade-warning flex items-start gap-2 rounded-lg border p-3 text-xs">
                <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden />
                <span>
                  You&apos;re unverified, so each side is held for about{' '}
                  {formatAud(collateralStakeCents)} once you both confirm.{' '}
                  <Link
                    href="/profile#payouts"
                    className="font-medium underline underline-offset-4"
                  >
                    Use DittoShield instead
                  </Link>{' '}
                  and nothing is held.
                </span>
              </p>
            ) : (
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={collateralOptIn}
                  onChange={(event) => setCollateralOptIn(event.target.checked)}
                  className="mt-0.5 h-4 w-4"
                  disabled={isPending}
                />
                <span>
                  <span className="font-medium">Require DittoEscrow collateral</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Optional. Both sides post about {formatAud(collateralStakeCents)}{' '}
                    via Pinch on confirm, even if you are both DittoShield verified.
                  </span>
                </span>
              </label>
            )}

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
                autoComplete="off"
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
                Your side
                <Required />
              </legend>
              <div className="grid grid-cols-1 gap-1.5 min-[400px]:grid-cols-3">
                {ROLE_OPTIONS.map((option) => (
                  <ChoiceTile
                    key={option.value}
                    id={`deal-role-${option.value}`}
                    name="deal-role"
                    type="radio"
                    icon={option.icon}
                    label={option.label}
                    hint={option.hint}
                    checked={role === option.value}
                    invalid={Boolean(roleError)}
                    onChange={() => chooseRole(option.value)}
                  />
                ))}
              </div>
              <FieldError id="deal-role-error" message={roleError} />
            </fieldset>

            {/* Only the side putting goods up has anything to describe: a buyer is
                putting up cash, and the other side's item is theirs to photograph.
                The row sits straight after the side you are on, so "what am I
                describing here" is answered by the tiles above it. */}
            {putsGoodsUp ? (
              <div className="space-y-2">
                <DialogRow
                  label={goodsLabel}
                  hint={goodsSummary}
                  filled={
                    photos.length > 0 ||
                    offerKinds.length > 0 ||
                    description.trim() !== ''
                  }
                  required
                  invalid={Boolean(
                    photosError ||
                      descriptionError ||
                      offerError ||
                      (cashInGoodsDialog && cashError),
                  )}
                  onClick={() => setGoodsDialogOpen(true)}
                />
                <FieldError
                  id="deal-photos-error"
                  message={
                    photosError ??
                    descriptionError ??
                    offerError ??
                    (cashInGoodsDialog ? cashError : undefined)
                  }
                />
              </div>
            ) : null}

            {cashRequired && !cashInGoodsDialog ? (
              <div className="space-y-2">
                <Label htmlFor="deal-cash">
                  {cashLabel}
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
                <p className="text-xs text-muted-foreground">
                  Settles through Pinch when you both confirm — not handed over at
                  the meetup.
                </p>
                <FieldError id="deal-cash-error" message={cashError} />
              </div>
            ) : null}

            <fieldset
              className="space-y-2"
              aria-invalid={handoverError ? true : undefined}
              aria-describedby={handoverError ? 'deal-handover-error' : undefined}
            >
              <legend className="text-sm font-medium">
                Handover
                <Required />
              </legend>
              <div className="grid grid-cols-2 gap-1.5">
                {HANDOVER_OPTIONS.map((option) => (
                  <ChoiceTile
                    key={option.value}
                    id={`deal-handover-${option.value}`}
                    name="deal-handover"
                    type="radio"
                    icon={option.icon}
                    label={option.label}
                    hint={option.hint}
                    checked={handover === option.value}
                    invalid={Boolean(handoverError)}
                    onChange={() => {
                      setHandover(option.value);
                      clearError('handover');
                    }}
                  />
                ))}
              </div>
              <FieldError id="deal-handover-error" message={handoverError} />
              <p className="text-xs text-muted-foreground">
                Meeting place, postage and tracking are agreed in the deal room.
              </p>
            </fieldset>

            {generalError ? (
              <p id="deal-form-error" role="alert" className="text-sm text-destructive">
                {generalError}
              </p>
            ) : null}
          </CardContent>

          <CardFooter className="flex-col-reverse items-stretch gap-2 border-t bg-muted/20 px-6 pb-4 pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
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

      <DealGoodsDialog
        open={goodsDialogOpen}
        onOpenChange={setGoodsDialogOpen}
        title={goodsLabel}
        value={goods}
        role={role}
        error={photosError}
        descriptionError={descriptionError}
        cashError={cashInGoodsDialog ? cashError : undefined}
        offerError={offerError}
        onSave={(next) => {
          setDescription(next.description);
          setPhotos(next.photos);
          if (role === 'TRADER') {
            setOfferKinds(next.offerKinds);
            setCash(next.cashDollars);
          }
          clearError('photos');
          clearError('description');
          clearError('offerKinds');
          clearError('cash');
        }}
      />
    </Card>
  );
}
