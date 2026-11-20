// domain/references/facebookIndex.ts
//
// What SEARCH ENGINES hold about a Facebook profile, read from their result titles and
// snippets. Pure: the caller runs the searches (lib/enrichment/facebookIndex.ts) and
// hands the hits in.
//
// Why search results and not the profile: facebook.com serves a logged-out visitor a
// login page with no name, photo or metadata (probed 2026-11-21), its robots.txt
// prohibits automated collection without written permission, and logging in to read
// profiles breaks Meta's terms. A search engine's copy of the page is what anyone can
// see without logging in, and it carries what the profile owner chose to make public:
// the display name, sometimes "Lives in", "Works at", a friend count, and which of the
// profile's pages (photos, about, posts) are public at all.
//
// It also answers a question the profile cannot: how many OTHER Facebook accounts use
// the same name. Impersonators copy a real person's name and photos onto a fresh
// account, so several same-name profiles is a reason to check you have the right one.
// It is never proof on its own: plenty of real people share a name.

import { RESERVED_FB_PATHS } from '@/domain/references/lookup';
import type { ForensicsFlag } from '@/domain/references/profileForensics';

/** One search-engine result, as every provider in lib/enrichment returns it. */
export interface SearchHitLite {
  title: string;
  url: string;
  snippet: string;
}

/** A page of the subject's own profile that a search engine has indexed. */
export interface FacebookIndexedPage {
  url: string;
  /** `profile`, `photos`, `about`, `posts`, `friends`, ... (the path after the vanity). */
  section: string;
  title: string;
  snippet: string;
}

/** Another Facebook account whose indexed name matches the subject's. */
export interface FacebookSameNameAccount {
  slug: string;
  url: string;
  name: string;
}

export interface FacebookIndexReport {
  /** The vanity name searched for, lower-cased (`cat.xuan162`). */
  slug: string;
  profileUrl: string;
  /** True when at least one of the subject's own pages is in the index. */
  indexed: boolean;
  displayName: string | null;
  /**
   * `INDEX`: read from the subject's own indexed page. `SLUG`: guessed from the vanity
   * name (`cat.xuan162` -> "Cat Xuan") because nothing better was indexed.
   */
  nameSource: 'INDEX' | 'SLUG' | null;
  livesIn: string | null;
  from: string | null;
  worksAt: string | null;
  studiedAt: string | null;
  friendsCount: number | null;
  followersCount: number | null;
  pages: FacebookIndexedPage[];
  sameNameAccounts: FacebookSameNameAccount[];
}

/** Path segments that are never a vanity name, beyond the lookup parser's own list. */
const EXTRA_RESERVED = new Set([
  'people',
  'profile.php',
  'permalink.php',
  'story.php',
  'photo.php',
  'hashtag',
  'search',
  'public',
  'directory',
  'pg',
  'l.php',
  'media',
  'notes',
  'business',
  'ads',
  'legal',
  'policies',
  'policy.php',
  'r.php',
  'recover',
  'signup',
]);

/** Titles and snippets that name Facebook itself, never a person. */
const GENERIC_NAME_RE =
  /^(?:facebook|log\s*in(?:to)?(?:\s+(?:to|or\s+sign\s+up))?(?:\s+facebook)?|log\s+into\s+facebook|sign\s+up|photos?|videos?|about|friends|posts?|reels?|mobile\s+uploads|cover\s+photos|profile\s+pictures|error|page\s+not\s+found|content\s+not\s+found|this\s+content\s+isn'?t\s+available.*)$/i;

const MAX_PAGES = 8;
const MAX_SAME_NAME = 8;

function normaliseSpaces(value: string): string {
  return value.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

/** Lower-case, accent-free, single-spaced: "Céline  Dion" and "celine dion" compare equal. */
export function foldName(value: string): string {
  return normaliseSpaces(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isPlausibleName(value: string): boolean {
  const name = normaliseSpaces(value);
  if (name.length < 2 || name.length > 60) return false;
  if (!/\p{L}/u.test(name)) return false;
  if (/facebook|https?:|www\.|\.com\b/i.test(name)) return false;
  if (GENERIC_NAME_RE.test(name)) return false;
  if (name.split(' ').length > 6) return false;
  return true;
}

/**
 * Where a facebook.com URL points: the vanity (or numeric id for `/people/Name/<id>`),
 * the section after it, and a name when the URL carries one. Null for anything that is
 * not a person's profile (groups, Marketplace listings, posts by id, ...).
 */
export function facebookProfileOfUrl(
  rawUrl: string,
): { slug: string; section: string; urlName: string | null; profileUrl: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|mbasic|web|[a-z]{2}-[a-z]{2})\./, '');
  if (host !== 'facebook.com' && host !== 'fb.com') return null;
  const parts = url.pathname
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  if (parts.length === 0) return null;

  if (parts[0]!.toLowerCase() === 'people' && parts[2] && /^\d{5,30}$/.test(parts[2])) {
    const urlName = parts[1]!.replace(/[-_+]+/g, ' ').trim();
    return {
      slug: parts[2],
      section: (parts[3] ?? 'profile').toLowerCase(),
      urlName: isPlausibleName(urlName) ? urlName : null,
      profileUrl: `https://www.facebook.com/people/${parts[1]}/${parts[2]}/`,
    };
  }
  if (parts[0]!.toLowerCase() === 'profile.php') {
    const id = url.searchParams.get('id');
    if (!id || !/^\d{5,30}$/.test(id)) return null;
    return {
      slug: id,
      section: (url.searchParams.get('sk') ?? 'profile').toLowerCase(),
      urlName: null,
      profileUrl: `https://www.facebook.com/profile.php?id=${id}`,
    };
  }

  const first = parts[0]!.toLowerCase();
  if (RESERVED_FB_PATHS.has(first) || EXTRA_RESERVED.has(first)) return null;
  if (!/^[a-z0-9.]{5,50}$/.test(first)) return null;
  return {
    slug: first,
    section: (parts[1] ?? 'profile').toLowerCase(),
    urlName: null,
    profileUrl: `https://www.facebook.com/${first}`,
  };
}

/**
 * The person's name as a search engine titled their page. Facebook pages are indexed
 * as "Name - Facebook", "Name | Facebook", "Name (@vanity) • Facebook" or with a
 * snippet beginning "Name is on Facebook."
 */
export function nameFromFacebookResult(title: string, snippet: string): string | null {
  const cleanTitle = normaliseSpaces(title);
  const patterns = [
    /^(.+?)\s*\(@[^)]+\)\s*[•·|-]\s*Facebook\b/i,
    /^(.+?)\s*[-|–—·•]\s*Facebook\s*$/i,
    /^(.+?)\s*[-|–—]\s*(?:Home|About|Photos|Friends|Posts)\s*[-|–—]?\s*(?:Facebook)?\s*$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(cleanTitle);
    if (m?.[1] && isPlausibleName(m[1])) return normaliseSpaces(m[1]);
  }
  const snip = /^(.{2,60}?)\s+is\s+on\s+Facebook\b/i.exec(normaliseSpaces(snippet));
  if (snip?.[1] && isPlausibleName(snip[1])) return normaliseSpaces(snip[1]);
  return null;
}

/**
 * A name guessed from the vanity alone: `cat.xuan162` -> "Cat Xuan". Needs two letter
 * tokens, because a single word ("pokeking99") is a nickname, not a name to search by.
 */
export function nameFromFacebookSlug(slug: string): string | null {
  const tokens = slug
    .toLowerCase()
    .split(/[._-]+/)
    .map((t) => t.replace(/\d+/g, ''))
    .filter((t) => /^\p{L}{2,}$/u.test(t));
  if (tokens.length < 2 || tokens.length > 4) return null;
  return tokens.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(' ');
}

function parseCount(raw: string): number | null {
  const m = /^([\d.,]+)\s*([KkMm])?$/.exec(raw.trim());
  if (!m) return null;
  const hasSuffix = Boolean(m[2]);
  const numeric = hasSuffix ? Number.parseFloat(m[1]!.replace(/,/g, '')) : Number.parseInt(m[1]!.replace(/[.,]/g, ''), 10);
  if (!Number.isFinite(numeric)) return null;
  const mult = m[2]?.toLowerCase() === 'k' ? 1_000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1;
  return Math.round(numeric * mult);
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  const value = m?.[1] ? normaliseSpaces(m[1]).replace(/[,;:]+$/, '') : null;
  return value && value.length >= 2 ? value.slice(0, 80) : null;
}

/** The "Intro" facts Facebook puts in a public profile's search snippet. */
function introFacts(text: string): Pick<
  FacebookIndexReport,
  'livesIn' | 'from' | 'worksAt' | 'studiedAt' | 'friendsCount' | 'followersCount'
> {
  const friends = /([\d.,]+\s?[KkMm]?)\s+friends\b/.exec(text)?.[1] ?? null;
  const followers = /([\d.,]+\s?[KkMm]?)\s+followers\b/.exec(text)?.[1] ?? null;
  return {
    livesIn: firstMatch(text, /\bLives\s+in\s+([^.·|\n]{2,80})/i),
    from: firstMatch(text, /(?:^|[.·|]\s*)From\s+([A-Z][^.·|\n]{1,80})/),
    worksAt: firstMatch(text, /\bWorks\s+at\s+([^.·|\n]{2,80})/i),
    studiedAt: firstMatch(text, /\b(?:Studie[sd]|Went\s+to)\s+(?:at\s+)?([^.·|\n]{2,80})/i),
    friendsCount: friends ? parseCount(friends) : null,
    followersCount: followers ? parseCount(followers) : null,
  };
}

/** Facebook's own boilerplate, which says nothing about the person. */
function isBoilerplateSnippet(snippet: string): boolean {
  return /Join Facebook to connect with|Facebook gives people the power to share|Log into Facebook|See posts, photos and more on Facebook/i.test(
    snippet,
  );
}

/**
 * Reads every hit for one profile: the subject's own indexed pages, the facts in their
 * snippets, and other accounts indexed under the same name.
 *
 * `slug` is the vanity (or numeric id) the member pasted. `nameHint` is a name already
 * known from elsewhere (a `/people/Name/` URL), preferred over a slug guess.
 */
export function buildFacebookIndexReport(input: {
  slug: string;
  profileUrl: string;
  hits: SearchHitLite[];
  nameHint?: string | null;
}): FacebookIndexReport {
  const slug = input.slug.trim().toLowerCase();
  const pages: FacebookIndexedPage[] = [];
  const others = new Map<string, { url: string; name: string }>();
  const seenUrls = new Set<string>();
  let indexName: string | null = null;
  const factText: string[] = [];

  for (const hit of input.hits) {
    if (!hit.url || seenUrls.has(hit.url)) continue;
    seenUrls.add(hit.url);
    const where = facebookProfileOfUrl(hit.url);
    if (!where) continue;
    const name = nameFromFacebookResult(hit.title, hit.snippet) ?? where.urlName;

    if (where.slug === slug) {
      if (pages.length < MAX_PAGES) {
        pages.push({
          url: hit.url,
          section: where.section,
          title: normaliseSpaces(hit.title).slice(0, 160),
          snippet: normaliseSpaces(hit.snippet).slice(0, 300),
        });
      }
      // The profile's own root page names the person most reliably; a sub-page title
      // ("Photos") does not, but its snippet may.
      if (name && (!indexName || where.section === 'profile')) indexName = name;
      if (hit.snippet && !isBoilerplateSnippet(hit.snippet)) factText.push(normaliseSpaces(hit.snippet));
      factText.push(normaliseSpaces(hit.title));
    } else if (name && !others.has(where.slug)) {
      others.set(where.slug, { url: where.profileUrl, name });
    }
  }

  const slugGuess = nameFromFacebookSlug(slug);
  const displayName = indexName ?? input.nameHint?.trim() ?? slugGuess;
  const nameSource: FacebookIndexReport['nameSource'] = indexName || input.nameHint?.trim()
    ? 'INDEX'
    : slugGuess
      ? 'SLUG'
      : null;

  const sameNameAccounts: FacebookSameNameAccount[] = [];
  if (displayName) {
    const wanted = foldName(displayName);
    for (const [otherSlug, other] of others) {
      if (foldName(other.name) !== wanted) continue;
      sameNameAccounts.push({ slug: otherSlug, url: other.url, name: other.name });
      if (sameNameAccounts.length >= MAX_SAME_NAME) break;
    }
  }

  return {
    slug,
    profileUrl: input.profileUrl,
    indexed: pages.length > 0,
    displayName,
    nameSource,
    ...introFacts(factText.join(' · ')),
    pages,
    sameNameAccounts,
  };
}

/** What the search index says that bears on whether the profile is genuine. */
export function facebookIndexFlags(report: FacebookIndexReport | null | undefined): ForensicsFlag[] {
  if (!report) return [];
  const flags: ForensicsFlag[] = [];
  const count = report.sameNameAccounts.length;

  if (count > 0 && report.displayName) {
    const plural = count === 1 ? 'account' : 'accounts';
    flags.push({
      code: 'FB_SAME_NAME_ACCOUNTS',
      label: `${count} other Facebook ${plural} named "${report.displayName}"`,
      detail:
        'Scammers copy a real person\'s name and photos onto a new account. Check that the profile you are dealing with is the one with years of history: compare the profile link, not the name. Many real people share a name, so this is not proof on its own.',
      severity: count >= 3 ? 'CAUTION' : 'INFO',
      points: count >= 3 ? 10 : 0,
    });
  }

  if (!report.indexed) {
    flags.push({
      code: 'FB_NOT_INDEXED',
      label: 'This profile is not in search engines',
      detail:
        'Search engines hold no copy of this profile. That happens when a profile is new, or when its owner turned off search-engine listing, which many real people do.',
      severity: 'INFO',
      points: 0,
    });
  }

  return flags;
}
