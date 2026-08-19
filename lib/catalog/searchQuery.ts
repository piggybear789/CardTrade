// Catalog text search is Postgres websearch: unquoted words are AND-ed.
// A buyer typing a product line plus a player ("Iconic Michael Jordan") gets
// zero hits when the listing only says "Michael Jordan". These fallbacks drop
// the extra words so a miss still surfaces the cards they meant.

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/** Quoted phrases or boolean operators — the buyer chose the exact query. */
function hasExplicitSearchSyntax(q: string): boolean {
  return /["()]|\b(?:OR|AND|NOT)\b/.test(q);
}

function significantTokens(q: string): string[] {
  return q.split(/\s+/).filter((token) => {
    if (token.length === 0) return false;
    return !STOP_WORDS.has(token.toLowerCase());
  });
}

function dropShortest(tokens: string[]): string[] {
  let shortest = 0;
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i].length < tokens[shortest].length) shortest = i;
  }
  return tokens.filter((_, i) => i !== shortest);
}

function pushUnique(attempts: string[], next: string) {
  if (next && !attempts.includes(next)) attempts.push(next);
}

/**
 * Queries to try in order. The first is the typed string; later entries are
 * strictly broader. Callers stop at the first non-empty result set.
 */
export function catalogSearchAttempts(q: string): string[] {
  const trimmed = q.trim().replace(/\s+/g, ' ');
  if (!trimmed) return [];
  if (hasExplicitSearchSyntax(trimmed)) return [trimmed];

  const attempts = [trimmed];
  const tokens = significantTokens(trimmed);
  if (tokens.length < 2) return attempts;

  pushUnique(attempts, tokens.slice(1).join(' '));
  if (tokens.length >= 3) {
    pushUnique(attempts, dropShortest(tokens).join(' '));
  }

  const last = tokens[tokens.length - 1];
  if (last.length >= 3) pushUnique(attempts, last);

  return attempts;
}
