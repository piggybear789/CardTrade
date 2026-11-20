// domain/references/footprintPresentation.ts
//
// Pure presentation parsers that turn raw public footprint strings (eBay sale titles,
// Instagram bios, DuckDuckGo web mentions) into structured badges, clean non-duplicated
// headlines, and visual metadata for `BackgroundCheckPanel`.

import type { WebMentionView } from '@/domain/references/enrichment';
import type { ClaimPlatform } from '@/domain/references/reference';

export interface EbayStarTier {
  label: string;
  /** Semantic Tailwind color class for the star icon. */
  iconClass: string;
  badgeClass: string;
}

/**
 * Maps an eBay feedback score to eBay's recognizable feedback star progression,
 * styled to harmonize with NoDitto's warm light-surface palette.
 */
export function getEbayStarTier(score: number | null): EbayStarTier | null {
  if (score === null || score < 10) return null;
  if (score >= 1000) {
    return {
      label: `${score.toLocaleString('en-US')} feedback`,
      iconClass: 'text-destructive',
      badgeClass: 'border-destructive/25 bg-destructive/8 text-destructive',
    };
  }
  if (score >= 500) {
    return {
      label: `${score.toLocaleString('en-US')} feedback`,
      iconClass: 'text-iris-ink',
      badgeClass: 'border-iris/35 bg-iris/15 text-iris-ink',
    };
  }
  if (score >= 100) {
    return {
      label: `${score.toLocaleString('en-US')} feedback`,
      iconClass: 'text-trust',
      badgeClass: 'border-trust/25 bg-trust/10 text-trust',
    };
  }
  if (score >= 50) {
    return {
      label: `${score.toLocaleString('en-US')} feedback`,
      iconClass: 'text-sky-700',
      badgeClass: 'border-sky-600/25 bg-sky-500/10 text-sky-800',
    };
  }
  return {
    label: `${score.toLocaleString('en-US')} feedback`,
    iconClass: 'text-amber-600',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-800',
  };
}

export interface ParsedSaleItem {
  gradeBadge: { label: string; highlight: boolean } | null;
  categoryBadge: string | null;
  year: string | null;
  cleanTitle: string;
  shortWhen: string | null;
}

const SLAB_RE =
  /\b(PSA|BGS|CGC|SGC|ACE|TAG|ARS)\s+(?:(?:GEM\s+MINT|PRISTINE|BLACK\s+LABEL|MINT|NM-?MT|NM|EX-?MT|VG-?EX|EX|VG|GOOD|POOR|AUTH(?:ENTIC)?)\s+)?(10|9\.5|9|8\.5|8|7|6|5|4|3|2|1)\b/i;
const YEAR_RE = /\b(199\d|20[0-2]\d)\b/;

export function parseEbaySaleTitle(title: string, when?: string | null): ParsedSaleItem {
  const slabMatch = title.match(SLAB_RE);
  const gradeBadge = slabMatch
    ? {
        label: `${slabMatch[1]!.toUpperCase()} ${slabMatch[2]}`,
        highlight: slabMatch[2] === '10' || slabMatch[2] === '9.5',
      }
    : null;

  let categoryBadge: string | null = null;
  if (/\b(booster\s+box|etb|elite\s+trainer|pin\s+collection|tin|sealed|case|pack|blister)\b/i.test(title)) {
    categoryBadge = 'Sealed';
  } else if (/\bpok[eé]mon\b/i.test(title)) {
    categoryBadge = 'Pokémon';
  } else if (/\bone\s+piece\b/i.test(title)) {
    categoryBadge = 'One Piece';
  } else if (/\b(yu-?gi-?oh)\b/i.test(title)) {
    categoryBadge = 'Yu-Gi-Oh!';
  } else if (/\b(magic|mtg)\b/i.test(title)) {
    categoryBadge = 'MTG';
  } else if (/\b(prizm|optic|select|nba|nfl|mlb|topps|panini|bowman)\b/i.test(title)) {
    categoryBadge = 'Sports';
  }

  const yearMatch = title.match(YEAR_RE);
  const year = yearMatch ? yearMatch[1]! : null;

  const cleanTitle = title.replace(/\s+/g, ' ').trim();

  let shortWhen: string | null = null;
  if (when) {
    if (/more than a year ago/i.test(when)) shortWhen = '1+ yr ago';
    else if (/past 6 months/i.test(when)) shortWhen = 'Past 6 mo';
    else if (/past month/i.test(when)) shortWhen = 'Past month';
    else if (/past year/i.test(when)) shortWhen = 'Past year';
    else shortWhen = when;
  }

  return {
    gradeBadge,
    categoryBadge,
    year,
    cleanTitle,
    shortWhen,
  };
}

export interface ParsedInstagramBio {
  location: string | null;
  tags: string[];
  cleanBio: string | null;
}

const REGION_MAP: Array<{ re: RegExp; label: string }> = [
  { re: /(?:🇦🇺|\bAU\b|\bAustralia\b|\bSydney\b|\bMelbourne\b|\bBrisbane\b|\bPerth\b|\bAdelaide\b)/i, label: 'Australia' },
  { re: /(?:🇺🇸|\bUSA?\b|\bUnited States\b)/i, label: 'United States' },
  { re: /(?:🇬🇧|\bUK\b|\bUnited Kingdom\b|\bLondon\b)/i, label: 'United Kingdom' },
  { re: /(?:🇨🇦|\bCanada\b|\bToronto\b|\bVancouver\b)/i, label: 'Canada' },
  { re: /(?:🇳🇿|\bNZ\b|\bNew Zealand\b)/i, label: 'New Zealand' },
  { re: /(?:🇯🇵|\bJapan\b|\bTokyo\b)/i, label: 'Japan' },
  { re: /(?:🇸🇬|\bSingapore\b)/i, label: 'Singapore' },
];

// Strip emoji/pictographs so bio text stays clean & typographic (no stray emoji badges).
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu;

export function parseInstagramBio(bio: string | null | undefined): ParsedInstagramBio {
  if (!bio || !bio.trim()) {
    return { location: null, tags: [], cleanBio: null };
  }

  let location: string | null = null;
  for (const r of REGION_MAP) {
    if (r.re.test(bio)) {
      location = r.label;
      break;
    }
  }

  const tags = Array.from(
    new Set(
      (bio.match(/#[a-z0-9_]+/gi) ?? [])
        .map((t) => t.toLowerCase())
        .slice(0, 6),
    ),
  );

  // Strip hashtags, emoji, and standalone region codes ("AU") if already captured as a chip.
  let remainder = bio
    .replace(/#[a-z0-9_]+/gi, ' ')
    .replace(EMOJI_RE, ' ');
  if (location === 'Australia') {
    remainder = remainder.replace(/\bAU\b/g, ' ');
  } else if (location === 'United States') {
    remainder = remainder.replace(/\bUSA?\b/g, ' ');
  } else if (location === 'United Kingdom') {
    remainder = remainder.replace(/\bUK\b/g, ' ');
  } else if (location === 'New Zealand') {
    remainder = remainder.replace(/\bNZ\b/g, ' ');
  }
  remainder = remainder.replace(/[•|·/]+/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    location,
    tags,
    cleanBio: remainder.length >= 4 ? remainder : null,
  };
}

export interface FormattedWebMention {
  id: string;
  url: string;
  hostname: string;
  platformChip: ClaimPlatform | null;
  faviconUrl: string | null;
  sourceLabel: string;
  headline: string;
  excerpt: string | null;
  metaPills: string[];
  riskFlag: WebMentionView['riskFlag'];
}

function normalizeAlnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isDuplicateText(a: string, b: string): boolean {
  const na = normalizeAlnum(a);
  const nb = normalizeAlnum(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  // Only treat as duplicate when the shorter text covers most of the longer text
  // (e.g. a truncated title repeating the start of the snippet with little extra info).
  if (shorter.length / longer.length < 0.55) return false;
  const probe = shorter.slice(0, Math.min(shorter.length, 40));
  return probe.length >= 16 && longer.includes(probe);
}

function extractHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isInstagramUrl(rawUrl: string): boolean {
  const host = extractHostname(rawUrl);
  return host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am';
}

export function canonicalizeWebUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '') || '';
    const search = parsed.search || '';
    return `${host}${path}${search}`.toLowerCase();
  } catch {
    return rawUrl
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/\/+$/, '');
  }
}

/**
 * Excludes Instagram URLs from "Open web & community" mentions (Instagram already has its
 * own dedicated profile row above) and deduplicates identical canonical URLs.
 */
export function filterOpenWebMentions<T extends { url: string }>(mentions: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of mentions) {
    if (!m.url || isInstagramUrl(m.url)) continue;
    const key = canonicalizeWebUrl(m.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function detectPlatformChip(hostname: string, sourceLabel: string): ClaimPlatform | null {
  const h = hostname.toLowerCase();
  const l = sourceLabel.toLowerCase();
  if (h.includes('instagram.com') || l.includes('instagram')) return 'instagram';
  if (h.includes('facebook.com') || h.includes('fb.com') || l.includes('facebook')) return 'facebook';
  if (h.includes('ebay.') || l.includes('ebay')) return 'ebay';
  if (h.includes('tiktok.com') || l.includes('tiktok')) return 'tiktok';
  if (h.includes('x.com') || h.includes('twitter.com') || l === 'x') return 'x';
  if (h.includes('youtube.com') || h.includes('youtu.be') || l.includes('youtube')) return 'youtube';
  if (h.includes('discord.com') || h.includes('discord.gg') || l.includes('discord')) return 'discord';
  return null;
}

const TRAILING_SITE_RE =
  /\s*[-–—|•]\s*(?:Instagram|Facebook(?:\s+Group)?|GoFundMe|Reddit|eBay|YouTube|TikTok|X|Twitter)\s*$/i;

const IG_POST_RE =
  /^([\d.,]+[kKmM]?)\s+likes?,\s*([\d.,]+[kKmM]?)\s+comments?\s*[-–—]\s*([^:]+?)\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}):\s*["“]?([\s\S]+?)["”]?\s*$/;

const IG_COLLAB_RE =
  /^([^|]+?)\s*\|\s*(.+)$/;

const IG_SCRAPE_COLLAB_RE =
  /^([a-z0-9._]{2,30})\s+and\s+([a-z0-9._]{2,30})\s+More\s+options\b/i;

function stripIgScrapeChrome(s: string): string {
  return s
    .replace(/\bMore\s+options\b/gi, ' ')
    .replace(/\bVerified\b/gi, ' ')
    .replace(/\bEdited\s*[•·]\s*\d+[a-z]+\b/gi, ' ')
    .replace(/\b\d+[wdhm]\b/g, ' ')
    .replace(EMOJI_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatWebMention(mention: WebMentionView): FormattedWebMention {
  const hostname = extractHostname(mention.url);
  const platformChip = detectPlatformChip(hostname, mention.sourceLabel);
  const faviconUrl =
    !platformChip && hostname
      ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`
      : null;

  const metaPills: string[] = [];
  const rawTitle = mention.title.replace(/\s+/g, ' ').trim();
  const rawSnippet = mention.snippet.replace(/\s+/g, ' ').trim();

  // Case 1: Instagram post format ("196 likes, 33 comments - handle on August 4, 2026: "Caption..."")
  const igSource = rawSnippet.length > rawTitle.length ? rawSnippet : rawTitle;
  const igMatch = igSource.match(IG_POST_RE) ?? rawTitle.match(IG_POST_RE);
  if (igMatch) {
    const [, likes, comments, author, dateStr, captionRaw] = igMatch;
    metaPills.push(`${likes} likes · ${comments} comments`);
    // Shorten "August 4, 2026" -> "Aug 2026"
    const shortDate = dateStr!
      .replace(/^([A-Za-z]{3})[a-z]+\s+\d{1,2},\s+(\d{4})$/, '$1 $2');
    metaPills.push(shortDate);

    const caption = captionRaw!
      .replace(/["”]\.?$/, '')
      .replace(EMOJI_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const tags = (caption.match(/#[a-z0-9_]+/gi) ?? []).slice(0, 2);
    const captionNoTags = caption.replace(/#[a-z0-9_]+/gi, '').replace(/\s+/g, ' ').trim();

    const cleanAuthor = author!.trim();
    const headline =
      captionNoTags.length >= 6
        ? captionNoTags
        : `Post by ${cleanAuthor}`;
    const excerpt =
      tags.length > 0
        ? tags.join(' ')
        : null;

    return {
      id: mention.id,
      url: mention.url,
      hostname,
      platformChip,
      faviconUrl,
      sourceLabel: mention.sourceLabel,
      headline,
      excerpt,
      metaPills,
      riskFlag: mention.riskFlag,
    };
  }

  // Case 1b: Instagram scraped collab ("serialcollect and kyushutcg More options serialcollect Verified Edited•38w Lovebomb...")
  const collabScrape = rawTitle.match(IG_SCRAPE_COLLAB_RE) ?? rawSnippet.match(IG_SCRAPE_COLLAB_RE);
  if (collabScrape && platformChip === 'instagram') {
    const [, firstHandle, secondHandle] = collabScrape;
    const remainder = stripIgScrapeChrome(
      (rawSnippet.length >= rawTitle.length ? rawSnippet : rawTitle)
        .replace(IG_SCRAPE_COLLAB_RE, '')
        .replace(new RegExp(`^\\s*${firstHandle}\\b`, 'i'), ''),
    );
    metaPills.push('Collab post');
    return {
      id: mention.id,
      url: mention.url,
      hostname,
      platformChip,
      faviconUrl,
      sourceLabel: mention.sourceLabel,
      headline: `Collab between @${firstHandle} & @${secondHandle}`,
      excerpt: remainder.length >= 4 ? remainder : null,
      metaPills,
      riskFlag: mention.riskFlag,
    };
  }

  // Case 2: Pipe-separated Instagram / web title ("Beekout | Thank you @serialcollect...")
  const pipeMatch = rawTitle.match(IG_COLLAB_RE);
  if (pipeMatch && platformChip === 'instagram') {
    const [, left, right] = pipeMatch;
    const cleanLeft = left!.replace(EMOJI_RE, '').trim();
    const cleanRight = right!
      .replace(TRAILING_SITE_RE, '')
      .replace(EMOJI_RE, '')
      .replace(/\s*\.\.\.\s*$/, '')
      .trim();
    if (cleanLeft && cleanLeft.length <= 28) {
      metaPills.push(cleanLeft);
    }
    const headline = cleanRight.length >= 6 ? cleanRight : rawTitle.replace(TRAILING_SITE_RE, '').trim();
    const cleanedSnippet = rawSnippet.replace(EMOJI_RE, ' ').replace(/\s+/g, ' ').trim();
    const excerpt =
      cleanedSnippet && !isDuplicateText(headline, cleanedSnippet) && !isDuplicateText(rawTitle, cleanedSnippet)
        ? cleanedSnippet
        : null;

    return {
      id: mention.id,
      url: mention.url,
      hostname,
      platformChip,
      faviconUrl,
      sourceLabel: mention.sourceLabel,
      headline,
      excerpt,
      metaPills,
      riskFlag: mention.riskFlag,
    };
  }

  // Case 3: General web mention (GoFundMe, Reddit, YouTube, news, forums)
  const cleanTitle = rawTitle.replace(TRAILING_SITE_RE, '').replace(EMOJI_RE, ' ').replace(/\s+/g, ' ').trim();
  const cleanSnippet = rawSnippet.replace(EMOJI_RE, ' ').replace(/\s+/g, ' ').trim();

  // If the snippet is just a longer version of a truncated title ("Foo..."), promote snippet as headline!
  const titleTruncated = cleanTitle.endsWith('...') || cleanTitle.endsWith('…');
  let headline = cleanTitle;
  let excerpt: string | null = cleanSnippet || null;

  if (excerpt && isDuplicateText(headline, excerpt)) {
    if (titleTruncated && excerpt.length > headline.length && excerpt.length <= 160) {
      headline = excerpt;
      excerpt = null;
    } else {
      excerpt = null;
    }
  }

  // Also strip leading author/source prefix if redundant with sourceLabel
  if (hostname && !platformChip) {
    metaPills.push(hostname);
  }

  return {
    id: mention.id,
    url: mention.url,
    hostname,
    platformChip,
    faviconUrl,
    sourceLabel: mention.sourceLabel,
    headline,
    excerpt,
    metaPills,
    riskFlag: mention.riskFlag,
  };
}
