import 'server-only';

// lib/references/bios.ts
//
// The storage side of a handle's short profile line (0171): gathering the facts the model
// is allowed to see, saving a draft, publishing it, and reading the published line for a
// page. The phrasing is `lib/references/bioModel.ts`; the rules are
// `domain/references/bio.ts`.
//
// A DRAFT IS NOT PUBLIC. `createBioDraft` writes a DRAFT, a staff member reads it, and
// `publishBioDraft` is the only thing that makes it public. A claim keeps at most one
// DRAFT and one PUBLISHED line (the table's UNIQUE), and publishing a new one replaces the
// old, so regenerating never changes what the page says until a person says so.
//
// THE FACTS COME FROM WHAT WE HOLD. Roles from the references the handle gave and
// received, a member's own region when the handle is claimed, and a flag and `#tags` that
// CODE reads out of the public bio staff pasted. Nothing else reaches the model.
//
// `loadPublishedBio` never throws: the line is an extra on a page, and a failed read
// shows no line rather than an error screen.

import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { writeBio, type BioOutcome } from '@/lib/references/bioModel';
import { rowsOrThrow } from '@/lib/references/people';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { findRegion, regionLabel } from '@/domain/region';
import {
  BIO_SOURCE_MAX_LENGTH,
  bioFactsAreEnough,
  buildBioFacts,
  type BioFacts,
  type BioRole,
} from '@/domain/references/bio';
import { platformLabel } from '@/domain/references/reference';

type Admin = ReturnType<typeof createAdminClient>;

/** A claim as the bio needs it. */
export interface BioClaim {
  id: string;
  platform: string;
  claimed_profile_id: string | null;
}

/** A saved line, with what staff need to judge it. Never leaves the server except to an admin. */
export interface StoredBio {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  bio: string;
  facts: BioFacts;
  sourceText: string | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  generatedAt: string;
  publishedAt: string | null;
}

const COLUMNS = 'id, status, bio, facts, source_text, model, input_tokens, output_tokens, generated_at, published_at';

interface BioRow {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  bio: string;
  facts: Json;
  source_text: string | null;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  generated_at: string;
  published_at: string | null;
}

function toStored(row: BioRow): StoredBio {
  return {
    id: row.id,
    status: row.status,
    bio: row.bio,
    // Written by `createBioDraft` from a `BioFacts`, so it reads back as one.
    facts: row.facts as unknown as BioFacts,
    sourceText: row.source_text,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    generatedAt: row.generated_at,
    publishedAt: row.published_at,
  };
}

const ROLES: readonly BioRole[] = ['BOUGHT', 'SOLD', 'TRADED'];
const rolesOf = (rows: readonly { role: string }[]): BioRole[] =>
  rows.map((row) => row.role).filter((role): role is BioRole => (ROLES as readonly string[]).includes(role));

/**
 * The facts the model may see for one handle. A claimed handle also counts what its member
 * gave and received under their own name, so one person is one set of facts.
 */
export async function gatherBioFacts(admin: Admin, claim: BioClaim, pastedBio: string | null): Promise<BioFacts> {
  const profileId = claim.claimed_profile_id;
  const givenQuery = admin.from('reference_edges_public').select('role').limit(500);
  const receivedQuery = admin.from('reference_edges_public').select('role').limit(500);

  const [given, received, profile] = await Promise.all([
    profileId
      ? givenQuery.or(`voucher_claim_id.eq.${claim.id},voucher_id.eq.${profileId}`)
      : givenQuery.eq('voucher_claim_id', claim.id),
    profileId
      ? receivedQuery.or(`target_claim_id.eq.${claim.id},target_profile_id.eq.${profileId}`)
      : receivedQuery.eq('target_claim_id', claim.id),
    profileId
      ? admin.from('profiles').select('region_code').eq('id', profileId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (profile.error) throw new Error(`[references] bio profile: ${profile.error.message}`);
  const code = profile.data?.region_code ?? null;

  return buildBioFacts({
    platformLabel: platformLabel(claim.platform),
    givenRoles: rolesOf(rowsOrThrow(given, 'bio given references')),
    receivedRoles: rolesOf(rowsOrThrow(received, 'bio received references')),
    memberCountry: code && findRegion(code) ? regionLabel(code) : null,
    pastedBio: pastedBio?.trim() ? pastedBio.trim().slice(0, BIO_SOURCE_MAX_LENGTH) : null,
  });
}

export type DraftResult =
  | { ok: true; stored: StoredBio; facts: BioFacts }
  | {
      ok: false;
      reason: Exclude<BioOutcome, { ok: true }>['reason'] | 'SAVE_FAILED';
      detail?: string;
      facts: BioFacts;
    };

/**
 * Write a DRAFT for a handle. Nothing reaches the model unless the facts say something
 * (a country or an interest), and a draft that fails the checks is not saved.
 */
export async function createBioDraft(
  admin: Admin,
  args: { claim: BioClaim; pastedBio: string | null; adminId: string | null },
): Promise<DraftResult> {
  const pastedBio = args.pastedBio?.trim() ? args.pastedBio.trim().slice(0, BIO_SOURCE_MAX_LENGTH) : null;
  const facts = await gatherBioFacts(admin, args.claim, pastedBio);
  if (!bioFactsAreEnough(facts)) return { ok: false, reason: 'TOO_THIN', facts };

  const outcome = await writeBio(facts);
  if (!outcome.ok) return { ok: false, reason: outcome.reason, detail: outcome.detail, facts };

  // One draft per claim: a new one replaces the last.
  const cleared = await admin.from('reference_bios').delete().eq('claim_id', args.claim.id).eq('status', 'DRAFT');
  if (cleared.error) return { ok: false, reason: 'SAVE_FAILED', detail: cleared.error.message, facts };

  const inserted = await admin
    .from('reference_bios')
    .insert({
      claim_id: args.claim.id,
      status: 'DRAFT',
      bio: outcome.bio,
      facts: facts as unknown as Json,
      source_text: pastedBio,
      model: outcome.model,
      input_tokens: outcome.inputTokens,
      output_tokens: outcome.outputTokens,
      generated_by: args.adminId,
    })
    .select(COLUMNS)
    .maybeSingle();
  if (inserted.error || !inserted.data) {
    return { ok: false, reason: 'SAVE_FAILED', detail: inserted.error?.message ?? 'The draft was not saved.', facts };
  }
  return { ok: true, stored: toStored(inserted.data as BioRow), facts };
}

/** Both of a claim's lines, for the staff panel. Throws on a failed read. */
export async function loadBioRows(
  admin: Admin,
  claimId: string,
): Promise<{ draft: StoredBio | null; published: StoredBio | null }> {
  const rows = rowsOrThrow(
    await admin.from('reference_bios').select(COLUMNS).eq('claim_id', claimId),
    'bio rows',
  ) as BioRow[];
  const stored = rows.map(toStored);
  return {
    draft: stored.find((row) => row.status === 'DRAFT') ?? null,
    published: stored.find((row) => row.status === 'PUBLISHED') ?? null,
  };
}

/** Publish a draft, replacing whatever was published. False when there is no such draft. */
export async function publishBioDraft(
  admin: Admin,
  draftId: string,
  adminId: string | null,
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'SAVE_FAILED'; detail?: string }> {
  const draft = await admin
    .from('reference_bios')
    .select('id, claim_id')
    .eq('id', draftId)
    .eq('status', 'DRAFT')
    .maybeSingle();
  if (draft.error) return { ok: false, reason: 'SAVE_FAILED', detail: draft.error.message };
  if (!draft.data) return { ok: false, reason: 'NOT_FOUND' };

  // The old line goes first: if the next write fails the page shows no line, never a stale one.
  const cleared = await admin
    .from('reference_bios')
    .delete()
    .eq('claim_id', draft.data.claim_id)
    .eq('status', 'PUBLISHED');
  if (cleared.error) return { ok: false, reason: 'SAVE_FAILED', detail: cleared.error.message };

  const published = await admin
    .from('reference_bios')
    .update({ status: 'PUBLISHED', published_by: adminId, published_at: new Date().toISOString() })
    .eq('id', draftId)
    .eq('status', 'DRAFT')
    .select('id')
    .maybeSingle();
  if (published.error) return { ok: false, reason: 'SAVE_FAILED', detail: published.error.message };
  return published.data ? { ok: true } : { ok: false, reason: 'NOT_FOUND' };
}

/** Delete a line, draft or published: discarding a draft, or taking a published one down. */
export async function removeBio(
  admin: Admin,
  bioId: string,
): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'SAVE_FAILED'; detail?: string }> {
  const { data, error } = await admin.from('reference_bios').delete().eq('id', bioId).select('id').maybeSingle();
  if (error) return { ok: false, reason: 'SAVE_FAILED', detail: error.message };
  return data ? { ok: true } : { ok: false, reason: 'NOT_FOUND' };
}

/**
 * The published line for a page, or null. Never throws: a page renders with or without it.
 * Only the text leaves: not the facts, the pasted bio, the model or who published it.
 */
export async function loadPublishedBio(
  admin: Admin,
  claimIds: readonly string[],
): Promise<{ text: string } | null> {
  if (claimIds.length === 0) return null;
  try {
    const rows = rowsOrThrow(
      await admin
        .from('reference_bios')
        .select('bio')
        .eq('status', 'PUBLISHED')
        .in('claim_id', [...claimIds])
        .order('published_at', { ascending: true })
        .limit(1),
      'published bio',
    );
    return rows[0] ? { text: rows[0].bio } : null;
  } catch (error) {
    await logBackgroundFailure({ name: 'references.bio', errorCode: 'BIO_READ_FAILED', error });
    return null;
  }
}
