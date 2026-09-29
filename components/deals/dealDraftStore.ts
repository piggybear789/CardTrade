// components/deals/dealDraftStore.ts
//
// The composer's draft, kept in IndexedDB so it survives the sign-in a signed-out
// visitor meets at Get link: the full-page trip to Google and back, and an
// email-confirmation link opened in a new tab. IndexedDB rather than session
// storage because the photos are Files, which web storage cannot hold, and a new
// tab does not share session storage.
//
// Best-effort throughout. A browser that refuses IndexedDB (some private modes)
// loses the draft on a redirect, which is what every visitor got before this, and
// no failure here may stop someone composing.

import type { UnlistedItemDraft } from '@/components/trade/UnlistedItemFields';

export type DraftKind = 'CASH_SALE' | 'TRADE';

export interface StoredDealDraft {
  kind: DraftKind;
  card: UnlistedItemDraft;
  priceDollars: string;
  valueDollars: string;
  wanted: string;
}

const DB_NAME = 'noditto-deals';
const STORE = 'drafts';
const KEY = 'current';
/** Long enough for an emailed confirmation link; short enough not to resurrect a stale deal. */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

interface StoredRecord {
  savedAt: number;
  draft: StoredDealDraft;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function isStoredRecord(value: unknown): value is StoredRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredRecord>;
  const draft = record.draft;
  return (
    typeof record.savedAt === 'number' &&
    Boolean(draft) &&
    (draft?.kind === 'CASH_SALE' || draft?.kind === 'TRADE') &&
    Array.isArray(draft?.card?.images)
  );
}

export async function saveDealDraft(draft: StoredDealDraft): Promise<void> {
  const record: StoredRecord = { savedAt: Date.now(), draft };
  await withStore('readwrite', (store) => store.put(record, KEY));
}

export async function loadDealDraft(): Promise<StoredDealDraft | null> {
  const value = await withStore<unknown>('readonly', (store) => store.get(KEY));
  if (!isStoredRecord(value)) return null;
  if (Date.now() - value.savedAt > MAX_AGE_MS) {
    await clearDealDraft();
    return null;
  }
  // A draft saved before `keptPaths` existed has none, and a composer draft never
  // keeps stored photos, so the missing list is an empty one.
  const card = value.draft.card as Partial<UnlistedItemDraft> & UnlistedItemDraft;
  return { ...value.draft, card: { ...card, keptPaths: card.keptPaths ?? [] } };
}

export async function clearDealDraft(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(KEY));
}
