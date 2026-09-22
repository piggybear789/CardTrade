// lib/seo/structuredData.ts
//
// Builders for the schema.org graphs the public pages emit. Rendered by
// `components/seo/JsonLd.tsx`, which owns the escaping.
//
// WHAT THIS IS FOR. A crawler reads the rendered HTML of a listing and sees a
// heading, some prose and a formatted money string; it cannot tell which of those
// is the price, nor whether the card is still for sale. These graphs state it
// explicitly, which is what makes price, availability and breadcrumb rich results
// possible. They are a RESTATEMENT of what the page already shows an anonymous
// visitor — never an additional disclosure.
//
// Money arrives here as integer minor units, as everywhere else in the codebase.
// `minorToMajor` owns the divisor so a zero-decimal currency is not silently
// divided by 100; the digit count for the string form comes from the same place.

import { minorToMajor, minorUnitDigits } from '@/domain/region';
import { avatarUrl, itemImageUrl } from '@/lib/format';
import { absoluteUrl, SITE_URL } from '@/lib/seo/site';

/**
 * One schema.org node. Loosely typed on purpose: the vocabulary is far larger
 * than anything we would hand-model, and `JSON.stringify` drops `undefined`
 * values, which is what lets the builders below omit a property rather than
 * emit a null a validator would flag.
 */
export interface StructuredData {
  '@type': string;
  [key: string]: unknown;
}

/** Availability of the thing a listing is offering. */
export type ListingAvailability = 'InStock' | 'OutOfStock' | 'SoldOut';

/**
 * Map an internal condition grade onto `schema.org/OfferItemCondition`.
 *
 * The vocabulary has exactly four members, and the TCGplayer scale the listing
 * form uses has seven, so this is lossy by construction — the full grade is
 * preserved as an `additionalProperty` on the Product instead, where it stays
 * machine-readable without being misdeclared.
 *
 * `Unopened` is the only NEW condition: sealed product has never been handled.
 * A graded slab is still a used single, however high the grade.
 */
function conditionUrl(condition: string | null | undefined): string {
  switch ((condition ?? '').trim().toLowerCase()) {
    case 'unopened':
      return 'https://schema.org/NewCondition';
    case 'damaged':
      return 'https://schema.org/DamagedCondition';
    default:
      return 'https://schema.org/UsedCondition';
  }
}

/**
 * Format an integer minor-unit amount as a schema.org price string.
 *
 * A bare number would serialise 1234.5 for $1,234.50 — valid JSON, but Google's
 * price parsing is happier with a fixed-precision string, and the precision has
 * to be the CURRENCY's rather than 2 (a JPY price of `1200.00` overstates the
 * currency's resolution by two digits).
 */
function priceString(minorUnits: number, currency: string): string {
  return minorToMajor(minorUnits, currency).toFixed(minorUnitDigits(currency));
}

/** A seller as the public catalog knows them. */
export interface SellerSeoInput {
  id: string;
  /** PUBLIC display name only — never the verified legal name. */
  displayName: string | null;
  rating: number | null;
  ratingCount: number | null;
  avatarPath?: string | null;
}

/**
 * Build the `Person` node for a seller, with their rating when they have one.
 *
 * THE RATING BELONGS HERE AND NOT ON THE PRODUCT. It is tempting to hang
 * `aggregateRating` off the Product to get stars beside a listing in the SERP,
 * and Google's structured data policy treats that as misleading markup: a
 * Product rating must be about the product, and ours is about the SELLER's
 * trading history. Attached to the seller — the entity it actually describes — it
 * is both accurate and still eligible for seller-rating treatment.
 *
 * `reviewCount` and not `ratingCount`: every rating in `profiles.rating_count`
 * comes from a completed contract's review, so each one has a review behind it.
 */
export function sellerNode(seller: SellerSeoInput): StructuredData {
  const ratingCount = seller.ratingCount ?? 0;
  const hasRating = ratingCount > 0 && seller.rating != null;
  // `avatarUrl`, NOT `itemImageUrl`: avatars are in the `profile-images` bucket
  // and listing photos are in `item-images`. Reaching for the wrong helper fails
  // as a silent 404 rather than a type error, which is why they are separate
  // functions instead of one taking a bucket name.
  const avatar = avatarUrl(seller.avatarPath);

  return {
    '@type': 'Person',
    '@id': absoluteUrl(`/sellers/${seller.id}`),
    name: seller.displayName?.trim() || 'NoDitto seller',
    url: absoluteUrl(`/sellers/${seller.id}`),
    image: avatar ?? undefined,
    aggregateRating: hasRating
      ? {
          '@type': 'AggregateRating',
          ratingValue: Number(seller.rating),
          reviewCount: ratingCount,
          bestRating: 5,
          worstRating: 1,
        }
      : undefined,
  };
}

/** Everything the listing graph needs, resolved by the page. */
export interface ListingSeoInput {
  id: string;
  /** The derived display title, so the derivation is not repeated here. */
  name: string;
  description: string | null;
  category: string | null;
  condition: string | null;
  /** Integer minor units of {@link currency}. */
  fmvCents: number;
  currency: string;
  imagePaths: string[] | null;
  /** A binder/bulk listing prices as a "from" figure covering many cards. */
  isShopfront: boolean;
  availability: ListingAvailability;
  /** ISO 3166-1 alpha-2 of where the goods are, when known. */
  countryCode?: string | null;
  seller: SellerSeoInput;
}

/**
 * Build the `Product` graph for a listing detail page.
 *
 * A SHOPFRONT GETS AN `AggregateOffer`, NOT AN `Offer`. Its `fmv_cents` is an
 * indicative "from" price for a whole inventory rather than the price of a thing
 * (0064), so a plain `Offer.price` would assert a number no buyer can actually
 * pay — the price of a binder contract is the sum of its line items and is not
 * knowable from the listing. `AggregateOffer.lowPrice` says exactly what the
 * figure means and is the one schema.org construct that does.
 */
export function listingStructuredData(listing: ListingSeoInput): StructuredData {
  const url = absoluteUrl(`/listings/${listing.id}`);
  const images = (listing.imagePaths ?? [])
    .map((path) => itemImageUrl(path))
    .filter((src): src is string => Boolean(src));
  const currency = (listing.currency || 'aud').toUpperCase();
  const condition = conditionUrl(listing.condition);

  const offerBase = {
    url,
    priceCurrency: currency,
    availability: `https://schema.org/${listing.availability}`,
    itemCondition: condition,
    seller: sellerNode(listing.seller),
    // Contracts do not cross regions (0065), so the offer is genuinely scoped to
    // the jurisdiction the goods are in rather than open to any visitor who finds
    // the page.
    areaServed: listing.countryCode
      ? { '@type': 'Country', identifier: listing.countryCode }
      : undefined,
  };

  return {
    '@type': 'Product',
    '@id': `${url}#product`,
    name: listing.name,
    url,
    description: listing.description?.trim() || undefined,
    image: images.length > 0 ? images : undefined,
    category: listing.category ?? undefined,
    itemCondition: condition,
    // The full grade, unflattened. `itemCondition` above had to collapse seven
    // grades into four, and the difference between Near Mint and Heavily Played
    // is most of what a card is worth.
    additionalProperty: listing.condition
      ? [
          {
            '@type': 'PropertyValue',
            name: 'Condition',
            value: listing.condition,
          },
        ]
      : undefined,
    offers: listing.isShopfront
      ? {
          '@type': 'AggregateOffer',
          ...offerBase,
          lowPrice: priceString(listing.fmvCents, currency),
        }
      : {
          '@type': 'Offer',
          ...offerBase,
          price: priceString(listing.fmvCents, currency),
        },
  };
}

/** One rung of a breadcrumb trail. `url` is omitted for the current page. */
export interface BreadcrumbRung {
  name: string;
  url?: string;
}

/**
 * Build a `BreadcrumbList` from a trail of rungs.
 *
 * Worth emitting even though the page renders a single "Back to marketplace"
 * link: the trail Google shows in place of the raw URL comes from here, and a
 * category rung earns a listing a breadcrumb naming its card game.
 */
export function breadcrumbStructuredData(trail: BreadcrumbRung[]): StructuredData {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((rung, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: rung.name,
      item: rung.url,
    })),
  };
}

/**
 * Build the `ProfilePage` graph for a public seller profile.
 *
 * `ProfilePage` rather than a bare `Person`, because the page is about the
 * member: it carries their rating and their reviews, and the wrapper is what
 * tells a crawler the reviews describe the subject of the page rather than the
 * site.
 */
export function sellerStructuredData(input: {
  seller: SellerSeoInput;
  bio?: string | null;
  /** Member-supplied social profile URLs, already filtered to valid absolutes. */
  sameAs?: string[];
}): StructuredData {
  const url = absoluteUrl(`/sellers/${input.seller.id}`);
  const person = sellerNode(input.seller);

  return {
    '@type': 'ProfilePage',
    '@id': `${url}#profile`,
    url,
    mainEntity: {
      ...person,
      description: input.bio?.trim() || undefined,
      // Member-authored links. `nofollow` on the rendered anchors keeps them from
      // passing ranking signal; `sameAs` is an identity claim rather than an
      // endorsement, which is the honest reading of "this seller says these
      // accounts are theirs".
      sameAs: input.sameAs && input.sameAs.length > 0 ? input.sameAs : undefined,
    },
  };
}

/**
 * The site-level `Organization` and `WebSite` pair, emitted once from the
 * catalog.
 *
 * The `SearchAction` is what makes a sitelinks searchbox possible. It targets the
 * catalog's real `?q=` parameter — the same one `CatalogView` reads — so a query
 * arriving from Google lands on a working search rather than an ignored param.
 */
export function siteStructuredData(): StructuredData[] {
  const organization: StructuredData = {
    '@type': 'Organization',
    '@id': `${SITE_URL}#organization`,
    name: 'NoDitto',
    url: SITE_URL,
    logo: absoluteUrl('/icon.png'),
    description:
      'Peer-to-peer marketplace for trading cards, with Stripe Identity checks on sellers and collateral-backed swaps.',
  };

  const website: StructuredData = {
    '@type': 'WebSite',
    '@id': `${SITE_URL}#website`,
    name: 'NoDitto',
    url: SITE_URL,
    publisher: { '@id': `${SITE_URL}#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  return [organization, website];
}
