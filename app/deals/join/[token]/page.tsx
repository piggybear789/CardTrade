// app/deals/join/[token]/page.tsx
//
// The share-link landing page. A private deal is created SOLO; this is where the
// OTHER party arrives, sees a minimal preview, and joins as the counterparty.
//
// The token in the URL is the capability — there is no token-based RLS policy, so
// `getDealByToken` validates it with the service-role client and returns only a
// preview (never the full deal row). Four shapes:
//   * invalid / closed link  → a friendly "not available" page (404 for unknown)
//   * signed out             → preview + "Sign in to join" (returns to this URL)
//   * my own link            → preview + a button into my deal room
//   * already joined by me   → straight to the deal room
//   * joinable               → preview + <JoinDealButton/>

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Handshake, Lock } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import {
  getDealByToken,
  type DealOfferKind,
  type DealRole,
} from '@/lib/actions/deals';
import { JoinDealButton } from '@/components/deals/JoinDealButton';
import { VerifiedBadge } from '@/components/listings/VerifiedBadge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { PageShell } from '@/components/layout/PageShell';
import { formatAud, itemImageUrl } from '@/lib/format';

/** How each tradable component reads to the joiner. */
const OFFER_LABELS: Record<DealOfferKind, string> = {
  CARDS: 'Cards',
  CASH: 'Cash',
  ITEMS: 'Other items',
};

/**
 * Frame the creator's side by the role they chose, so the joiner immediately
 * knows what is being asked of them. Falls back to a neutral label on older
 * deals created before roles existed.
 */
function roleLabel(role: DealRole | null, creatorName: string): string {
  switch (role) {
    case 'BUYER':
      return `${creatorName} wants to buy`;
    case 'SELLER':
      return `${creatorName} is selling`;
    case 'TRADER':
      return `${creatorName} wants to trade`;
    default:
      return 'The deal';
  }
}

// Reads the visitor's session and the live deal state behind the token.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Join a deal · Poke-xchange',
  description: 'Join a private 1:1 binding deal you were sent a link to.',
};

export default async function JoinDealPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await getDealByToken(token);

  if (!result.ok) {
    if (result.error === 'not-found') {
      notFound();
    }
    return (
      <PageShell width="form" centered>
        <Card>
          <CardHeader>
            <h1 className="text-xl font-semibold leading-none tracking-tight">
              This deal link isn&apos;t available
            </h1>
            <CardDescription>
              The deal was cancelled, completed, or is being disputed, so nobody
              else can join it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/deals">Go to my deals</Link>
            </Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const { preview } = result;

  // I already took this seat — the room is where I belong.
  if (preview.joinedByMe) {
    redirect(`/deals/${preview.dealId}`);
  }

  const creatorName = preview.creatorName?.trim() || 'A Poke-xchange member';

  return (
    <PageShell width="form" centered>
      <Card>
        <CardHeader>
          <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Handshake className="size-4" aria-hidden />
            Private deal
          </p>
          <h1 className="text-xl font-semibold leading-none tracking-tight">
            {preview.title}
          </h1>
          <CardDescription className="flex flex-wrap items-center gap-1.5">
            <span>Created by {creatorName}</span>
            {preview.creatorVerified ? <VerifiedBadge /> : null}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 text-sm">
          {/* The creator's side, in their own words. */}
          <PreviewField
            label={roleLabel(preview.creatorRole, creatorName)}
            value={preview.description ?? preview.creatorItemText}
          />

          {preview.creatorOfferKinds.length > 0 ? (
            <div className="rounded-md border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {creatorName} is putting up
              </p>
              <p className="mt-1">
                {preview.creatorOfferKinds
                  .map((kind) => OFFER_LABELS[kind])
                  .join(', ')}
              </p>
            </div>
          ) : null}

          {preview.creatorPhotoPaths.length > 0 ? (
            <div className="rounded-md border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Photos
              </p>
              <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {preview.creatorPhotoPaths.map((path) => {
                  const url = itemImageUrl(path);
                  if (!url) return null;
                  return (
                    <li
                      key={path}
                      className="aspect-square overflow-hidden rounded-md border bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Photo of what ${creatorName} is putting up`}
                        className="h-full w-full object-cover"
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Cash
              </p>
              {preview.cashAmountCents == null ? (
                <p className="mt-1 text-muted-foreground">No cash component.</p>
              ) : (
                <>
                  <p className="mt-1">
                    {formatAud(preview.cashAmountCents)} paid by{' '}
                    <strong>
                      {preview.cashPayerIsCreator
                        ? creatorName
                        : preview.iAmCreator
                          ? 'the other party'
                          : 'you'}
                    </strong>
                  </p>
                  {preview.deliveryCostCents ? (
                    <p className="mt-1 text-muted-foreground">
                      Plus {formatAud(preview.deliveryCostCents)} delivery —{' '}
                      {formatAud(
                        preview.cashAmountCents + preview.deliveryCostCents,
                      )}{' '}
                      all up.
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <div className="rounded-md border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Handover
              </p>
              {preview.handoverMethod === 'IN_PERSON' ? (
                <>
                  <p className="mt-1">Face to face — {preview.meetingLocation}</p>
                  <p className="mt-1 text-muted-foreground">
                    {preview.meetingAt
                      ? new Date(preview.meetingAt).toLocaleString('en-AU', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : 'No time set yet.'}
                  </p>
                </>
              ) : preview.handoverMethod === 'DELIVERY' ? (
                <p className="mt-1">
                  Delivery —{' '}
                  {preview.deliveryCostCents
                    ? `${formatAud(preview.deliveryCostCents)} postage`
                    : 'free delivery'}
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground">Not agreed yet.</p>
              )}
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-md border border-dashed p-3 text-muted-foreground">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Joining doesn&apos;t commit you. You agree the handover together
              first, and the deal only becomes binding once you both confirm. If
              either of you isn&apos;t identity verified by then, both sides are
              held for the deal&apos;s value until you both mark it complete —
              verified members post nothing.
            </span>
          </p>
        </CardContent>

        <CardFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
          {preview.iAmCreator ? (
            <>
              <p className="text-sm text-muted-foreground sm:mr-auto">
                This is your own deal link — send it to the other party.
              </p>
              <Button asChild>
                <Link href={`/deals/${preview.dealId}`}>Open deal room</Link>
              </Button>
            </>
          ) : preview.alreadyJoined ? (
            <>
              <p className="text-sm text-muted-foreground sm:mr-auto">
                Someone else has already joined this deal.
              </p>
              <Button asChild variant="outline">
                <Link href="/deals">Go to my deals</Link>
              </Button>
            </>
          ) : (
            <JoinPrompt token={token} signedIn={user !== null} />
          )}
        </CardFooter>
      </Card>
    </PageShell>
  );
}

/** Either the sign-in bounce (returning here) or the join action. */
function JoinPrompt({ token, signedIn }: { token: string; signedIn: boolean }) {
  if (!signedIn) {
    return (
      <>
        <p className="text-sm text-muted-foreground sm:mr-auto">
          Sign in to join this deal — we&apos;ll bring you straight back.
        </p>
        <Button asChild>
          {/*
            `redirect` matches the other /deals routes; `redirectTo` is the param
            AuthForm actually reads to bounce back here after sign-in.
          */}
          <Link
            href={`/sign-in?redirectTo=/deals/join/${token}`}
          >
            Sign in to join
          </Link>
        </Button>
      </>
    );
  }
  return <JoinDealButton token={token} />;
}

/** A labelled read-only preview field with an empty fallback. */
function PreviewField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap">
        {value?.trim() ? (
          value
        ) : (
          <span className="text-muted-foreground">Not set yet</span>
        )}
      </p>
    </div>
  );
}
