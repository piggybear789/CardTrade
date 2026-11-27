import 'server-only';

// lib/enrichment/ebay.ts
//
// Server-only eBay reputation lookup using the eBay OAuth2 client_credentials flow
// and Browse API (`buy/browse/v1/item_summary/search`). Reads credentials from
// `EBAY_CLIENT_ID` / `EBAY_APP_ID` and `EBAY_CLIENT_SECRET` / `EBAY_CERT_ID`.
//
// Never throws on unconfigured env or transient eBay errors — returns a clean
// `EbaySellerSummary` (`found: false` with `note`) so background checks degrade gracefully.

import type {
  EbayFeedbackEntry,
  EbayListingPreview,
  EbayRecentSale,
  EbaySellerSummary,
} from '@/domain/references/enrichment';
import { isValidClaimHandle } from '@/domain/references/reference';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';
const API_SCOPE = 'https://api.ebay.com/oauth/api_scope';

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

let cachedAppToken: CachedToken | null = null;

function ebayCreds(): { clientId: string; clientSecret: string; devId?: string } | null {
  const clientId = (process.env.EBAY_CLIENT_ID ?? process.env.EBAY_APP_ID)?.trim();
  const clientSecret = (process.env.EBAY_CLIENT_SECRET ?? process.env.EBAY_CERT_ID)?.trim();
  const devId = process.env.EBAY_DEV_ID?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, devId };
}

export function isEbayConfigured(): boolean {
  return ebayCreds() !== null;
}

/** Application OAuth token cached in memory across requests until 60s before expiry. */
export async function getEbayAppToken(): Promise<string | null> {
  const creds = ebayCreds();
  if (!creds) return null;

  const now = Date.now();
  if (cachedAppToken && cachedAppToken.expiresAtMs > now + 60_000) {
    return cachedAppToken.accessToken;
  }

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: API_SCOPE,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);

  if (!res?.ok) return null;
  const json = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number }
    | null;
  if (!json?.access_token) return null;

  const expiresInSec = typeof json.expires_in === 'number' ? json.expires_in : 7200;
  cachedAppToken = {
    accessToken: json.access_token,
    expiresAtMs: now + expiresInSec * 1000,
  };
  return cachedAppToken.accessToken;
}

interface BrowseSearchResponse {
  total?: number;
  warnings?: Array<{
    errorId?: number;
    message?: string;
  }>;
  itemSummaries?: Array<{
    title?: string;
    itemWebUrl?: string;
    image?: { imageUrl?: string };
    price?: { value?: string; currency?: string };
    seller?: {
      username?: string;
      feedbackPercentage?: string;
      feedbackScore?: number;
    };
  }>;
}

/**
 * eBay Browse API returns warning `12003` ("A seller 'username' provided in the
 * request filters is invalid.") when the username does NOT exist, and silently drops
 * the seller filter. When a 200 OK response arrives WITHOUT warning 12003, eBay has
 * confirmed the account exists even if they currently have 0 active listings.
 */
export function hasInvalidEbaySellerWarning(data: BrowseSearchResponse | null): boolean {
  if (!data?.warnings || data.warnings.length === 0) return false;
  return data.warnings.some(
    (w) =>
      w.errorId === 12003 ||
      (typeof w.message === 'string' && /seller.*username.*invalid/i.test(w.message)),
  );
}

/** Query eBay Browse API for a seller's active listings on a specific marketplace. */
async function searchBrowseBySeller(
  token: string,
  username: string,
  marketplaceId: 'EBAY_AU' | 'EBAY_US',
  opts: { query?: string; categoryIds?: string },
): Promise<BrowseSearchResponse | null> {
  const url = new URL(BROWSE_SEARCH_URL);
  if (opts.query) url.searchParams.set('q', opts.query);
  if (opts.categoryIds) url.searchParams.set('category_ids', opts.categoryIds);
  url.searchParams.set(
    'filter',
    `sellers:{${username}},buyingOptions:{FIXED_PRICE|AUCTION|BEST_OFFER}`,
  );
  url.searchParams.set('limit', '6');

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);

  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as BrowseSearchResponse | null;
}

/** Parse `<FeedbackScore>` and `<PositiveFeedbackPercent>` from eBay Trading API XML. */
export function parseTradingGetUserXml(xml: string): {
  found: boolean;
  feedbackScore: number | null;
  feedbackPercentage: string | null;
  registrationDate: string | null;
} {
  if (!xml || /<Ack>Failure<\/Ack>/i.test(xml)) {
    return { found: false, feedbackScore: null, feedbackPercentage: null, registrationDate: null };
  }
  const scoreMatch = /<FeedbackScore>(\d+)<\/FeedbackScore>/i.exec(xml);
  const pctMatch = /<PositiveFeedbackPercent>([0-9.]+)<\/PositiveFeedbackPercent>/i.exec(xml);
  const regMatch = /<RegistrationDate>([^<]+)<\/RegistrationDate>/i.exec(xml);
  const userMatch = /<UserID>([^<]+)<\/UserID>/i.exec(xml);
  if (!userMatch && !scoreMatch) {
    return { found: false, feedbackScore: null, feedbackPercentage: null, registrationDate: null };
  }
  return {
    found: true,
    feedbackScore: scoreMatch ? Number.parseInt(scoreMatch[1], 10) : null,
    feedbackPercentage: pctMatch ? pctMatch[1] : null,
    registrationDate: regMatch ? regMatch[1].slice(0, 10) : null,
  };
}

/** Escapes XML text nodes cleanly for eBay Trading API XML requests. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface ParsedEbayFeedbackProfile {
  found: boolean;
  avatarUrl: string | null;
  feedbackScore: number | null;
  feedbackPercentage: string | null;
  positive12m: number | null;
  neutral12m: number | null;
  negative12m: number | null;
  totalFeedback: number | null;
  memberSince: string | null;
  recentSales: EbayRecentSale[];
  /** The newest page of feedback rows. Empty when read from Markdown, which has no row ids. */
  feedbackEntries: EbayFeedbackEntry[];
}

const EMPTY_FDBK: ParsedEbayFeedbackProfile = {
  found: false,
  avatarUrl: null,
  feedbackScore: null,
  feedbackPercentage: null,
  positive12m: null,
  neutral12m: null,
  negative12m: null,
  totalFeedback: null,
  memberSince: null,
  recentSales: [],
  feedbackEntries: [],
};

/** The sales the footprint card lists: the newest feedback rows that name an item. */
const RECENT_SALES_LIMIT = 6;
/** One page of eBay feedback. */
const FEEDBACK_ENTRIES_LIMIT = 25;
const FEEDBACK_COMMENT_MAX = 500;

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return HTML_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** One fragment's text on a single line: tags dropped, entities decoded, spaces collapsed. */
function fragmentText(html: string | undefined): string {
  if (!html) return '';
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A whole page as text, one block element per line, so a pattern that stops at a line
 * end (`Member since: …`) stops where the page's own element does.
 */
function pageText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(?:li|div|p|tr|td|th|h[1-6]|section|ul|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[^\S\n]+/g, ' ');
}

const toCount = (value: string | undefined | null): number | null => {
  if (!value) return null;
  const n = Number.parseInt(value.replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

const RATING_BY_ICON: Record<string, EbayFeedbackEntry['rating']> = {
  positive: 'POSITIVE',
  neutral: 'NEUTRAL',
  negative: 'NEGATIVE',
};

/**
 * The feedback rows of a rendered `fdbk/feedback_profile/<username>` page, newest first:
 *
 *   <tr data-feedback-id="…"> rating icon · comment · item (#id) | Buyer: 4***e (548) ·
 *   AU $300.00 · Verified purchase | More than a year ago </tr>
 *
 * eBay's own "automated Feedback" rows (an order delivered on time, nobody's words) are
 * left out: they are counted in the member's score but are not a person's reference.
 */
export function parseEbayFeedbackEntries(html: string): EbayFeedbackEntry[] {
  const entries: EbayFeedbackEntry[] = [];
  const seen = new Set<string>();
  const rows = html.split(/<tr\s+data-feedback-id="/i).slice(1);
  for (const chunk of rows) {
    if (entries.length >= FEEDBACK_ENTRIES_LIMIT) break;
    const id = /^(\d{6,24})"/.exec(chunk)?.[1];
    if (!id || seen.has(id)) continue;
    const rowEnd = chunk.search(/<\/tr>/i);
    const row = rowEnd === -1 ? chunk : chunk.slice(0, rowEnd);

    const rating = RATING_BY_ICON[/data-test-type="(positive|neutral|negative)"/i.exec(row)?.[1]?.toLowerCase() ?? ''];
    const from = fragmentText(/class="card__from"[^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1]);
    const author = /^(Buyer|Seller):\s*(.+?)\s*(?:\(\s*([\d,]+)\s*\))?$/i.exec(from);
    if (!rating || !author || !author[2]) continue;

    const item = fragmentText(/class="card__item"[^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1]);
    const itemMatch = /^(.*?)\s*\(#(\d{9,14})\)$/.exec(item);
    const comment = fragmentText(/class="card__comment"[^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1]);
    const price = fragmentText(/class="card__price"[^>]*>([\s\S]*?)<\/div>/i.exec(row)?.[1]);
    const lastCell = row.slice(row.lastIndexOf('<td'));
    const when = fragmentText(/<span[^>]*>([\s\S]*?)<\/span>/i.exec(lastCell)?.[1]);

    seen.add(id);
    entries.push({
      id,
      rating,
      comment: comment ? comment.slice(0, FEEDBACK_COMMENT_MAX) : null,
      itemTitle: (itemMatch ? itemMatch[1] : item) || null,
      itemId: itemMatch?.[2] ?? null,
      authorRole: author[1]!.toLowerCase() === 'seller' ? 'SELLER' : 'BUYER',
      authorName: author[2],
      authorScore: toCount(author[3]),
      priceText: price || null,
      verifiedPurchase: /Verified purchase/i.test(row),
      when: when || null,
    });
  }
  return entries;
}

/** Sales rows from Jina's Markdown table, for a page read without its HTML. */
function parseMarkdownRecentSales(raw: string): EbayRecentSale[] {
  // | 2021 Pokemon ... (#285462832378) | Buyer: 4***e(548) AU $300.00 Verified purchase | More than a year ago |
  const recentSales: EbayRecentSale[] = [];
  const rowRe = /^\|\s*([^|\n]{8,220}?)\s*\(#(\d{9,14})\)\s*\|\s*([^|\n]*)\|\s*([^|\n]*)\|/gm;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(raw)) !== null && recentSales.length < RECENT_SALES_LIMIT) {
    const buyerCell = row[3] ?? '';
    const priceMatch = /(?:AU|US|GBP|EUR|C|CA)?\s*[$£€]\s*[\d,]+(?:\.\d{2})?/i.exec(buyerCell);
    recentSales.push({
      title: row[1]!.replace(/\s+/g, ' ').trim(),
      priceText: priceMatch ? priceMatch[0].replace(/\s+/g, ' ').trim() : null,
      when: row[4]?.trim() || null,
      itemId: row[2] ?? null,
    });
  }
  return recentSales;
}

/**
 * Parse feedback score, positive %, 12m breakdown, member-since, recent sales and the
 * feedback rows from eBay's public `fdbk/feedback_profile/<username>` page. Reads the
 * rendered HTML (which carries the rows) or Jina's Markdown (summary and sales only).
 */
export function parseEbayFeedbackProfileHtml(raw: string): ParsedEbayFeedbackProfile {
  if (!raw || raw.includes('"serviceName":"splashui"') || /Security measure \| eBay/i.test(raw)) {
    return EMPTY_FDBK;
  }

  const isHtml = /<(?:html|body|table|div)\b/i.test(raw);
  const text = isHtml ? pageText(raw) : raw;

  // The score is read from the page's own data or its accessible label, so from `raw`.
  const scoreMatch =
    /"feedbackScore"\s*:\s*\{[\s\S]{0,220}?"text"\s*:\s*"([\d,]+)"/i.exec(raw) ??
    /Feedback score is ([\d,]+)/i.exec(raw) ??
    /\]\(https?:\/\/www\.ebay\.[^)]+\/usr\/[^)]+\)\(\s*([\d,]+)\s*\)/i.exec(raw);

  const feedbackScore = toCount(scoreMatch?.[1]);
  const feedbackPercentage = /Positive Feedback(?:\s*\([^)]*\))?\s*:\s*([0-9.]+)%/i.exec(text)?.[1] ?? null;
  const positive12m = toCount(/Positive feedback\s*:\s*([\d,]+)/i.exec(text)?.[1]);
  const negative12m = toCount(/Negative feedback\s*:\s*([\d,]+)/i.exec(text)?.[1]);
  const neutral12m = toCount(/aria-label="([\d,]+) neutral feedback in last 12 months"/i.exec(raw)?.[1]);
  const totalFeedback = toCount(/([\d,]+)\s+feedback received/i.exec(text)?.[1]);
  const memberSince = /Member since:\s*([^\n<"\\]{3,60})/i.exec(text)?.[1]?.trim() ?? null;

  // HTML: the member's own picture only (the page also carries item pictures). Markdown
  // keeps no `alt`, and its first eBay-hosted picture is the member's.
  const avatarSrc = isHtml
    ? (/<img\b[^>]*\bsrc="(https:\/\/i\.ebayimg\.com\/[^"]+)"[^>]*\balt="User profile for/i.exec(raw)?.[1] ??
      /<img\b[^>]*\balt="User profile for[^"]*"[^>]*\bsrc="(https:\/\/i\.ebayimg\.com\/[^"]+)"/i.exec(raw)?.[1])
    : /https:\/\/i\.ebayimg\.com\/images\/g\/[A-Za-z0-9_-]+\/s-l\d+\.(?:jpg|jpeg|png|webp)/i.exec(raw)?.[0];
  const avatarUrl = avatarSrc ? avatarSrc.replace(/\/s-l\d+\./i, '/s-l300.') : null;

  const feedbackEntries = isHtml ? parseEbayFeedbackEntries(raw) : [];
  const recentSales: EbayRecentSale[] = isHtml
    ? feedbackEntries
        .filter((entry) => entry.authorRole === 'BUYER' && entry.itemTitle !== null)
        .slice(0, RECENT_SALES_LIMIT)
        .map((entry) => ({
          title: entry.itemTitle!,
          priceText: entry.priceText,
          when: entry.when,
          itemId: entry.itemId,
        }))
    : parseMarkdownRecentSales(raw);

  if (
    feedbackScore === null &&
    !feedbackPercentage &&
    !memberSince &&
    recentSales.length === 0 &&
    feedbackEntries.length === 0
  ) {
    return EMPTY_FDBK;
  }

  return {
    found: true,
    avatarUrl,
    feedbackScore,
    feedbackPercentage,
    positive12m,
    neutral12m,
    negative12m,
    totalFeedback,
    memberSince,
    recentSales,
    feedbackEntries,
  };
}

/** One Jina Reader read of a page, as Markdown or as the page's HTML. Empty on any failure. */
async function readViaJina(pageUrl: string, format: 'markdown' | 'html', timeoutMs: number): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${pageUrl}`, {
    headers: {
      Accept: 'text/plain',
      ...(format === 'html' ? { 'X-Return-Format': 'html' } : {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);
  if (!res?.ok) return '';
  return res.text().catch(() => '');
}

/** The HTML read, with any field it is missing taken from the Markdown read. */
function mergeFeedbackReads(
  html: ParsedEbayFeedbackProfile,
  markdown: ParsedEbayFeedbackProfile,
): ParsedEbayFeedbackProfile {
  if (!html.found) return markdown;
  return {
    found: true,
    avatarUrl: html.avatarUrl ?? markdown.avatarUrl,
    feedbackScore: html.feedbackScore ?? markdown.feedbackScore,
    feedbackPercentage: html.feedbackPercentage ?? markdown.feedbackPercentage,
    positive12m: html.positive12m ?? markdown.positive12m,
    neutral12m: html.neutral12m ?? markdown.neutral12m,
    negative12m: html.negative12m ?? markdown.negative12m,
    totalFeedback: html.totalFeedback ?? markdown.totalFeedback,
    memberSince: html.memberSince ?? markdown.memberSince,
    recentSales: html.recentSales.length > 0 ? html.recentSales : markdown.recentSales,
    feedbackEntries: html.feedbackEntries,
  };
}

/**
 * Fetches eBay's public feedback profile (`fdbk/feedback_profile/<username>`) via
 * Jina Reader (bypasses eBay's `splashui` CAPTCHA reliably without a browser) to
 * surface real feedback score, 12m breakdown, member-since date, and the feedback rows.
 *
 * TWO READS, IN THIS ORDER. The Markdown read is the one that makes Jina render the page
 * in a browser; it carries the summary and the sales but drops each row's rating, id
 * and comment. Asked for HTML first, Jina returns eBay's unrendered shell (a script tag
 * and nothing else). Asked for HTML straight after the Markdown read, it returns the
 * page it just rendered, rows included. So the summary never depends on the HTML read:
 * if that comes back as the shell, the member's score and sales still stand and only
 * the rows are missing (`feedbackEntries: []`) until the lookup is next refreshed.
 */
async function fetchEbayFeedbackProfile(
  username: string,
): Promise<ParsedEbayFeedbackProfile> {
  const encoded = encodeURIComponent(username);
  const pages = [
    `https://www.ebay.com.au/fdbk/feedback_profile/${encoded}`,
    `https://www.ebay.com/fdbk/feedback_profile/${encoded}`,
  ];
  for (const page of pages) {
    const markdown = parseEbayFeedbackProfileHtml(await readViaJina(page, 'markdown', 14_000));
    if (!markdown.found) continue;
    const html = parseEbayFeedbackProfileHtml(await readViaJina(page, 'html', 8_000));
    return mergeFeedbackReads(html, markdown);
  }
  return EMPTY_FDBK;
}

/** The feedback-profile fields every found seller carries, whichever lookup found them. */
function feedbackFields(fdbk: ParsedEbayFeedbackProfile) {
  return {
    avatarUrl: fdbk.avatarUrl,
    memberSince: fdbk.memberSince,
    positive12m: fdbk.positive12m,
    neutral12m: fdbk.neutral12m,
    negative12m: fdbk.negative12m,
    totalFeedback: fdbk.totalFeedback,
    recentSales: fdbk.recentSales,
    feedbackEntries: fdbk.feedbackEntries,
  };
}

/** Fallback lookup via Trading API `GetUser` (works even when a seller has 0 active listings). */
async function lookupTradingUser(token: string, username: string): Promise<ReturnType<typeof parseTradingGetUserXml>> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <UserID>${escapeXml(username)}</UserID>
</GetUserRequest>`;

  const res = await fetch(TRADING_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-SITEID': '15', // Australia (also resolves global eBay UserIDs)
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1271',
      'X-EBAY-API-CALL-NAME': 'GetUser',
      'X-EBAY-API-IAF-TOKEN': token,
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);

  if (!res?.ok) {
    return { found: false, feedbackScore: null, feedbackPercentage: null, registrationDate: null };
  }
  const xml = await res.text().catch(() => '');
  return parseTradingGetUserXml(xml);
}

/** Parse a Browse API response into our normalized seller summary. */
export function normalizeBrowseSellerResponse(
  username: string,
  oauthVerified: boolean,
  data: BrowseSearchResponse | null,
): EbaySellerSummary | null {
  const wanted = username.trim().toLowerCase();
  // eBay Browse API silently ignores `filter=sellers:{x}` when `x` is not an active
  // seller, returning the entire marketplace catalog. Only accept items whose seller
  // username matches the requested handle case-insensitively.
  const items = (data?.itemSummaries ?? []).filter(
    (item) => item.seller?.username?.trim().toLowerCase() === wanted,
  );
  if (items.length === 0) return null;

  const firstSeller = items[0]!.seller;
  const resolvedName = firstSeller?.username ?? username;
  const sampleListings: EbayListingPreview[] = items
    .filter((i) => i.title && i.itemWebUrl)
    .slice(0, 4)
    .map((i) => ({
      title: i.title!,
      priceText:
        i.price?.value && i.price?.currency ? `${i.price.currency} ${i.price.value}` : null,
      itemUrl: i.itemWebUrl!,
      imageUrl: i.image?.imageUrl ?? null,
    }));

  return {
    username: resolvedName,
    found: true,
    oauthVerified,
    feedbackScore: typeof firstSeller?.feedbackScore === 'number' ? firstSeller.feedbackScore : null,
    feedbackPercentage: firstSeller?.feedbackPercentage ?? null,
    activeListingsCount: typeof data?.total === 'number' ? data.total : items.length,
    profileUrl: `https://www.ebay.com/usr/${encodeURIComponent(resolvedName)}`,
    sampleListings,
    note: null,
  };
}

/**
 * Look up an eBay username's public seller footprint (feedback score, positive %,
 * active listings, and optional Trading `GetUser` fallback when 0 listings are active).
 */
export async function lookupEbaySeller(
  rawUsername: string,
  options: { oauthVerified?: boolean } = {},
): Promise<EbaySellerSummary> {
  const username = rawUsername.trim().replace(/^@/, '');
  const oauthVerified = Boolean(options.oauthVerified);
  const profileUrl = `https://www.ebay.com/usr/${encodeURIComponent(username)}`;

  if (!isValidClaimHandle('ebay', username)) {
    return {
      username,
      found: false,
      oauthVerified,
      feedbackScore: null,
      feedbackPercentage: null,
      activeListingsCount: 0,
      profileUrl,
      sampleListings: [],
      note: 'Not a valid eBay username.',
    };
  }

  const token = await getEbayAppToken();
  if (!token) {
    return {
      username,
      found: false,
      oauthVerified,
      feedbackScore: null,
      feedbackPercentage: null,
      activeListingsCount: 0,
      profileUrl,
      sampleListings: [],
      note: 'eBay API credentials are not configured.',
    };
  }

  // Query TCG & Sports categories + broad terms on AU & US (including auctions & best offers).
  const [auTcg, usTcg, auCat, auSports] = await Promise.all([
    searchBrowseBySeller(token, username, 'EBAY_AU', { query: '(pokemon,tcg,card,slab,graded)' }),
    searchBrowseBySeller(token, username, 'EBAY_US', { query: '(pokemon,tcg,card,slab,graded)' }),
    searchBrowseBySeller(token, username, 'EBAY_AU', { categoryIds: '2536' }),
    searchBrowseBySeller(token, username, 'EBAY_AU', { categoryIds: '212' }),
  ]);

  const primary =
    normalizeBrowseSellerResponse(username, oauthVerified, auTcg) ??
    normalizeBrowseSellerResponse(username, oauthVerified, auCat) ??
    normalizeBrowseSellerResponse(username, oauthVerified, auSports) ??
    normalizeBrowseSellerResponse(username, oauthVerified, usTcg);
  if (primary) {
    // Also pull member-since, 12m breakdown & verified sold history cleanly.
    const fdbk = await fetchEbayFeedbackProfile(primary.username);
    return {
      ...primary,
      ...feedbackFields(fdbk),
      feedbackScore: primary.feedbackScore ?? fdbk.feedbackScore,
      feedbackPercentage: primary.feedbackPercentage ?? fdbk.feedbackPercentage,
    };
  }

  // Did eBay explicitly confirm this username exists (200 OK with NO errorId 12003 warning)?
  const accountConfirmedByBrowse = [auTcg, usTcg, auCat, auSports].some(
    (resp) => resp !== null && typeof resp.total === 'number' && !hasInvalidEbaySellerWarning(resp),
  );

  // Only bother running the broad non-TCG sweep if the username is valid.
  if (accountConfirmedByBrowse) {
    const [auBroad, usBroad, fdbk] = await Promise.all([
      searchBrowseBySeller(token, username, 'EBAY_AU', { query: '(a,e,i,o,u,1,2)' }),
      searchBrowseBySeller(token, username, 'EBAY_US', { query: '(a,e,i,o,u,1,2)' }),
      fetchEbayFeedbackProfile(username),
    ]);
    const broad =
      normalizeBrowseSellerResponse(username, oauthVerified, auBroad) ??
      normalizeBrowseSellerResponse(username, oauthVerified, usBroad);
    if (broad) {
      return {
        ...broad,
        ...feedbackFields(fdbk),
        feedbackScore: broad.feedbackScore ?? fdbk.feedbackScore,
        feedbackPercentage: broad.feedbackPercentage ?? fdbk.feedbackPercentage,
      };
    }

    return {
      username,
      found: true,
      oauthVerified,
      ...feedbackFields(fdbk),
      feedbackScore: fdbk.feedbackScore,
      feedbackPercentage: fdbk.feedbackPercentage,
      activeListingsCount: 0,
      profileUrl: `https://www.ebay.com.au/fdbk/feedback_profile/${encodeURIComponent(username)}`,
      sampleListings: [],
      note: fdbk.memberSince
        ? `Member since ${fdbk.memberSince}`
        : fdbk.feedbackScore !== null
          ? '0 active listings right now'
          : 'No active listings. Open their profile to see feedback',
    };
  }

  // Fallback to Trading API GetUser (returns feedback score when configured with user token).
  const tradingUser = await lookupTradingUser(token, username);
  if (tradingUser.found) {
    return {
      username,
      found: true,
      oauthVerified,
      avatarUrl: null,
      feedbackScore: tradingUser.feedbackScore,
      feedbackPercentage: tradingUser.feedbackPercentage,
      activeListingsCount: 0,
      profileUrl,
      sampleListings: [],
      memberSince: tradingUser.registrationDate,
      // The Trading API answers with a score only; no feedback page was read.
      feedbackEntries: [],
      note: tradingUser.registrationDate
        ? `Member since ${tradingUser.registrationDate}`
        : 'eBay account found (0 active listings right now).',
    };
  }

  return {
    username,
    found: false,
    oauthVerified,
    feedbackScore: null,
    feedbackPercentage: null,
    activeListingsCount: 0,
    profileUrl,
    sampleListings: [],
    note: 'No eBay account matched this username.',
  };
}
