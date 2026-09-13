// design/compare/surfaces.mjs
//
// The one list of surfaces the comparison canvas is built from: where each one lives in
// the APP, and which frame of the hand-drawn board it is supposed to correspond to.
//
// WHY THE MAPPING IS EXPLICIT AND NOT INFERRED. The board's plate ids and the app's
// routes were chosen independently — `lists` is three routes, `mine` is My listings on
// desktop and Saved on the phone frame, and `thread` has two phone frames and no desktop
// one at all. Anything clever enough to guess that would be wrong silently. A table is
// wrong loudly.
//
// `board` is `sheet#plate:kind:index` — the sheet file, the `.plate` id, `d` for a
// `.vp-d` desktop frame or `m` for `.vp-m`, and which of that kind within the plate
// (0-based). `null` means the board never drew this surface, which is itself worth
// showing.

/** Seeded members from tests/e2e/support/users.ts, by the storageState file they own. */
export const AS = {
  ANON: null,
  ALICE: 'alice',
  FRANK: 'frank',
  GRACE: 'grace',
};

/** Fixed ids from the demo world seeded into `cardtrade` (all `[E2E]` marked). */
export const DEMO = {
  charizard: 'e2e00001-0000-0000-0000-000000000001',
  binder: 'e2e00001-0000-0000-0000-000000000004',
  alice: '11111111-1111-1111-1111-111111111111',
  // Alice SELLING, INSPECTION, delivery with tracking — the richest cash room.
  saleInspection: 'e2e00002-0000-0000-0000-000000000003',
  // Alice BUYING, DISPUTED, with a reason on the record.
  saleDisputed: 'e2e00002-0000-0000-0000-000000000008',
  // Alice + Carol, COLLATERAL_LOCKED, both holds ACTIVE, posted both ways.
  tradeLocked: 'e2e00004-0000-0000-0000-000000000002',
  // Dave -> Alice, NEGOTIATING, nothing accepted.
  tradeNegotiating: 'e2e00004-0000-0000-0000-000000000001',
  // A plain enquiry thread: item, no contract, so no contract badge.
  threadEnquiry: 'e2e00005-0000-0000-0000-000000000001',
};

export const SURFACES = [
  // ---- discovery -----------------------------------------------------------
  { id: 'catalog', label: 'Catalog / homepage', url: '/', as: AS.ALICE,
    board: '01-discovery.html#catalog' },
  { id: 'listing', label: 'Listing detail — single', url: `/listings/${DEMO.charizard}`, as: AS.ALICE,
    board: '01-discovery.html#listing' },
  { id: 'listing-binder', label: 'Listing detail — binder', url: `/listings/${DEMO.binder}`, as: AS.ALICE,
    board: null },
  { id: 'create', label: 'Create listing', url: '/listings/new', as: AS.ALICE,
    board: '01-discovery.html#create' },
  { id: 'mine', label: 'My listings', url: '/listings/mine', as: AS.ALICE,
    board: '01-discovery.html#mine' },
  { id: 'saved', label: 'Saved', url: '/saved', as: AS.ALICE,
    board: '01-discovery.html#mine:m:0' },
  { id: 'seller', label: 'Seller profile', url: `/sellers/${DEMO.alice}`, as: AS.ALICE,
    board: '01-discovery.html#seller' },

  // ---- entry ---------------------------------------------------------------
  { id: 'signin', label: 'Sign in', url: '/sign-in', as: AS.ANON,
    board: '02-entry.html#signin' },
  { id: 'signup', label: 'Sign up', url: '/sign-up', as: AS.ANON,
    board: '02-entry.html#signup' },
  { id: 'recover', label: 'Password recovery', url: '/forgot-password', as: AS.ANON,
    board: '02-entry.html#recover' },
  // THE PHONE FRAME, EXPLICITLY. `#identity` holds two frames that are different
  // SURFACES, not two widths of one: the desktop frame is the onboarding wizard's seller
  // step and only the phone frame is this tab. Pointing at the plate paired this route
  // against the wizard and invited a comparison between two screens that are not
  // supposed to match. The wizard step has no entry here because every seeded member is
  // already onboarded, so `/onboarding` redirects away from it.
  { id: 'verification', label: 'Identity / verification tab', url: '/profile?tab=verification', as: AS.ALICE,
    board: '02-entry.html#identity:m:0' },

  // ---- contracts -----------------------------------------------------------
  { id: 'sales', label: 'Sales list', url: '/sales', as: AS.ALICE,
    board: '03-contracts.html#lists' },
  { id: 'purchases', label: 'Purchases list', url: '/purchases', as: AS.ALICE,
    board: '03-contracts.html#lists' },
  { id: 'trades', label: 'Trades list', url: '/trades', as: AS.ALICE,
    board: '03-contracts.html#lists' },
  { id: 'sales-needs-you', label: 'Sales — Needs you filter', url: '/sales?show=needs-you', as: AS.ALICE,
    board: null },
  { id: 'offers', label: 'Offers', url: '/offers', as: AS.ALICE,
    board: '03-contracts.html#offers' },
  { id: 'cashroom', label: 'Cash sale room — INSPECTION', url: `/sales/${DEMO.saleInspection}`, as: AS.ALICE,
    board: '03-contracts.html#cashroom' },
  { id: 'dispute', label: 'Cash sale room — DISPUTED', url: `/sales/${DEMO.saleDisputed}`, as: AS.ALICE,
    board: '03-contracts.html#dispute' },
  { id: 'traderoom', label: 'Trade room — COLLATERAL_LOCKED', url: `/trades/${DEMO.tradeLocked}`, as: AS.ALICE,
    board: '03-contracts.html#traderoom' },
  { id: 'tradenegotiating', label: 'Trade room — NEGOTIATING', url: `/trades/${DEMO.tradeNegotiating}`, as: AS.ALICE,
    board: null },

  // ---- comms + account -----------------------------------------------------
  { id: 'inbox', label: 'Messages inbox', url: '/messages', as: AS.ALICE,
    board: '04-comms-account.html#inbox' },
  { id: 'thread', label: 'Message thread', url: `/messages/${DEMO.threadEnquiry}`, as: AS.ALICE,
    board: '04-comms-account.html#thread:m:0' },
  { id: 'notifications', label: 'Notifications', url: '/notifications', as: AS.ALICE,
    board: '04-comms-account.html#notifications' },
  { id: 'profile', label: 'Profile & settings', url: '/profile', as: AS.ALICE,
    board: '04-comms-account.html#profile' },
  { id: 'payouts', label: 'Payouts', url: '/profile?tab=payouts', as: AS.ALICE,
    board: '04-comms-account.html#payouts' },

  // ---- admin + system ------------------------------------------------------
  { id: 'admin', label: 'Admin operations', url: '/admin', as: AS.FRANK,
    board: '05-admin-system.html#admin' },
  { id: 'queue', label: 'Arbitration queue', url: '/admin/arbitration', as: AS.GRACE,
    board: '05-admin-system.html#queue' },
  { id: 'help', label: 'Help', url: '/help', as: AS.ANON,
    board: '05-admin-system.html#help' },
  { id: 'terms', label: 'Terms', url: '/terms', as: AS.ANON,
    board: '05-admin-system.html#help:m:0' },
];

/** The two viewports the board draws, matched here so a comparison is like-for-like. */
export const VIEWPORTS = [
  // The board's desktop frame is a 1280 stage; shoot at 1440 so the app's own
  // `lg` rail behaves as it does on a real laptop, and note the difference.
  { key: 'desktop', width: 1440, height: 1100 },
  { key: 'phone', width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
];
