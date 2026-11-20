import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProofChallengeClient } from '@/components/references/ProofChallengeClient';
import { getProofChallenge } from '@/lib/enrichment/proofChallenge';

// app/(marketing)/references/verify/[token]/page.tsx
//
// Expiring 1-click Live Proof-of-Card Challenge page (0171). `noindex` always.

export const metadata: Metadata = {
  title: 'Live Proof-of-Card Check · NoDitto',
  description: 'Verify live physical possession of a trading card with a one-time handwritten code.',
  robots: { index: false, follow: false },
};

export default async function ProofChallengePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const challenge = await getProofChallenge(token);
  if (!challenge) notFound();

  return (
    <article className="mx-auto flex w-full max-w-[44rem] flex-1 flex-col px-group py-section sm:px-6 md:py-10">
      <ProofChallengeClient initial={challenge} />
    </article>
  );
}
