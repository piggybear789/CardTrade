// domain/services/tracking/carriers.ts
//
// THE CARRIER LIST, ONCE. What a member can pick, what Ship24 calls it, and where the
// public tracking page for a number is.
//
// It was three lists. `RecordShipmentDialog` held the options a seller picks;
// `ManualTrackingService` held a URL map keyed on lowercased display names;
// `Ship24TrackingService` held a courier-code map keyed the same way PLUS a second copy
// of the URL map keyed on slugs instead. The comment on that second copy said "same map
// as ManualTrackingService", which is the tell: two lists that have to agree and no
// mechanism making them.
//
// They agreed by luck, and the luck was load-bearing. `tracking_carrier` is a free-text
// column, the lookups are `carrier.toLowerCase()`, and a value that misses every key
// yields `trackingUrl: null` — so a carrier typed by hand, or renamed in the select
// alone, silently costs the buyer the Track link and costs us the Ship24 registration
// that starts the inspection clock. Nothing errors; the parcel just stops being
// followable.
//
// REGION. These are the couriers an Australian collectibles seller actually uses, plus
// the four global integrators. `product.md` is explicit that a second trading region
// turns several AU-only constants into per-region lookups, and this is one of them —
// when that happens, give `Carrier` a region field rather than starting a second list.

/** One carrier a member can name on a posted contract. */
export interface Carrier {
  /**
   * What the member picks, and what is persisted in `tracking_carrier` /
   * `initiator_tracking_carrier`. Display text doubles as the stored value because the
   * column is text and existing rows already hold these exact strings.
   */
  label: string;
  /** Ship24's courier code, where Ship24 carries this courier. */
  ship24?: string;
  /** The carrier's public tracking page for a number. */
  trackingUrl?: (trackingNumber: string) => string;
  /**
   * Other spellings that must resolve to this carrier — legacy free-text rows and the
   * obvious abbreviations. Matched case-insensitively.
   */
  aliases?: readonly string[];
}

export const CARRIERS: readonly Carrier[] = [
  {
    label: 'Australia Post',
    ship24: 'australia-post',
    aliases: ['auspost', 'australia-post'],
    trackingUrl: (n) =>
      `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(n)}`,
  },
  {
    // StarTrack is Australia Post's courier arm and shares its tracking page.
    label: 'StarTrack',
    ship24: 'startrack',
    aliases: ['star track'],
    trackingUrl: (n) =>
      `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(n)}`,
  },
  {
    label: 'Sendle',
    ship24: 'sendle',
    trackingUrl: (n) => `https://track.sendle.com/tracking?ref=${encodeURIComponent(n)}`,
  },
  {
    label: 'Aramex',
    ship24: 'aramex',
    // Fastway became Aramex in Australia; sellers still say Fastway.
    aliases: ['fastway'],
    trackingUrl: (n) =>
      `https://www.aramex.com/au/en/track/shipment?q=${encodeURIComponent(n)}`,
  },
  {
    label: 'Couriers Please',
    ship24: 'couriers-please',
    aliases: ['couriersplease', 'couriers-please'],
    trackingUrl: (n) =>
      `https://www.couriersplease.com.au/tools-track?con=${encodeURIComponent(n)}`,
  },
  {
    label: 'DHL',
    ship24: 'dhl',
    trackingUrl: (n) =>
      `https://www.dhl.com/au-en/home/tracking.html?tracking-id=${encodeURIComponent(n)}`,
  },
  {
    label: 'FedEx',
    ship24: 'fedex',
    trackingUrl: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
  },
  {
    label: 'TNT',
    ship24: 'tnt',
    trackingUrl: (n) =>
      `https://www.tnt.com/express/en_au/site/tracking.html?searchType=con&cons=${encodeURIComponent(n)}`,
  },
  {
    label: 'UPS',
    ship24: 'ups',
    trackingUrl: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  },
];

/**
 * The "not on the list" option.
 *
 * KEPT DELIBERATELY. A seller using a courier we have not listed must still be able to
 * record a shipment — refusing would strand a contract whose goods are already in the
 * post. It costs the automatic tracking (no URL, no Ship24 registration), which is why
 * the UI says so rather than pretending the choice is free.
 */
export const OTHER_CARRIER = 'Other';

/** Labels for a picker, with {@link OTHER_CARRIER} last. */
export const CARRIER_OPTIONS: readonly string[] = [
  ...CARRIERS.map((carrier) => carrier.label),
  OTHER_CARRIER,
];

/** Resolve a stored or typed carrier string to a known carrier, or `null`. */
export function findCarrier(input: string | null | undefined): Carrier | null {
  const needle = input?.trim().toLowerCase();
  if (!needle) return null;
  return (
    CARRIERS.find(
      (carrier) =>
        carrier.label.toLowerCase() === needle ||
        carrier.ship24 === needle ||
        carrier.aliases?.some((alias) => alias.toLowerCase() === needle),
    ) ?? null
  );
}

/** The carrier's public tracking page for this number, or `null` when unknown. */
export function carrierTrackingUrl(
  carrier: string | null | undefined,
  trackingNumber: string,
): string | null {
  const number = trackingNumber.trim();
  if (!number) return null;
  return findCarrier(carrier)?.trackingUrl?.(number) ?? null;
}

/** Ship24's courier code for this carrier, or `null` when Ship24 does not carry it. */
export function ship24CourierCode(carrier: string | null | undefined): string | null {
  return findCarrier(carrier)?.ship24 ?? null;
}
