'use server';

// lib/actions/disputeEvidence.ts
//
// Server Actions for participant-submitted dispute evidence (0082).
//
// WHY THIS EXISTS. A disputed contract used to give an arbitrator one sentence — the
// `dispute_reason` typed by whoever raised it — and gave the other party no way to
// answer at all. These actions are the formal channel: a written account plus photos or
// video, attributable, timestamped, and visible to both sides.
//
// THIN BY CONVENTION, like every other action module: authenticate, authorise, validate,
// write, revalidate. The authorisation is doubled — an explicit participant guard here
// AND the RLS policies from 0082 on the cookie-bound client — because that is the rule
// for every write path in this codebase.
//
// APPEND-ONLY. There is no update or delete action, and migration 0082 grants no
// privilege for either. A statement is what a party asserted at a moment in a dispute;
// editable evidence is not evidence.
//
// Reads are split in two deliberately:
//   * `getDisputeEvidence` — for the PARTIES. Cookie-bound client, RLS decides.
//   * `getDisputeEvidenceForStaff` — for arbitration. Admin client, staff gate.
// One function with a branch inside it would put the staff path one bad `if` away from
// serving a participant.

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/staffGate';
import {
  createSignedEvidenceUploads,
  signEvidenceUrls,
  verifyEvidencePaths,
  type SignedEvidenceUpload,
} from '@/lib/storage/disputeEvidence';
import {
  EVIDENCE_FILES_MAX,
  EVIDENCE_STATEMENT_MAX,
  EVIDENCE_STATEMENT_MIN,
} from '@/lib/storage/disputeEvidenceShared';
import { fail, ok, type ActionResult } from '@/lib/actions/result';

/** Which contract a submission belongs to. Mirrors the arbitration case addressing. */
export type DisputeCaseKind = 'CASH_SALE' | 'TRADE';

export type DisputeEvidenceError =
  | 'not-authenticated'
  | 'not-authorized'
  | 'not-disputed'
  | 'validation-error'
  | 'upload-prepare-failed'
  | 'persistence-error';

/** One submission, as the contract room and the arbitration case read it. */
export interface DisputeEvidenceEntry {
  id: string;
  authorId: string;
  authorName: string;
  /** True when the viewer wrote this one, so the UI can say "your statement". */
  mine: boolean;
  statement: string;
  /** Signed, short-lived URLs. `url` is null when an object could not be signed. */
  media: { path: string; url: string | null }[];
  createdAt: string;
}

/** Route to revalidate after a write, per contract kind. */
function pathFor(kind: DisputeCaseKind, ref: string): string {
  return kind === 'CASH_SALE' ? `/sales/${ref}` : `/trades/${ref}`;
}

/**
 * Confirm the caller participates in this contract AND that it is actually disputed.
 *
 * BOTH halves matter. Participation alone would let a party file evidence on a contract
 * that was never disputed, or keep filing after staff closed it — writing into a record
 * a decision has already been made on. The RLS policy enforces the same pair; this is
 * the explicit guard that sits in front of it so the failure is a typed result rather
 * than an opaque insert error.
 */
async function assertDisputedParticipant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: DisputeCaseKind,
  ref: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: 'not-authorized' | 'not-disputed' }> {
  if (kind === 'CASH_SALE') {
    const { data } = await supabase
      .from('cash_sales')
      .select('buyer_id, seller_id, status')
      .eq('id', ref)
      .maybeSingle();
    if (!data) return { ok: false, error: 'not-authorized' };
    if (data.buyer_id !== userId && data.seller_id !== userId) {
      return { ok: false, error: 'not-authorized' };
    }
    if (data.status !== 'DISPUTED') return { ok: false, error: 'not-disputed' };
    return { ok: true };
  }

  const { data } = await supabase
    .from('trades')
    .select('initiator_id, counterpart_id, state')
    .eq('id', ref)
    .maybeSingle();
  if (!data) return { ok: false, error: 'not-authorized' };
  if (data.initiator_id !== userId && data.counterpart_id !== userId) {
    return { ok: false, error: 'not-authorized' };
  }
  if (data.state !== 'DISPUTED') return { ok: false, error: 'not-disputed' };
  return { ok: true };
}

/** Resolve display names for a set of profile ids. */
async function namesFor(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const { data } = await admin
    .from('profiles')
    .select('id, display_name')
    .in('id', unique);
  return new Map((data ?? []).map((row) => [row.id as string, row.display_name as string]));
}

/**
 * Mint signed upload targets for the files a party wants to attach.
 *
 * Deliberately does NOT check the dispute state. This only hands out permission to
 * write to a path under the caller's own prefix; nothing is attached to a contract until
 * `submitDisputeEvidence` runs, and that call does check. Gating here as well would mean
 * a second round-trip's worth of failure for no additional safety.
 */
export async function createDisputeEvidenceUploads(
  contentTypes: string[],
): Promise<ActionResult<{ uploads: SignedEvidenceUpload[] }, DisputeEvidenceError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to attach evidence.');

  if (contentTypes.length > EVIDENCE_FILES_MAX) {
    return fail('validation-error', `Up to ${EVIDENCE_FILES_MAX} files are allowed.`);
  }

  try {
    const uploads = await createSignedEvidenceUploads(
      createAdminClient(),
      user.id,
      contentTypes,
    );
    return ok({ uploads });
  } catch (error) {
    return fail(
      'upload-prepare-failed',
      error instanceof Error ? error.message : 'Could not prepare the upload.',
    );
  }
}

/**
 * File a statement, with any already-uploaded media, against a disputed contract.
 *
 * `mediaPaths` are object paths the browser reports having uploaded to. They are
 * re-verified against the caller's own prefix and against the bucket before being
 * persisted, so a client that invents a path gets nothing stored — see
 * `verifyEvidencePaths`. A path that fails verification is dropped rather than failing
 * the submission: the statement is the substance and is worth keeping.
 */
export async function submitDisputeEvidence(input: {
  caseKind: DisputeCaseKind;
  caseRef: string;
  statement: string;
  mediaPaths?: string[];
}): Promise<ActionResult<{ id: string }, DisputeEvidenceError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to submit evidence.');

  const statement = input.statement.trim();
  if (statement.length < EVIDENCE_STATEMENT_MIN) {
    return fail(
      'validation-error',
      `Describe what happened in at least ${EVIDENCE_STATEMENT_MIN} characters.`,
      'statement',
    );
  }
  if (statement.length > EVIDENCE_STATEMENT_MAX) {
    return fail(
      'validation-error',
      `Keep your statement under ${EVIDENCE_STATEMENT_MAX} characters.`,
      'statement',
    );
  }

  const guard = await assertDisputedParticipant(
    supabase,
    input.caseKind,
    input.caseRef,
    user.id,
  );
  if (!guard.ok) {
    return guard.error === 'not-disputed'
      ? fail('not-disputed', 'This contract is not currently under dispute.')
      : fail('not-authorized', 'You are not a party to this contract.');
  }

  const mediaPaths = await verifyEvidencePaths(
    createAdminClient(),
    user.id,
    input.mediaPaths ?? [],
  );

  const { data, error } = await supabase
    .from('dispute_evidence')
    .insert({
      case_kind: input.caseKind,
      case_ref: input.caseRef,
      author_id: user.id,
      statement,
      media_paths: mediaPaths,
    })
    .select('id')
    .single();

  if (error || !data) {
    return fail('persistence-error', 'Your evidence could not be saved. Please try again.');
  }

  revalidatePath(pathFor(input.caseKind, input.caseRef));
  return ok({ id: data.id as string });
}

/**
 * Read every submission on a contract, for a PARTICIPANT.
 *
 * Runs on the cookie-bound client, so the 0082 select policy is what decides
 * visibility — a non-participant gets an empty list rather than a refusal, which is the
 * correct shape for a read that must not confirm whether a contract exists.
 *
 * Both parties see each other's submissions. That is deliberate and not an oversight: a
 * decision made against someone on material they never saw is not a process anyone can
 * trust.
 */
export async function getDisputeEvidence(
  caseKind: DisputeCaseKind,
  caseRef: string,
): Promise<ActionResult<{ entries: DisputeEvidenceEntry[] }, DisputeEvidenceError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to read this dispute.');

  const { data, error } = await supabase
    .from('dispute_evidence')
    .select('id, author_id, statement, media_paths, created_at')
    .eq('case_kind', caseKind)
    .eq('case_ref', caseRef)
    .order('created_at', { ascending: true });

  if (error) {
    return fail('persistence-error', 'The evidence could not be loaded.');
  }

  const admin = createAdminClient();
  const names = await namesFor(admin, (data ?? []).map((row) => row.author_id as string));

  // One signing call for every path across every entry, then redistributed. Signing per
  // entry would be N round-trips for a page that renders them all at once.
  const allPaths = (data ?? []).flatMap((row) => (row.media_paths as string[]) ?? []);
  const signed = await signEvidenceUrls(admin, allPaths);
  const urlByPath = new Map(signed.map((entry) => [entry.path, entry.url]));

  const entries: DisputeEvidenceEntry[] = (data ?? []).map((row) => ({
    id: row.id as string,
    authorId: row.author_id as string,
    authorName: names.get(row.author_id as string) ?? 'A party',
    mine: row.author_id === user.id,
    statement: row.statement as string,
    media: ((row.media_paths as string[]) ?? []).map((path) => ({
      path,
      url: urlByPath.get(path) ?? null,
    })),
    createdAt: row.created_at as string,
  }));

  return ok({ entries });
}

/**
 * Read every submission on a case, for STAFF.
 *
 * Separate from the participant read on purpose. This one uses the service-role client
 * — arbitration must see a case whether or not RLS would grant the row — and is gated on
 * `requireStaff` instead. Keeping them as two functions means the RLS-bypassing path
 * cannot be reached by a participant through a mistaken branch.
 *
 * `mine` is always false here: staff are never a party to the dispute they are deciding.
 */
export async function getDisputeEvidenceForStaff(
  caseKind: DisputeCaseKind,
  caseRef: string,
): Promise<ActionResult<{ entries: DisputeEvidenceEntry[] }, DisputeEvidenceError>> {
  const gate = await requireStaff();
  if (!gate.ok) {
    return gate.error === 'not-authenticated'
      ? fail('not-authenticated', 'Sign in to read this case.')
      : fail('not-authorized', 'Evidence is limited to CardTrade support staff.');
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('dispute_evidence')
    .select('id, author_id, statement, media_paths, created_at')
    .eq('case_kind', caseKind)
    .eq('case_ref', caseRef)
    .order('created_at', { ascending: true });

  if (error) {
    return fail('persistence-error', 'The evidence could not be loaded.');
  }

  const names = await namesFor(admin, (data ?? []).map((row) => row.author_id as string));
  const allPaths = (data ?? []).flatMap((row) => (row.media_paths as string[]) ?? []);
  const signed = await signEvidenceUrls(admin, allPaths);
  const urlByPath = new Map(signed.map((entry) => [entry.path, entry.url]));

  const entries: DisputeEvidenceEntry[] = (data ?? []).map((row) => ({
    id: row.id as string,
    authorId: row.author_id as string,
    authorName: names.get(row.author_id as string) ?? 'A party',
    mine: false,
    statement: row.statement as string,
    media: ((row.media_paths as string[]) ?? []).map((path) => ({
      path,
      url: urlByPath.get(path) ?? null,
    })),
    createdAt: row.created_at as string,
  }));

  return ok({ entries });
}
