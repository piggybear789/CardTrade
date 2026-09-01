'use client';

// components/deals/DealJoinForm.tsx
//
// Claim a private-deal invite. Cash (host selling) needs seller-identity
// confirmation and a saved card, same as Buy now. Cash (host buying) and trade
// need an unlisted card from the joiner. Hosts get DealInviteShare.

import { useEffect, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { CreditCardIcon, LoaderCircleIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { FieldError } from '@/components/motion/FieldError';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DialogRow } from '@/components/ui/dialog-row';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import {
  UnlistedItemDialog,
  isUnlistedDraftComplete,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemDialog';
import { DealInviteFacts } from '@/components/deals/DealInviteFacts';
import { DealInviteShare } from '@/components/deals/DealInviteShare';
import { DEAL_INVITE_ERROR_COPY } from '@/components/deals/inviteErrors';
import { pathsFromUnlistedDraft } from '@/components/deals/uploadDealItem';
import { dollarsToCents, joinerPutsUpACard } from '@/domain/deals/dealInvite';
import { deriveItemTitle } from '@/domain/validation';
import { claimDealInvite, type DealInvitePreview } from '@/lib/actions/dealInvites';
import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { navigateWithType } from '@/lib/motion/navigate';
import { PaymentFormSkeleton } from '@/components/payments/PaymentFormSkeleton';

const AddPaymentMethodForm = dynamic(
  () => import('@/components/payments/AddPaymentMethodForm').then((m) => m.AddPaymentMethodForm),
  {
    ssr: false,
    loading: () => <PaymentFormSkeleton />,
  },
);

function statusCopy(status: DealInvitePreview['status']): {
  title: string;
  description: string;
} {
  switch (status) {
    case 'expired':
      return { title: 'This invite expired', description: 'Ask them to send a new deal link.' };
    case 'revoked':
      return { title: 'This invite was cancelled', description: 'The other person withdrew it.' };
    case 'claimed':
      return {
        title: 'Someone already joined',
        description: 'This link has been used.',
      };
    case 'not-found':
      return { title: 'Invite not found', description: 'Check the link and try again.' };
    default:
      return { title: 'Private deal', description: '' };
  }
}

export function DealInviteSummary({ preview }: { preview: DealInvitePreview }) {
  return (
    <div className="grid gap-group">
      {preview.hostName ? (
        <p className="text-body text-muted-foreground">From {preview.hostName}</p>
      ) : null}
      <DealInviteFacts preview={preview} audience="guest" />
    </div>
  );
}

export function DealJoinForm({ preview }: { preview: DealInvitePreview }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<UnlistedItemDraft | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [valueDollars, setValueDollars] = useState('');
  const [paymentLabel, setPaymentLabel] = useState<string | null>(null);
  const [hasPaymentMethod, setHasPaymentMethod] = useState<boolean | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const needsCard = joinerPutsUpACard(preview.kind ?? 'TRADE', preview.hostRole);
  const needsCheckout =
    preview.kind === 'CASH_SALE' && preview.hostRole === 'SELLER' && !preview.isHost;
  const cardLabel = draft ? deriveItemTitle(draft.description) : '';

  useEffect(() => {
    if (!needsCheckout) return;
    let cancelled = false;
    setLoadingStatus(true);
    getPaymentMethodStatus()
      .then((result) => {
        if (cancelled) return;
        setLoadingStatus(false);
        if (result.ok) {
          setHasPaymentMethod(result.data.hasPaymentMethod);
          setPaymentLabel(result.data.label);
        } else {
          setHasPaymentMethod(false);
          setPaymentLabel(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLoadingStatus(false);
        setHasPaymentMethod(false);
        setPaymentLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [needsCheckout]);

  if (preview.status !== 'open') {
    const copy = statusCopy(preview.status);
    return (
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (preview.isHost) {
    return <DealInviteShare preview={preview} />;
  }

  function join() {
    setError(null);
    startTransition(async () => {
      let item = undefined as
        | { description: string; category: string; condition: string; fmvCents: number; images: string[] }
        | undefined;
      if (needsCard) {
        if (!draft || !isUnlistedDraftComplete(draft)) {
          setError('Describe the card you are putting up.');
          return;
        }
        const fmvCents =
          preview.kind === 'CASH_SALE'
            ? preview.priceCents ?? dollarsToCents(valueDollars)
            : dollarsToCents(valueDollars);
        if (fmvCents == null || fmvCents < 1) {
          setError(
            preview.kind === 'CASH_SALE'
              ? 'This sale is missing a price.'
              : 'Say what your card is worth.',
          );
          return;
        }
        const uploaded = await pathsFromUnlistedDraft(draft, fmvCents);
        if (!uploaded.ok) {
          setError(uploaded.message);
          return;
        }
        item = uploaded.item;
      }

      const result = await claimDealInvite({
        token: preview.token,
        item,
        buyerConfirmedSellerIdentity: needsCheckout ? true : undefined,
      });
      if (!result.ok) {
        if (result.error === 'no-payment-method') {
          setHasPaymentMethod(false);
          setPaymentLabel(null);
        }
        setError(result.message || DEAL_INVITE_ERROR_COPY[result.error]);
        toast.error(result.message || DEAL_INVITE_ERROR_COPY[result.error]);
        return;
      }
      navigateWithType(router, result.data.path, 'nav-forward');
    });
  }

  const showCardForm = needsCheckout && hasPaymentMethod === false;
  const showCheckout = !needsCheckout || hasPaymentMethod === true;
  const loading = needsCheckout && (loadingStatus || hasPaymentMethod === null);

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader>
        <CardTitle>Join this deal</CardTitle>
        <CardDescription>
          {preview.kind === 'TRADE'
            ? 'Describe your unlisted card. You both continue in a trade room.'
            : preview.hostRole === 'SELLER'
              ? 'This reserves the card and opens a sale. You do not pay yet.'
              : 'Describe the card they are buying. You both continue in a sale room.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-group">
        <DealInviteSummary preview={preview} />

        {needsCard ? (
          <>
            <DialogRow
              label="Your card"
              hint={cardLabel || 'Describe an unlisted card'}
              filled={Boolean(draft)}
              required
              onClick={() => setItemDialogOpen(true)}
            />
            {preview.kind === 'TRADE' ? (
              <div className="space-y-2">
                <Label htmlFor="join-value">What your card is worth</Label>
                <MoneyInput
                  id="join-value"
                  min="0.01"
                  value={valueDollars}
                  onChange={(event) => setValueDollars(event.target.value)}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-6" role="status">
            <HugeiconsIcon icon={LoaderCircleIcon} className="size-6 animate-spin text-muted-foreground" aria-hidden />
            <span className="sr-only">Loading payment details…</span>
          </div>
        ) : showCardForm ? (
          <div className="space-y-cozy">
            <div className="space-y-tight">
              <p className="text-body font-medium">Add a payment method</p>
              <p className="text-body text-muted-foreground">
                Stripe stores the card. Nothing is charged until you agree to terms.
              </p>
            </div>
            <AddPaymentMethodForm
              onAttached={() => {
                setLoadingStatus(true);
                getPaymentMethodStatus()
                  .then((result) => {
                    setLoadingStatus(false);
                    if (result.ok) {
                      setHasPaymentMethod(result.data.hasPaymentMethod);
                      setPaymentLabel(result.data.label);
                    }
                  })
                  .catch(() => setLoadingStatus(false));
              }}
            />
          </div>
        ) : needsCheckout && showCheckout ? (
          <>
            {preview.sellerIdentity ? (
              <div className="min-w-0 rounded-md border bg-muted p-cozy text-body">
                <p className="font-medium">Verified seller</p>
                {preview.sellerIdentity.tradingName ? (
                  <p className="break-words">{preview.sellerIdentity.tradingName}</p>
                ) : null}
                <p className="break-words text-muted-foreground">
                  {preview.sellerIdentity.legalEntityName}
                </p>
              </div>
            ) : (
              <p className="text-body text-destructive">
                The seller has not verified their identity yet.
              </p>
            )}
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <HugeiconsIcon icon={CreditCardIcon} className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium">
                  {paymentLabel ?? 'Card on file'}
                </p>
                <p className="text-body text-muted-foreground">Stripe method</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setHasPaymentMethod(false);
                  setPaymentLabel(null);
                }}
              >
                Change
              </Button>
            </div>
          </>
        ) : null}

        <FieldError message={error ?? undefined} />
      </CardContent>
      {/* While the card form is up, saving the card IS the action. A second,
          permanently disabled Join button below it just reads as broken. */}
      {showCardForm ? null : (
        <CardFooter>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={join}
            disabled={
              isPending || loading || (needsCheckout && !preview.sellerIdentity)
            }
            aria-busy={isPending}
          >
            {isPending ? <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden /> : null}
            {isPending ? 'Opening…' : 'Join this deal'}
          </Button>
        </CardFooter>
      )}

      <UnlistedItemDialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        initial={draft}
        onSave={setDraft}
        title="Your card"
        saveLabel={draft ? 'Save card' : 'Add card'}
      />
    </Card>
  );
}

export function PublicDealInvitePreview({
  preview,
  signInHref,
}: {
  preview: DealInvitePreview;
  signInHref: string;
}) {
  if (preview.status !== 'open') {
    const copy = statusCopy(preview.status);
    return (
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader>
        <CardTitle>Private deal</CardTitle>
        <CardDescription>Sign in to join this deal with {preview.hostName}.</CardDescription>
      </CardHeader>
      <CardContent>
        <DealInviteSummary preview={preview} />
      </CardContent>
      <CardFooter>
        <Button asChild>
          <Link href={signInHref}>Sign in to join</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
