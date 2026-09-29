'use client';

// components/deals/DealJoinForm.tsx
//
// Claim a private-deal invite. Joining needs no Stripe Identity and no payment card:
// it opens a deal room where the two of them agree terms. The notice on the invite
// says plainly where those checks sit instead — the seller must verify before the
// buyer can pay, and BOTH traders must verify before a swap can start.
//
// A swap (and a legacy host-BUYER sale) still asks for the joiner's unlisted card.
// A brand-new account answers the composer's two questions here too. The host gets
// DealInviteShare.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
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
import { InviteeVerificationNotice } from '@/components/deals/DealVerificationNotice';
import { DEAL_INVITE_ERROR_COPY } from '@/components/deals/inviteErrors';
import { QuickProfileFields } from '@/components/deals/QuickProfileFields';
import { pathsFromUnlistedDraft } from '@/components/deals/uploadDealItem';
import { dollarsToCents, joinerPutsUpACard } from '@/domain/deals/dealInvite';
import { deriveItemTitle } from '@/domain/validation';
import { claimDealInvite, type DealInvitePreview } from '@/lib/actions/dealInvites';
import { completeQuickOnboarding } from '@/lib/actions/quickOnboarding';
import type { SelectableRegion } from '@/lib/actions/regionOptions';
import { dealInvitePath } from '@/lib/deals/paths';
import { navigateWithType } from '@/lib/motion/navigate';

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

function headline(preview: DealInvitePreview): string {
  const host = preview.hostName ?? 'A member';
  if (preview.kind === 'TRADE') return `${host} wants to trade`;
  return preview.hostRole === 'BUYER' ? `${host} wants to buy` : `${host} is selling`;
}

function ClosedInvite({ preview }: { preview: DealInvitePreview }) {
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

export function DealInviteSummary({ preview }: { preview: DealInvitePreview }) {
  return (
    <div className="grid gap-group">
      <DealInviteFacts preview={preview} audience="guest" />
      {preview.kind ? (
        <InviteeVerificationNotice
          kind={preview.kind}
          readiness={preview.hostReadiness}
          hostName={preview.hostName ?? 'They'}
        />
      ) : null}
    </div>
  );
}

export interface DealJoinViewer {
  /** A new account that has not yet given a display name and trading region. */
  needsOnboarding: boolean;
  displayName: string | null;
}

export function DealJoinForm({
  preview,
  viewer,
  regions,
  suggestedRegion,
}: {
  preview: DealInvitePreview;
  viewer: DealJoinViewer;
  regions: SelectableRegion[];
  suggestedRegion: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<UnlistedItemDraft | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [valueDollars, setValueDollars] = useState('');
  const [displayName, setDisplayName] = useState(viewer.displayName ?? '');
  const [regionCode, setRegionCode] = useState(suggestedRegion ?? regions[0]?.code ?? '');

  if (preview.status !== 'open') return <ClosedInvite preview={preview} />;
  if (preview.isHost) return <DealInviteShare preview={preview} />;

  const needsCard = joinerPutsUpACard(preview.kind ?? 'TRADE', preview.hostRole);
  const cardLabel = draft ? deriveItemTitle(draft.description) : '';

  // A brand-new account has no region yet, which `claimBlock` reports as `no-region`.
  // The two questions below answer exactly that, so it is not a reason to stop here.
  // Anything else it reports — the host is in another region — is.
  const block =
    preview.viewerBlock && !(viewer.needsOnboarding && preview.viewerBlock.reason === 'no-region')
      ? preview.viewerBlock
      : null;

  // BEFORE the form, not after submitting it: `claimDealInvite` refuses for exactly
  // these reasons, and saying so here means nobody describes a card and uploads photos
  // for a claim that cannot succeed. Same `message`, so the two never disagree.
  if (block) {
    return (
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader>
          <CardTitle>You cannot join this deal</CardTitle>
          <CardDescription>{block.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <DealInviteSummary preview={preview} />
        </CardContent>
      </Card>
    );
  }

  const missing = viewer.needsOnboarding
    ? displayName.trim() === ''
      ? 'Add the name other members see.'
      : !regionCode
        ? 'Choose where you trade.'
        : null
    : null;
  const cardMissing = needsCard
    ? !draft
      ? 'Describe the card you are offering.'
      : preview.kind === 'TRADE' && dollarsToCents(valueDollars) == null
        ? 'Say what your card is worth.'
        : null
    : null;
  const blocker = missing ?? cardMissing;

  function join() {
    setError(null);
    startTransition(async () => {
      if (viewer.needsOnboarding) {
        const done = await completeQuickOnboarding({ displayName: displayName.trim(), regionCode });
        if (!done.ok) {
          setError(done.message);
          return;
        }
      }

      let item = undefined as
        | { description: string; category: string; condition: string; fmvCents: number; images: string[] }
        | undefined;
      if (needsCard) {
        if (!draft || !isUnlistedDraftComplete(draft)) {
          setError('Describe the card you are offering.');
          return;
        }
        const fmvCents =
          preview.kind === 'CASH_SALE'
            ? preview.priceCents ?? dollarsToCents(valueDollars)
            : dollarsToCents(valueDollars);
        if (fmvCents == null || fmvCents < 1) {
          setError(
            preview.kind === 'CASH_SALE' ? 'This sale is missing a price.' : 'Say what your card is worth.',
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

      const result = await claimDealInvite({ token: preview.token, item });
      if (!result.ok) {
        const message = result.message || DEAL_INVITE_ERROR_COPY[result.error];
        setError(message);
        toast.error(message);
        return;
      }
      navigateWithType(router, result.data.path, 'nav-forward');
    });
  }

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader>
        <CardTitle>Join this deal</CardTitle>
        <CardDescription>
          {preview.kind === 'TRADE'
            ? "Describe the card you're offering."
            : preview.hostRole === 'SELLER'
              ? 'This reserves the card for you.'
              : 'Describe the card they are buying.'}
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
              <div className="space-y-snug">
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

        {viewer.needsOnboarding ? (
          <QuickProfileFields
            idPrefix="join"
            displayName={displayName}
            onDisplayName={setDisplayName}
            regionCode={regionCode}
            onRegion={setRegionCode}
            regions={regions}
            quoteCurrency={preview.currency}
          />
        ) : null}

        <FieldError message={error ?? undefined} />
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-snug sm:flex-row sm:items-center sm:justify-between">
        <p className="text-meta text-muted-foreground" id="join-blocker">
          {blocker && !isPending ? blocker : 'Nothing is paid or held when you join.'}
        </p>
        <Button
          type="button"
          onClick={join}
          disabled={isPending || blocker != null}
          aria-busy={isPending}
          aria-describedby="join-blocker"
        >
          {isPending ? <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden /> : null}
          {isPending ? 'Opening…' : 'Join this deal'}
        </Button>
      </CardFooter>

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

export function PublicDealInvitePreview({ preview }: { preview: DealInvitePreview }) {
  if (preview.status !== 'open') return <ClosedInvite preview={preview} />;

  const path = dealInvitePath(preview.token);
  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader>
        <CardTitle>{headline(preview)}</CardTitle>
        <CardDescription>
          Nothing is paid or held when you join.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DealInviteSummary preview={preview} />
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-snug">
        <GoogleSignInButton mode="sign-up" redirectTo={path}>
          Join with Google
        </GoogleSignInButton>
        <Button asChild variant="outline" className="min-h-11 w-full">
          <Link href={`/sign-up?redirectTo=${encodeURIComponent(path)}`}>Join with email</Link>
        </Button>
        <p className="text-meta text-muted-foreground">
          Already have an account?{' '}
          <Link
            href={`/sign-in?redirectTo=${encodeURIComponent(path)}`}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign in to join
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
