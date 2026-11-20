import 'server-only';

// lib/enrichment/facebookIndex.ts
//
// Reads what search engines hold about a Facebook profile. Nothing here requests
// facebook.com: a logged-out visitor gets a login page with no name or metadata, and
// Facebook's robots.txt prohibits automated collection. The searches go to the same
// provider the open-web scour uses (Serper when `SERPER_API_KEY` is set, otherwise
// DuckDuckGo through Jina Reader), and the hits are interpreted by the pure
// `buildFacebookIndexReport` in domain/references/facebookIndex.ts.
//
// Queries are unquoted on purpose: DuckDuckGo answers a quoted query from a server with
// a bot challenge, which reads as "no results".

import {
  buildFacebookIndexReport,
  foldName,
  nameFromFacebookSlug,
  type FacebookIndexReport,
  type SearchHitLite,
} from '@/domain/references/facebookIndex';
import { executeSearchQuery } from '@/lib/enrichment/aiWebScour';

/**
 * Searches the index for one profile and the accounts sharing its name.
 *
 * `slug` is the vanity or numeric id; `nameHint` a name already known (from a
 * `/people/Name/<id>` URL). Returns null only for an unusable slug; an empty index is a
 * report with `indexed: false`.
 */
export async function probeFacebookIndex(input: {
  slug: string;
  profileUrl: string;
  nameHint?: string | null;
}): Promise<FacebookIndexReport | null> {
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9.]{3,50}$/.test(slug)) return null;

  const guess = input.nameHint?.trim() || nameFromFacebookSlug(slug);
  const firstRound = [`facebook.com/${slug}`, `site:facebook.com ${slug}`];
  if (guess) firstRound.push(`site:facebook.com ${guess}`);

  const hits: SearchHitLite[] = (await Promise.all(firstRound.map((q) => executeSearchQuery(q)))).flat();
  let report = buildFacebookIndexReport({ slug, profileUrl: input.profileUrl, hits, nameHint: input.nameHint });

  // The profile's real name differs from the slug's guess ("cat.xuan162" may be
  // "Catherine Nguyen"): search the real one for same-name accounts too.
  if (
    report.nameSource === 'INDEX' &&
    report.displayName &&
    (!guess || foldName(guess) !== foldName(report.displayName))
  ) {
    const more = await executeSearchQuery(`site:facebook.com ${report.displayName}`);
    if (more.length > 0) {
      report = buildFacebookIndexReport({
        slug,
        profileUrl: input.profileUrl,
        hits: [...hits, ...more],
        nameHint: input.nameHint,
      });
    }
  }

  return report;
}
