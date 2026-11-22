'use client';

// components/admin/ExternalLinksPanel.tsx
//
// "Track record elsewhere" on the References tab (0170): find which eBay account belongs to
// a handle, so the seller's eBay feedback can show beside their references.
//
// THE FINDER SUGGESTS; A PERSON DECIDES. Search tests every spelling of the handle against
// eBay's own API and shows what eBay says about each account that exists, but a match on
// the name is only a lead: anyone can register `serialcollect_` on eBay, and a scammer can
// copy a known seller's handle to borrow their record. Nothing is saved until an admin has
// opened both profiles and written down what they checked. That sentence is kept as the
// record of why one seller's history appears on another handle's page.
//
// What eBay returns is shown as eBay's: feedback, where the account lists from, and a few
// listing titles, so a mismatch (an account listing from Canada under a handle that says
// Australia) is visible before anyone confirms.

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  decideEbayLink,
  findEbayLinkCandidates,
  removeEbayLink,
  type EbayLinkSearch,
} from '@/lib/actions/admin';
import {
  LINK_NOTE_MAX,
  formatFeedbackCount,
  formatFeedbackPercentage,
  nameRelationLabel,
  type CandidateState,
  type EbayLinkCandidate,
} from '@/domain/references/externalSeller';
import { CLAIM_PLATFORMS, platformLabel } from '@/domain/references/reference';

/** `CA` as "Canada". Falls back to the code where the runtime cannot name it. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const STATE_LABEL: Record<CandidateState, string | null> = {
  NEW: null,
  CONFIRMED_HERE: 'Confirmed for this handle',
  REJECTED_HERE: 'Marked not them',
  CONFIRMED_ELSEWHERE: 'Confirmed for another handle',
};

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-sm font-semibold text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
      <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  );
}

export function ExternalLinksPanel() {
  const router = useRouter();
  const [platform, setPlatform] = useState<string>('instagram');
  const [handle, setHandle] = useState('');
  const [extra, setExtra] = useState('');
  const [search, setSearch] = useState<EbayLinkSearch | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const runSearch = (query: { platform: string; handle: string; extra: string }) => {
    setSearchError(null);
    startTransition(async () => {
      const result = await findEbayLinkCandidates(query.platform, query.handle, query.extra || undefined);
      if (!result.ok) {
        setSearch(null);
        setSearchError(result.message ?? 'Something went wrong.');
        return;
      }
      setSearch(result.data);
    });
  };

  const decide = (candidate: EbayLinkCandidate, decision: 'CONFIRM' | 'REJECT') => {
    if (!search) return;
    const key = candidate.username.toLowerCase();
    setRowError((current) => ({ ...current, [key]: '' }));
    startTransition(async () => {
      const result = await decideEbayLink({
        platform: search.platform,
        handle: search.handle,
        username: candidate.username,
        decision,
        note: notes[key] ?? '',
      });
      if (!result.ok) {
        setRowError((current) => ({ ...current, [key]: result.message ?? 'Something went wrong.' }));
        return;
      }
      setNotes((current) => ({ ...current, [key]: '' }));
      const refreshed = await findEbayLinkCandidates(search.platform, search.handle, candidate.username);
      if (refreshed.ok) setSearch(refreshed.data);
      router.refresh();
    });
  };

  const remove = (linkId: string) => {
    if (!search) return;
    setSearchError(null);
    startTransition(async () => {
      const result = await removeEbayLink(linkId);
      if (!result.ok) {
        setSearchError(result.message ?? 'Something went wrong.');
        return;
      }
      const refreshed = await findEbayLinkCandidates(search.platform, search.handle);
      if (refreshed.ok) setSearch(refreshed.data);
      router.refresh();
    });
  };

  return (
    <Card className="mt-group">
      <CardHeader>
        <CardTitle className="text-lead">Track record on eBay</CardTitle>
      </CardHeader>
      <CardContent className="space-y-group">
        <p className="text-body text-muted-foreground">
          Show a seller&rsquo;s eBay feedback beside their references. Search finds eBay accounts
          spelled like the handle. A matching name is only a lead: open both profiles, check they
          are the same person, then confirm and say what you saw.
        </p>

        <form
          className="flex flex-col gap-snug sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch({ platform, handle, extra });
          }}
        >
          <div className="space-y-tight">
            <Label htmlFor="ebay-link-platform">Platform</Label>
            <select
              id="ebay-link-platform"
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-body sm:w-44"
            >
              {CLAIM_PLATFORMS.map((slug) => (
                <option key={slug} value={slug}>
                  {platformLabel(slug)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 space-y-tight">
            <Label htmlFor="ebay-link-handle">Handle</Label>
            <Input
              id="ebay-link-handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="@handle"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <div className="flex-1 space-y-tight">
            <Label htmlFor="ebay-link-extra">eBay username, if you found it (optional)</Label>
            <Input
              id="ebay-link-extra"
              value={extra}
              onChange={(event) => setExtra(event.target.value)}
              placeholder="their_ebay_name"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <Button type="submit" disabled={pending || handle.trim().length === 0}>
            {pending ? 'Searching…' : 'Search eBay'}
          </Button>
        </form>

        {searchError ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-cozy py-snug text-body text-destructive">
            {searchError}
          </p>
        ) : null}

        {search ? (
          <div className="space-y-group" aria-live="polite">
            <p className="text-body text-muted-foreground">
              Tested {search.tested} spellings of @{search.handle} on eBay and found {search.candidates.length}.{' '}
              <a
                href={search.referencesPath}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-foreground underline underline-offset-4"
              >
                Open their references page
              </a>
              .
            </p>

            {search.confirmed.length > 0 ? (
              <div className="space-y-snug">
                <h4 className="text-body font-semibold">Linked to this handle now</h4>
                <ul className="space-y-snug">
                  {search.confirmed.map((link) => (
                    <li
                      key={link.id}
                      className="flex flex-col gap-snug rounded-lg border border-border p-cozy sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 space-y-tight">
                        <ExternalLink href={link.profileUrl}>{link.username}</ExternalLink>
                        <p className="text-meta text-muted-foreground">Checked: {link.note}</p>
                      </div>
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => remove(link.id)}>
                        Remove link
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {search.candidates.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-cozy py-group text-body text-muted-foreground">
                No eBay seller with live listings is spelled like @{search.handle}. eBay shows a seller
                only while they have listings, so an account with none cannot be found here. If you know
                their eBay name, enter it above.
              </p>
            ) : (
              <ul className="space-y-group">
                {search.candidates.map((candidate) => {
                  const key = candidate.username.toLowerCase();
                  const note = notes[key] ?? '';
                  const decidable = candidate.state === 'NEW' || candidate.state === 'REJECTED_HERE';
                  const { stats, context } = candidate;
                  return (
                    <li key={key} className="space-y-cozy rounded-lg border border-border p-group">
                      <div className="flex flex-wrap items-center gap-snug">
                        <ExternalLink href={candidate.profileUrl}>{candidate.username}</ExternalLink>
                        <Badge variant="secondary">{nameRelationLabel(candidate.relation)}</Badge>
                        {STATE_LABEL[candidate.state] ? (
                          <Badge variant={candidate.state === 'CONFIRMED_HERE' ? 'default' : 'secondary'}>
                            {STATE_LABEL[candidate.state]}
                          </Badge>
                        ) : null}
                      </div>

                      <dl className="grid gap-x-group gap-y-tight text-body sm:grid-cols-[10rem_1fr]">
                        <dt className="text-muted-foreground">eBay feedback</dt>
                        <dd className="tabular-nums">
                          {stats.feedbackPercentage !== null ? `${formatFeedbackPercentage(stats.feedbackPercentage)} positive` : 'Not shown'}
                          {stats.feedbackScore !== null ? ` · ${formatFeedbackCount(stats.feedbackScore)} feedback` : ''}
                          {stats.accountType ? ` · ${stats.accountType === 'BUSINESS' ? 'business' : 'individual'} account` : ''}
                        </dd>
                        <dt className="text-muted-foreground">Lists from</dt>
                        <dd>{context.countries.length > 0 ? context.countries.map(countryName).join(', ') : 'Not shown'}</dd>
                        <dt className="text-muted-foreground">Sells trading cards</dt>
                        <dd>{context.sellsCards ? 'Yes' : 'Not clear from its listings'}</dd>
                        {context.sampleTitles.length > 0 ? (
                          <>
                            <dt className="text-muted-foreground">Sample listings</dt>
                            <dd className="space-y-tight">
                              {context.sampleTitles.map((title) => (
                                <span key={title} className="block break-words">
                                  {title}
                                </span>
                              ))}
                            </dd>
                          </>
                        ) : null}
                      </dl>

                      {decidable ? (
                        <div className="space-y-snug">
                          <Label htmlFor={`ebay-note-${key}`}>What did you check?</Label>
                          <Textarea
                            id={`ebay-note-${key}`}
                            value={note}
                            maxLength={LINK_NOTE_MAX}
                            rows={2}
                            placeholder="What you checked"
                            onChange={(event) => setNotes((current) => ({ ...current, [key]: event.target.value }))}
                          />
                          {rowError[key] ? (
                            <p role="alert" className="text-body text-destructive">
                              {rowError[key]}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-snug">
                            <Button size="sm" disabled={pending} onClick={() => decide(candidate, 'CONFIRM')}>
                              Confirm it is them
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending || candidate.state === 'REJECTED_HERE'}
                              onClick={() => decide(candidate, 'REJECT')}
                            >
                              Not them
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
