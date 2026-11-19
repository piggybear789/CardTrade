'use client';

// components/admin/ReferenceBioPanel.tsx
//
// "Profile line" on the References tab (0171): a short line under a handle, written by
// Haiku from a few facts and published by a person.
//
// A DRAFT IS NOT PUBLIC. Writing makes a draft that only appears here; Publish is the one
// step that puts it on the page, and it replaces whatever was there. Each draft shows the
// facts the model was given in words, so a reader can check the line against them before
// publishing. Pasted bio text is never sent on: code reads a flag and #tags from it, and
// only those reach the model.
//
// The line describes and never vouches: how well someone trades is for the references and
// their counts to say, so a draft that claims it is thrown away before it gets here.

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  loadReferenceBioState,
  publishReferenceBio,
  removeReferenceBio,
  writeReferenceBio,
  type ReferenceBioRow,
  type ReferenceBioState,
} from '@/lib/actions/admin';
import { BIO_SOURCE_MAX_LENGTH } from '@/domain/references/bio';
import { CLAIM_PLATFORMS, platformLabel } from '@/domain/references/reference';

function BioCard({
  title,
  row,
  children,
}: {
  title: string;
  row: ReferenceBioRow;
  children: ReactNode;
}) {
  return (
    <div className="space-y-snug rounded-lg border border-border p-group">
      <h4 className="text-body font-semibold">{title}</h4>
      <p className="text-body text-foreground">{row.bio}</p>
      <details className="text-meta text-muted-foreground">
        <summary className="cursor-pointer select-none">What the model was told</summary>
        <ul className="mt-snug list-disc space-y-tight pl-group">
          {row.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
        {row.sourceText ? <p className="mt-snug break-words">Pasted bio: {row.sourceText}</p> : null}
        <p className="mt-snug">
          {row.model}
          {row.inputTokens !== null && row.outputTokens !== null
            ? ` · ${row.inputTokens} tokens in, ${row.outputTokens} out`
            : ''}
        </p>
      </details>
      <div className="flex flex-wrap gap-snug">{children}</div>
    </div>
  );
}

export function ReferenceBioPanel() {
  const router = useRouter();
  const [platform, setPlatform] = useState<string>('instagram');
  const [handle, setHandle] = useState('');
  const [pasted, setPasted] = useState('');
  const [state, setState] = useState<ReferenceBioState | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const look = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await loadReferenceBioState(platform, handle);
      if (!result.ok) {
        setState(null);
        setMessage({ ok: false, text: result.message ?? 'Something went wrong.' });
        return;
      }
      setState(result.data);
    });
  };

  const write = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await writeReferenceBio(platform, handle, pasted);
      if (!result.ok) {
        setMessage({ ok: false, text: result.message ?? 'Something went wrong.' });
        return;
      }
      setState(result.data);
      setMessage({ ok: true, text: 'Draft written. It is not public until you publish it.' });
    });
  };

  const change = (run: () => Promise<{ ok: boolean; message?: string }>, done: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        setMessage({ ok: false, text: result.message ?? 'Something went wrong.' });
        return;
      }
      const refreshed = await loadReferenceBioState(platform, handle);
      if (refreshed.ok) setState(refreshed.data);
      setMessage({ ok: true, text: done });
      router.refresh();
    });
  };

  return (
    <Card className="mt-group">
      <CardHeader>
        <CardTitle className="text-lead">Profile line</CardTitle>
      </CardHeader>
      <CardContent className="space-y-group">
        <p className="text-body text-muted-foreground">
          A short line under a handle, written by a model from a few facts and published by you. It
          describes and never vouches. It needs a country or an interest to say anything, so paste the
          handle&rsquo;s public bio: a flag and #tags are read from it, and nothing else is sent on.
        </p>

        <div className="flex flex-col gap-snug sm:flex-row sm:items-end">
          <div className="space-y-tight">
            <Label htmlFor="bio-platform">Platform</Label>
            <select
              id="bio-platform"
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
            <Label htmlFor="bio-handle">Handle</Label>
            <Input
              id="bio-handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="@handle"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <Button variant="outline" disabled={pending || handle.trim().length === 0} onClick={look}>
            See current
          </Button>
        </div>

        <div className="space-y-tight">
          <Label htmlFor="bio-pasted">Their public bio (optional)</Label>
          <Textarea
            id="bio-pasted"
            value={pasted}
            maxLength={BIO_SOURCE_MAX_LENGTH}
            rows={2}
            placeholder="Paste what their profile says, flag and #tags included."
            onChange={(event) => setPasted(event.target.value)}
          />
        </div>

        <Button disabled={pending || handle.trim().length === 0} onClick={write}>
          {pending ? 'Working…' : 'Write a draft'}
        </Button>

        {message ? (
          <p
            role={message.ok ? 'status' : 'alert'}
            className={message.ok ? 'text-body text-muted-foreground' : 'text-body text-destructive'}
          >
            {message.text}
          </p>
        ) : null}

        {state ? (
          <div className="space-y-group" aria-live="polite">
            {state.published ? (
              <BioCard title="Live on the page" row={state.published}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => change(() => removeReferenceBio(state.published!.id), 'Taken down.')}
                >
                  Take down
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <a href={state.referencesPath} target="_blank" rel="noopener noreferrer">
                    Open their page
                  </a>
                </Button>
              </BioCard>
            ) : null}
            {state.draft ? (
              <BioCard title="Draft, not public" row={state.draft}>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => change(() => publishReferenceBio(state.draft!.id), 'Published.')}
                >
                  {state.published ? 'Publish and replace' : 'Publish'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => change(() => removeReferenceBio(state.draft!.id), 'Draft discarded.')}
                >
                  Discard
                </Button>
              </BioCard>
            ) : null}
            {!state.draft && !state.published ? (
              <p className="text-body text-muted-foreground">No profile line for @{state.handle} yet.</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
