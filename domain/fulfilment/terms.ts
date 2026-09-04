// domain/fulfilment/terms.ts
//
// Validation and normalization of fulfilment terms, shared by Cash_Sales and
// 2-way Trades.
//
// Both flows previously validated this themselves — the cash sale in its
// orchestrator AND again in `update_cash_sale_terms`, the trade in
// `updateTradeHandoverTerms` — and the two disagreed. A trade meeting point could
// be free text with a fallback map centre, and a trade meeting time was optional.
// Neither is acceptable now that the meeting instant starts the inspection clock.
//
// Pure: no Supabase, React, service, or `lib/` imports. Money is integer AUD cents
// and never formatted here; display strings live in `lib/handover/terms.ts`, which
// is allowed to reach for `formatAud`.

import type {
  DeliveryAddress,
  FulfilmentMethod,
  FulfilmentTerms,
  FulfilmentValidation,
  ResolvedPlace,
} from './types';

/**
 * Upper bound on agreed postage, in integer AUD cents.
 *
 * Mirrors `DEAL_DELIVERY_COST_MAX` in `lib/marketplace-constants.ts`. Duplicated
 * rather than imported because `domain/` must not depend on `lib/`; the two are
 * asserted equal by a unit test so they cannot drift.
 */
export const DELIVERY_COST_MAX_CENTS = 99_999_999_999;

/** Prefixes a place id carries when it did NOT come from the address provider. */
const UNRESOLVED_PLACE_PREFIXES = ['text:', 'legacy:'] as const;

/** True when `lat`/`lng` are finite and within real-world bounds. */
export function hasValidCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * True when a place came from the address provider and may therefore become a
 * contractual location.
 *
 * A `text:` id means the member typed something the provider did not recognise; a
 * `legacy:` id means the row predates resolved places. Both are displayable and
 * neither is agreeable.
 */
export function isResolvedPlace(
  place: Partial<ResolvedPlace> | null | undefined,
): place is ResolvedPlace {
  if (!place?.placeId || !place.label?.trim()) return false;
  if (UNRESOLVED_PLACE_PREFIXES.some((prefix) => place.placeId!.startsWith(prefix))) {
    return false;
  }
  return hasValidCoords(place.lat, place.lng);
}

/** True when a stored delivery address is a resolved one the owner may edit. */
export function isResolvedAddress(
  address: DeliveryAddress | null | undefined,
): boolean {
  if (!address) return false;
  return isResolvedPlace({
    label: address.label,
    placeId: address.placeId,
    lat: address.lat ?? Number.NaN,
    lng: address.lng ?? Number.NaN,
  });
}

/** Options that differ between the two flows and between the two participants. */
export interface ValidateFulfilmentOptions {
  /**
   * Require the actor to have supplied their own postal address for `DELIVERY`.
   *
   * True for the Cash_Sale Buyer and for BOTH traders on a Trade; false for the
   * Cash_Sale Seller, who receives nothing by post.
   */
  requireDeliveryAddress?: boolean;
  /** The actor's own address, when one is required. */
  deliveryAddress?: DeliveryAddress | null;
  /** Clock seam so "a meeting must be in the future" is testable. */
  now?: () => Date;
  /** Cap on agreed postage. Defaults to {@link DELIVERY_COST_MAX_CENTS}. */
  maxDeliveryCostCents?: number;
  /**
   * Which handover methods this flow accepts. Omitted means both.
   *
   * Trades pass `['IN_PERSON']`. A trade's collateral is a card authorisation that
   * lapses in about a week and cannot be extended on this account, and postage in
   * both directions plus an inspection window does not fit inside that — no amount of
   * scheduling makes it fit, because nobody controls the post. A Cash_Sale's money is
   * captured at agreement and outlives anything, so it still posts.
   */
  allowedMethods?: readonly FulfilmentMethod[];
  /**
   * How far ahead a meeting may be scheduled, in hours. Omitted means no limit.
   *
   * OPT-IN RATHER THAN DEFAULTED, because the two flows have genuinely different
   * answers. A Trade is backed by a card authorisation that lapses in about a week,
   * so a distant meeting leaves the handover unprotected; a Cash_Sale's money is
   * already collected into the platform balance and outlives anything. Defaulting
   * the cap would impose a trade's constraint on a sale that has no reason for it.
   *
   * Trades pass {@link import('./inspection').MAX_MEETING_LEAD_HOURS}.
   */
  maxMeetingLeadHours?: number;
}

/**
 * Validate a complete set of fulfilment terms.
 *
 * A meeting time is REQUIRED, not optional. It used to be optional on trades,
 * which is no longer tenable: the inspection window of a face-to-face trade is
 * measured from the meeting instant, so an absent one leaves the trade with no
 * clock and its collateral racing the card authorisation with nothing to stop it.
 */
export function validateFulfilmentTerms(
  terms: FulfilmentTerms,
  options: ValidateFulfilmentOptions = {},
): FulfilmentValidation {
  const now = options.now ?? (() => new Date());
  const maxCost = options.maxDeliveryCostCents ?? DELIVERY_COST_MAX_CENTS;

  if (terms.method !== 'IN_PERSON' && terms.method !== 'DELIVERY') {
    return { ok: false, error: 'method-required' };
  }

  // Checked before anything method-specific, so a trade asked to post is refused for
  // the reason that is true — the method is not on offer — rather than falling through
  // to a complaint about a missing postage cost.
  if (options.allowedMethods && !options.allowedMethods.includes(terms.method)) {
    return { ok: false, error: 'method-not-supported' };
  }

  if (terms.method === 'IN_PERSON') {
    const place = terms.meeting.place;
    if (!place?.label?.trim()) {
      return { ok: false, error: 'meeting-place-required' };
    }
    if (!isResolvedPlace(place)) {
      return { ok: false, error: 'meeting-place-unresolved' };
    }
    if (!terms.meeting.at) {
      return { ok: false, error: 'meeting-time-required' };
    }
    const at = new Date(terms.meeting.at);
    if (!Number.isFinite(at.getTime())) {
      return { ok: false, error: 'meeting-time-required' };
    }
    if (at.getTime() <= now().getTime()) {
      return { ok: false, error: 'meeting-time-past' };
    }
    // The collateral has to still be alive when the handover is inspected, or a
    // face-to-face scam surfaces after the only money that could answer for it has
    // been released. See `MAX_MEETING_LEAD_HOURS` for where the number comes from.
    if (options.maxMeetingLeadHours != null) {
      const latest = now().getTime() + options.maxMeetingLeadHours * 3_600_000;
      if (at.getTime() > latest) {
        return { ok: false, error: 'meeting-time-too-far' };
      }
    }
    return { ok: true };
  }

  const cost = terms.delivery.costCents;
  if (cost == null) {
    return { ok: false, error: 'delivery-cost-required' };
  }
  if (!Number.isInteger(cost) || cost < 0 || cost > maxCost) {
    return { ok: false, error: 'delivery-cost-invalid' };
  }

  if (options.requireDeliveryAddress) {
    if (!options.deliveryAddress?.label?.trim()) {
      return { ok: false, error: 'delivery-address-required' };
    }
    if (!isResolvedAddress(options.deliveryAddress)) {
      return { ok: false, error: 'delivery-address-unresolved' };
    }
  }

  return { ok: true };
}

/**
 * True when the *stored* terms are specified enough to act on, ignoring who is
 * asking. Used by the rooms to decide whether the fulfilment step is done.
 *
 * Weaker than {@link validateFulfilmentTerms} on purpose: it accepts terms that
 * were agreed before a rule tightened, so an in-flight contract does not become
 * unreadable when policy changes.
 */
export function areFulfilmentTermsComplete(terms: FulfilmentTerms): boolean {
  if (terms.method === 'IN_PERSON') {
    return Boolean(terms.meeting.place?.label?.trim());
  }
  if (terms.method === 'DELIVERY') {
    return terms.delivery.costCents != null;
  }
  return false;
}

/**
 * Blank the fields belonging to the method that was NOT chosen.
 *
 * Both flows do this so a set of terms can only ever describe one arrangement —
 * a row carrying both a meeting point and a postage price has two answers to one
 * question, and the reader picks.
 */
export function normalizeFulfilmentTerms(terms: FulfilmentTerms): FulfilmentTerms {
  if (terms.method === 'IN_PERSON') {
    const place = terms.meeting.place;
    return {
      method: 'IN_PERSON',
      meeting: {
        place: place
          ? {
              label: place.label.trim(),
              placeId: place.placeId,
              lat: place.lat,
              lng: place.lng,
              countryCode: place.countryCode ?? null,
            }
          : null,
        at: terms.meeting.at ?? null,
      },
      delivery: { costCents: null, notes: null },
    };
  }

  if (terms.method === 'DELIVERY') {
    const cost = terms.delivery.costCents;
    return {
      method: 'DELIVERY',
      meeting: { place: null, at: null },
      delivery: {
        costCents: cost == null ? null : Math.trunc(cost),
        notes: terms.delivery.notes?.trim() || null,
      },
    };
  }

  return {
    method: null,
    meeting: { place: null, at: null },
    delivery: { costCents: null, notes: null },
  };
}

/** Convenience read: does this method post goods rather than hand them over? */
export function isDelivery(method: FulfilmentMethod | null): boolean {
  return method === 'DELIVERY';
}

/** Convenience read: does this method meet in person? */
export function isInPerson(method: FulfilmentMethod | null): boolean {
  return method === 'IN_PERSON';
}

/** An empty set of terms, for a contract whose method has not been chosen. */
export function emptyFulfilmentTerms(): FulfilmentTerms {
  return {
    method: null,
    meeting: { place: null, at: null },
    delivery: { costCents: null, notes: null },
  };
}
