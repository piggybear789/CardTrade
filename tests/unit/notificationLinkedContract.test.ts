// tests/unit/notificationLinkedContract.test.ts
//
// The subject a notification takes from the sale or trade it links to, when its
// producer named none (`lib/notifications/linkedContract.ts`).

import { describe, expect, it } from 'vitest';

import {
  parseContractLink,
  subjectFields,
  type ContractSubject,
} from '@/lib/notifications/linkedContract';
import {
  describeLinkedRows,
  type DescribableRow,
  type SaleContractRow,
  type TradeContractRow,
  type TradeHoldRow,
} from '@/lib/notifications/describeLinkedRows';

const SALE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const BUYER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SELLER = '9b2e1c3a-5d4f-4e6a-8b7c-1d2e3f4a5b6c';
const STAFF = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const subject: ContractSubject = {
  title: 'Charizard Base Set Holo',
  imagePath: 'items/charizard.jpg',
  participants: new Map([
    [BUYER, 'Ana Ng'],
    [SELLER, 'Bob Carter'],
  ]),
};

const bare = { subject_title: null, image_path: null, actor_name: null };

describe('parseContractLink', () => {
  it('reads a sale or a trade link, with or without a tail', () => {
    expect(parseContractLink(`/sales/${SALE}`)).toEqual({ kind: 'sale', id: SALE });
    expect(parseContractLink(`/trades/${SALE.toUpperCase()}?tab=chat`)).toEqual({ kind: 'trade', id: SALE });
    expect(parseContractLink(`/sales/${SALE}#dispute`)?.kind).toBe('sale');
  });

  it('ignores every other link', () => {
    for (const link of ['/offers', `/listings/${SALE}`, `/sales/${SALE}x`, '/sales/new', null, undefined, '']) {
      expect(parseContractLink(link)).toBeNull();
    }
  });
});

describe('subjectFields', () => {
  it("fills the card, its photo and the OTHER party's name for a party to the contract", () => {
    expect(subjectFields({ user_id: BUYER, ...bare }, subject)).toEqual({
      subject_title: 'Charizard Base Set Holo',
      image_path: 'items/charizard.jpg',
      actor_name: 'Bob Carter',
    });
    expect(subjectFields({ user_id: SELLER, ...bare }, subject).actor_name).toBe('Ana Ng');
  });

  it('keeps every value the producer set, field by field', () => {
    const row = { user_id: BUYER, subject_title: 'Charizard (PSA 9)', image_path: null, actor_name: 'bobc' };
    expect(subjectFields(row, subject)).toEqual({
      subject_title: 'Charizard (PSA 9)',
      image_path: 'items/charizard.jpg',
      actor_name: 'bobc',
    });
  });

  it('names nobody when the recipient is not a party, such as staff', () => {
    expect(subjectFields({ user_id: STAFF, ...bare }, subject)).toEqual({
      subject_title: 'Charizard Base Set Holo',
      image_path: 'items/charizard.jpg',
      actor_name: null,
    });
  });

  it('leaves a row alone when its contract could not be read', () => {
    const row = { user_id: BUYER, subject_title: 'Kept', image_path: null, actor_name: null };
    expect(subjectFields(row, undefined)).toEqual({ subject_title: 'Kept', image_path: null, actor_name: null });
  });

  it('treats a blank value as missing, and a closed account as nameless', () => {
    const closed: ContractSubject = { ...subject, participants: new Map([[BUYER, 'Ana Ng'], [SELLER, null]]) };
    expect(subjectFields({ user_id: BUYER, subject_title: '  ', image_path: '', actor_name: null }, closed)).toEqual({
      subject_title: 'Charizard Base Set Holo',
      image_path: 'items/charizard.jpg',
      actor_name: null,
    });
  });

  it('never fills an amount', () => {
    expect(Object.keys(subjectFields({ user_id: BUYER, ...bare }, subject)).sort()).toEqual([
      'actor_name',
      'image_path',
      'subject_title',
    ]);
  });
});

// --- describeLinkedRows: the reads' results mapped onto rows -------------------------

const TRADE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const INITIATOR = BUYER;
const COUNTERPART = SELLER;

function tradeRow(overrides: Record<string, unknown> = {}): TradeContractRow {
  return {
    id: TRADE,
    initiator_id: INITIATOR,
    counterpart_id: COUNTERPART,
    state: 'INSPECTION',
    handover_method: 'IN_PERSON',
    terms_version: 2,
    initiator_terms_accepted_version: 2,
    counterpart_terms_accepted_version: 2,
    initiator_shipped_at: null,
    counterpart_shipped_at: null,
    initiator_received_at: null,
    counterpart_received_at: null,
    initiator_accepted_at: null,
    counterpart_accepted_at: '2026-11-27T01:00:00Z',
    initiator_handover_confirmed_at: '2026-11-26T01:00:00Z',
    counterpart_handover_confirmed_at: '2026-11-26T01:00:00Z',
    initiator_delivery_address_configured: false,
    counterpart_delivery_address_configured: false,
    subject_item: { title: 'Umbreon VMAX Alt Art', image_paths: ['items/umbreon.jpg'] },
    initiator_profile: { display_name: 'Ana Ng' },
    counterpart_profile: { display_name: 'Bob Carter' },
    ...overrides,
  } as unknown as TradeContractRow;
}

const activeHolds: TradeHoldRow[] = [
  { trade_id: TRADE, trader_id: INITIATOR, status: 'ACTIVE', created_at: '2026-11-25T00:00:00Z' },
  { trade_id: TRADE, trader_id: COUNTERPART, status: 'ACTIVE', created_at: '2026-11-25T00:00:00Z' },
];

function saleRow(overrides: Record<string, unknown> = {}): SaleContractRow {
  return {
    id: SALE,
    status: 'INSPECTION',
    buyer_id: BUYER,
    seller_id: SELLER,
    item_title: 'Charizard Base Set Holo',
    item_image_paths: ['items/charizard.jpg'],
    fulfillment_method: 'DELIVERY',
    terms_version: 1,
    tracking_number: 'AB123',
    buyer_handover_confirmed_at: null,
    seller_handover_confirmed_at: null,
    disputed_by: null,
    return_tracking_number: null,
    return_disputed_at: null,
    return_carrier_delivered_at: null,
    return_inspection_deadline_at: null,
    buyer_profile: { display_name: 'Ana Ng' },
    seller_profile: { display_name: 'Bob Carter' },
    ...overrides,
  } as SaleContractRow;
}

function notification(userId: string, link: string | null): DescribableRow & { id: string } {
  return { id: `n-${userId}-${link}`, user_id: userId, link, ...bare };
}

describe('describeLinkedRows', () => {
  const reads = {
    liveIds: new Set([TRADE, SALE]),
    sales: [saleRow()],
    trades: [tradeRow()],
    holds: activeHolds,
  };

  it("names a trade's card and other trader, and says when it is the reader's move", () => {
    const [row] = describeLinkedRows([notification(INITIATOR, `/trades/${TRADE}`)], reads);
    expect(row).toMatchObject({
      target_missing: false,
      subject_title: 'Umbreon VMAX Alt Art',
      image_path: 'items/umbreon.jpg',
      actor_name: 'Bob Carter',
      contract_move: { owner: 'you', label: 'Accept what you received' },
    });
  });

  it('says the move is the other side once the reader has taken their step', () => {
    const [row] = describeLinkedRows([notification(COUNTERPART, `/trades/${TRADE}`)], reads);
    expect(row.actor_name).toBe('Ana Ng');
    expect(row.contract_move?.owner).toBe('them');
  });

  it('asks for nothing once the contract is over, whatever the notification said', () => {
    const [row] = describeLinkedRows([notification(INITIATOR, `/trades/${TRADE}`)], {
      ...reads,
      trades: [tradeRow({ state: 'COMPLETED', initiator_accepted_at: '2026-11-27T02:00:00Z' })],
      // Completion voids both holds; with them still live the plan waits on the release.
      holds: activeHolds.map((hold) => ({ ...hold, status: 'VOIDED' })),
    });
    expect(row.contract_move).toBeNull();
    expect(row.subject_title).toBe('Umbreon VMAX Alt Art');
  });

  it("puts a sale on the buyer's move in inspection and on the seller's wait", () => {
    const [buyer, seller] = describeLinkedRows(
      [notification(BUYER, `/sales/${SALE}`), notification(SELLER, `/sales/${SALE}`)],
      reads,
    );
    expect(buyer.contract_move?.owner).toBe('you');
    expect(buyer.actor_name).toBe('Bob Carter');
    expect(seller.contract_move?.owner).toBe('them');
    expect(seller.subject_title).toBe('Charizard Base Set Holo');
  });

  it('gives a reader who is not a party no move and no name', () => {
    const [row] = describeLinkedRows([notification(STAFF, `/sales/${SALE}`)], reads);
    expect(row.contract_move).toBeNull();
    expect(row.actor_name).toBeNull();
    expect(row.subject_title).toBe('Charizard Base Set Holo');
  });

  it('leaves a trade move unknown without its holds, and keeps its subject', () => {
    const [row] = describeLinkedRows([notification(INITIATOR, `/trades/${TRADE}`)], { ...reads, holds: null });
    expect(row.contract_move).toBeNull();
    expect(row.subject_title).toBe('Umbreon VMAX Alt Art');
  });

  it('reports a contract the reader can no longer open, and decides nothing when the check failed', () => {
    const gone = `/trades/${OTHER}`;
    const [missing] = describeLinkedRows([notification(INITIATOR, gone)], reads);
    expect(missing).toMatchObject({ target_missing: true, contract_move: null, subject_title: null });
    const [unknown] = describeLinkedRows([notification(INITIATOR, gone)], { ...reads, liveIds: null });
    expect('target_missing' in unknown).toBe(false);
  });

  it('returns a row that links elsewhere untouched', () => {
    const offer = notification(BUYER, '/offers');
    expect(describeLinkedRows([offer], reads)[0]).toBe(offer);
  });
});