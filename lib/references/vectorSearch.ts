import 'server-only';

// lib/references/vectorSearch.ts
//
// 512-dim hybrid vector + trigram dossier search backed by `pgvector` and `pg_trgm`
// (`cardtrade.reference_dossier_embeddings` + `cardtrade.match_reference_dossiers`, 0169).
//
// Uses OpenAI `text-embedding-3-small` (512 dims) when `OPENAI_API_KEY` is configured,
// and falls back deterministically to a normalized char-trigram + word-token signed
// projection (`deterministicEmbedding512`) so semantic/fuzzy matching works with zero
// extra API dependencies in local dev and tests.

import { createHash } from 'node:crypto';

import type { VectorMatchView } from '@/domain/references/enrichment';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';

export const EMBEDDING_DIMS = 512;

/**
 * Deterministic 512-dim unit-normalized feature-hashing vector over word tokens
 * and character 3-grams. Matches the Python OSINT worker's fallback formula.
 */
export function deterministicEmbedding512(rawText: string): number[] {
  const vec = new Float64Array(EMBEDDING_DIMS);
  const text = rawText.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return Array.from(vec);

  const addFeature = (feature: string, weight: number) => {
    const digest = createHash('sha256').update(feature, 'utf8').digest();
    const bucket = ((digest[0]! << 8) | digest[1]!) % EMBEDDING_DIMS;
    const sign = (digest[2]! & 1) === 0 ? 1 : -1;
    vec[bucket] += sign * weight;
  };

  const tokens = text.split(/[^a-z0-9@._-]+/).filter((t) => t.length >= 2);
  for (const token of tokens) {
    addFeature(`tok:${token}`, 2.0);
    if (token.length >= 3) {
      const padded = `^${token}$`;
      for (let i = 0; i <= padded.length - 3; i += 1) {
        addFeature(`tri:${padded.slice(i, i + 3)}`, 1.0);
      }
    }
  }

  let normSq = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i += 1) normSq += vec[i]! * vec[i]!;
  const norm = Math.sqrt(normSq) || 1;
  return Array.from(vec, (v) => Number((v / norm).toFixed(6)));
}

export async function embedDossierText(text: string): Promise<{ vector: number[]; model: string }> {
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 4000),
        dimensions: EMBEDDING_DIMS,
      }),
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);

    if (res?.ok) {
      const json = (await res.json().catch(() => null)) as
        | { data?: Array<{ embedding?: number[] }> }
        | null;
      const emb = json?.data?.[0]?.embedding;
      if (Array.isArray(emb) && emb.length === EMBEDDING_DIMS) {
        return { vector: emb, model: 'openai:text-embedding-3-small-512' };
      }
    }
  }

  return { vector: deterministicEmbedding512(text), model: 'local:trigram-hash-512' };
}

export function toPgVectorLiteral(values: readonly number[]): string {
  return `[${values.join(',')}]`;
}

export async function upsertDossierEmbedding(input: {
  subjectKey: string;
  subjectKind: 'PROFILE' | 'CLAIM' | 'HANDLE' | 'WEB_MENTION' | 'SCAM_PATTERN';
  platform: string | null;
  handleOrName: string;
  locationHint: string | null;
  sourceUrl: string | null;
  contentText: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const contentText = input.contentText.trim().slice(0, 4000);
  if (!contentText) return;

  const { vector, model } = await embedDossierText(
    [input.handleOrName, input.platform, input.locationHint, contentText].filter(Boolean).join(' · '),
  );

  const admin = createAdminClient();
  const { error } = await admin.from('reference_dossier_embeddings').upsert(
    {
      subject_key: input.subjectKey.slice(0, 240),
      subject_kind: input.subjectKind,
      platform: input.platform?.slice(0, 60) ?? null,
      handle_or_name: input.handleOrName.slice(0, 160),
      location_hint: input.locationHint?.slice(0, 120) ?? null,
      source_url: input.sourceUrl?.slice(0, 1000) ?? null,
      content_text: contentText,
      metadata: { ...(input.metadata ?? {}), model } as Json,
      embedding: toPgVectorLiteral(vector),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'subject_key,subject_kind,content_hash', ignoreDuplicates: true },
  );

  if (error) {
    console.warn(`[references] upsertDossierEmbedding failed: ${error.message}`);
  }
}

export async function matchReferenceDossiers(
  queryText: string,
  limit = 8,
): Promise<VectorMatchView[]> {
  const cleanQuery = queryText.trim();
  if (!cleanQuery) return [];

  const { vector } = await embedDossierText(cleanQuery);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('match_reference_dossiers', {
    p_query_text: cleanQuery,
    p_query_embedding: toPgVectorLiteral(vector),
    p_limit: limit,
  });

  if (error) {
    console.warn(`[references] match_reference_dossiers failed: ${error.message}`);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    subjectKey: row.subject_key,
    subjectKind: row.subject_kind,
    platform: row.platform,
    handleOrName: row.handle_or_name,
    locationHint: row.location_hint,
    sourceUrl: row.source_url,
    snippet: row.content_text.slice(0, 280),
    score: Number(row.combined_score.toFixed(3)),
  }));
}
