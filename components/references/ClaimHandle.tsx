'use client';

// components/references/ClaimHandle.tsx
//
// Claiming an unclaimed handle (0155): the owner proves control by putting a
// one-time code in the social bio and screenshotting it. There is no platform
// API that can read a bio, so staff check the screenshot in /admin; approval
// links the handle (and its references) to the claimant's verified profile.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  startHandleClaim,
  submitHandleClaim,
  type MyHandleClaim,
} from '@/lib/actions/references';
import { uploadReferenceImage } from '@/lib/storage/uploadReferenceImage';
import { REFERENCE_IMAGE_ACCEPT } from '@/lib/storage/referenceImagesShared';

export function ClaimHandle({
  claimId,
  handle,
  platformLabel,
  signedIn,
  identityVerified,
  initialClaim,
  returnPath,
}: {
  claimId: string;
  handle: string;
  platformLabel: string;
  signedIn: boolean;
  identityVerified: boolean;
  initialClaim: MyHandleClaim | null;
  returnPath: string;
}) {
  const router = useRouter();
  const [claim, setClaim] = useState<MyHandleClaim | null>(initialClaim);
  const [paths, setPaths] = useState<string[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <Button asChild>
        <Link href={`/sign-up?redirectTo=${encodeURIComponent(returnPath)}`}>
          Create an account to claim it
        </Link>
      </Button>
    );
  }

  if (!identityVerified) {
    return (
      <div>
        <p className="text-body text-muted-foreground">
          Claiming carries your verified name, so verify your ID first. Then come back here.
        </p>
        <Button asChild variant="outline" className="mt-snug">
          <Link href="/profile?tab=verification">Verify ID</Link>
        </Button>
      </div>
    );
  }

  const start = () => {
    setError(null);
    startTransition(async () => {
      const result = await startHandleClaim(claimId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setClaim(result.data);
    });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    const nextPaths: string[] = [];
    const nextNames: string[] = [];
    for (const file of Array.from(files).slice(0, 3)) {
      const result = await uploadReferenceImage('claim', file);
      if (!result.ok) {
        setError(result.message);
        break;
      }
      nextPaths.push(result.path);
      nextNames.push(file.name);
    }
    setPaths(nextPaths);
    setFileNames(nextNames);
    setUploading(false);
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await submitHandleClaim(claimId, paths);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setClaim(result.data);
      router.refresh();
    });
  };

  if (claim?.status === 'APPROVED') {
    return (
      <p className="text-body font-medium text-trust">
        This handle is claimed. Its graph now lives on the owner&rsquo;s profile.
      </p>
    );
  }

  if (claim?.status === 'PENDING' && claim.screenshotCount > 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-group">
        <p className="text-body font-semibold text-foreground">Your claim is with the NoDitto team</p>
        <p className="mt-tight text-body text-muted-foreground">
          We&rsquo;ll check the screenshot and let you know. You can remove the code from your bio
          now. We already have what we need.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-group">
      <p className="text-body font-semibold text-foreground">Is {handle} yours?</p>
      {error ? (
        <p role="alert" className="mt-snug rounded-lg bg-destructive/10 px-cozy py-snug text-body text-destructive">
          {error}
        </p>
      ) : null}

      {!claim || claim.status === 'DECLINED' ? (
        <>
          <p className="mt-tight text-body text-muted-foreground">
            Prove it&rsquo;s your {platformLabel} account: we&rsquo;ll give you a code to put in
            your bio for a minute, and you screenshot it. Staff check the screenshot; your
            references move over when they approve.
          </p>
          {claim?.status === 'DECLINED' ? (
            <p className="mt-snug text-body text-muted-foreground">
              Your last claim wasn&rsquo;t approved. Try again with a clearer screenshot.
            </p>
          ) : null}
          <Button className="mt-cozy" disabled={pending} onClick={start}>
            {pending ? 'Starting…' : 'Start claim'}
          </Button>
        </>
      ) : (
        <>
          <p className="mt-tight text-body text-muted-foreground">
            Put this code in your {platformLabel} bio, screenshot it, then send us the screenshot.
          </p>
          <p className="mt-cozy rounded-lg border border-dashed border-input bg-muted/40 px-cozy py-snug text-center font-mono text-lead tracking-widest text-foreground">
            {claim.bioCode}
          </p>
          <div className="mt-cozy">
            <label htmlFor="claim-screenshots" className="mb-snug block text-body font-semibold text-foreground">
              Bio screenshot
            </label>
            <Input
              id="claim-screenshots"
              type="file"
              accept={REFERENCE_IMAGE_ACCEPT}
              multiple
              onChange={(event) => onFiles(event.target.files)}
              className="h-11 pt-2"
            />
            {fileNames.length > 0 ? (
              <p className="mt-tight text-meta text-muted-foreground">
                {fileNames.join(', ')}
              </p>
            ) : null}
          </div>
          <Button
            className="mt-cozy"
            disabled={pending || uploading || paths.length === 0}
            onClick={submit}
          >
            {uploading ? 'Uploading…' : pending ? 'Sending…' : 'Send to the team'}
          </Button>
        </>
      )}
    </div>
  );
}
