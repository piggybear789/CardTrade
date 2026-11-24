// tests/e2e/audit/backend/seed.ts
//
// SEED STATE for the e2e UX audit suite: checks that the sandbox seed a Pathway
// relies on is present, and creates the marked Personas a Pathway needs when no seed
// member is in the right state (no card, unverified, another region, ...).
//
// Requirements:
//   2.1   every `auth.users` row the suite creates carries `app_metadata.sandbox = true`
//         FROM CREATION and an email on the reserved `example.com` domain
//   34.2  each Pathway creates the accounts it consumes
//   34.5  missing seed state fails the Pathway naming the record and the reset command
//
// WHY THE FLAG IS SET AT CREATION. `auth.users` is shared with production. An account
// created first and flagged second would, if the flag write failed, be an unflagged
// account in production's user table that cleanup is not allowed to delete
// (`isDeletableSandboxUser`). The Admin API takes `app_metadata` on the create call, so
// there is no window in which the row exists without it.
//
// WHY THE PROFILE IS INSERTED HERE. The app provisions `profiles` in the sign-up
// action (`lib/actions/auth.ts`), not by a trigger on `auth.users`, so an account
// created through the Admin API has no `cardtrade_dev` profile until one is written.
// This writes the same three columns the action does, plus the state the Persona asks
// for, mirroring the service-role arrangement `guards.spec.ts` already uses.

import { randomBytes } from 'node:crypto';

import type Stripe from 'stripe';

import {
  e2eSchema,
  envValue,
  getAuthUser,
  insertRow,
  isSandboxAccount,
  profileIdByEmail,
  selectRows,
  setAppMetadata,
  updateRows,
  type AuthUser,
} from '../../support/db';
import { marked, markedEmail, runId } from '../../support/marker';
import { SEED_CHECK_USERS, TRADE_PAIR_A, type PersonaSpec, type SeedUser } from '../../support/users';
import { credentialRegionFor } from '../../../../domain/services/stripe/config';
import { stampedMetadata, testStripe, type TestPlatform } from './stripe';

/** The command that rebuilds the sandbox and its seed. */
export const RESET_COMMAND = 'npm run dev:db:reset';

// ---------------------------------------------------------------------------
// Seed records
// ---------------------------------------------------------------------------

/** One row `supabase/seed.sql` creates that a Pathway may depend on. */
export interface SeedRecord {
  /** The name a Pathway asks for, e.g. `alice` or `trade-pair-a-bob`. */
  name: string;
  table: 'profiles' | 'items';
  id: string;
  /** Whether an `auth.users` row with the same id must exist too (seed members). */
  authUser: boolean;
}

function memberRecord(user: SeedUser): SeedRecord {
  return { name: user.email.split('@')[0], table: 'profiles', id: user.id, authUser: true };
}

/**
 * Every seed record a Pathway can name. Members are named by their email's local
 * part (`alice`, `frank`, `heidi`, `uma`, ...).
 */
export const SEED_RECORDS: readonly SeedRecord[] = [
  ...SEED_CHECK_USERS.map(memberRecord),
  { name: 'trade-pair-a-alice', table: 'items', id: TRADE_PAIR_A.aliceItemId, authUser: false },
  { name: 'trade-pair-a-bob', table: 'items', id: TRADE_PAIR_A.bobItemId, authUser: false },
];

/** A seed record name. */
export type SeedRecordName = string;

/** Thrown when seed state is missing. The message names each record and the reset command. */
export class SeedMissingError extends Error {
  constructor(readonly missing: readonly SeedRecord[]) {
    super(missingSeedMessage(missing));
    this.name = 'SeedMissingError';
  }
}

/** The failure text for missing seed records (Req 34.5). Pure. */
export function missingSeedMessage(missing: readonly Pick<SeedRecord, 'name' | 'table' | 'id'>[]): string {
  const list = missing.map((r) => `"${r.name}" (${r.table} ${r.id})`).join(', ');
  const noun = missing.length === 1 ? 'seed record' : 'seed records';
  return `Missing ${noun} in cardtrade_dev: ${list}. Run \`${RESET_COMMAND}\` to rebuild the sandbox seed.`;
}

/** Resolve names to records. Throws for a name that is not in {@link SEED_RECORDS}. Pure. */
export function seedRecordsFor(names: readonly SeedRecordName[]): SeedRecord[] {
  return names.map((name) => {
    const record = SEED_RECORDS.find((r) => r.name === name);
    if (!record) {
      throw new Error(
        `requireSeed: unknown seed record ${JSON.stringify(name)}; known records are ${SEED_RECORDS.map((r) => r.name).join(', ')}`,
      );
    }
    return record;
  });
}

/**
 * Fail unless every named seed record exists in `cardtrade_dev` (and, for a member,
 * in `auth.users`). Throws {@link SeedMissingError} naming every missing record and
 * `npm run dev:db:reset` (Req 34.5). Read-only.
 */
export async function requireSeed(names: readonly SeedRecordName[]): Promise<void> {
  e2eSchema();
  const records = seedRecordsFor(names);
  const missing: SeedRecord[] = [];

  for (const table of ['profiles', 'items'] as const) {
    const wanted = records.filter((r) => r.table === table);
    if (wanted.length === 0) continue;
    const ids = [...new Set(wanted.map((r) => r.id))];
    const rows = await selectRows<{ id: string }>(table, `select=id&id=in.(${ids.join(',')})`);
    const found = new Set(rows.map((row) => row.id));
    for (const record of wanted) if (!found.has(record.id)) missing.push(record);
  }

  for (const record of records) {
    if (!record.authUser || missing.includes(record)) continue;
    if (!(await getAuthUser(record.id))) missing.push(record);
  }

  if (missing.length > 0) throw new SeedMissingError(missing);
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

/** A created Persona. Usable wherever a {@link SeedUser} is, e.g. to sign in. */
export interface Persona extends SeedUser {
  label: string;
  regionCode: string;
  spec: PersonaSpec;
}

/** Options that are about how the account is made rather than the member's state. */
export interface CreatePersonaOptions {
  /** Whether the email is confirmed at creation. Defaults to true. */
  emailConfirmed?: boolean;
  /**
   * The Stripe test PaymentMethod token for a saved card (`pm_card_visa`, ...).
   * Defaults to a card issued in the Persona's region, so it prices as domestic.
   */
  card?: string;
}

/** Test card tokens issued in a given country, for a domestic-priced saved card. */
const COUNTRY_CARDS: Readonly<Record<string, string>> = {
  AU: 'pm_card_au',
  US: 'pm_card_us',
  GB: 'pm_card_gb',
  DE: 'pm_card_de',
  FR: 'pm_card_fr',
  NL: 'pm_card_nl',
  CA: 'pm_card_ca',
};

/** The default saved-card token for a region. Pure. */
export function defaultCardFor(regionCode: string): string {
  return COUNTRY_CARDS[regionCode.toUpperCase()] ?? 'pm_card_visa';
}

/** A marked, collision-free email for a Persona label. Pure apart from the random part. */
export function personaEmail(label: string): string {
  return markedEmail(`${label}-${randomBytes(3).toString('hex')}`);
}

/** The `profiles` row for a Persona, before any saved card. Pure. */
export function personaProfileRow(
  spec: PersonaSpec,
  id: string,
  email: string,
  now: Date = new Date(),
): Record<string, unknown> {
  const at = now.toISOString();
  const row: Record<string, unknown> = {
    id,
    display_name: marked(spec.label),
    contact_email: email,
    region_code: (spec.regionCode ?? 'AU').toUpperCase(),
  };
  if (spec.onboarded ?? true) row.onboarding_completed_at = at;
  if (spec.identityVerified ?? false) {
    row.identity_check_status = 'VERIFIED';
    row.identity_check_name = `E2E ${spec.label.replace(/-/g, ' ')}`;
    row.identity_check_verified_at = at;
  }
  return row;
}

function adminCredentials(): { url: string; serviceKey: string } {
  const url = envValue('NEXT_PUBLIC_SUPABASE_URL')?.trim().replace(/\/+$/, '');
  const serviceKey = envValue('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !serviceKey) {
    throw new Error('createPersona needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return { url, serviceKey };
}

async function authAdminRequest(method: 'POST' | 'DELETE', pathAndQuery: string, body?: unknown): Promise<Response> {
  e2eSchema();
  const { url, serviceKey } = adminCredentials();
  return fetch(`${url}/auth/v1/admin/${pathAndQuery}`, {
    method,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Remove an auth user this module JUST created, when the rest of the Persona could
 * not be made. Cleanup finds accounts through their marked `cardtrade_dev` profile,
 * so one left without a profile would stay in production's `auth.users` for good.
 */
async function deleteJustCreated(user: Pick<AuthUser, 'id' | 'email'>, email: string): Promise<void> {
  if (user.email?.toLowerCase() !== email.toLowerCase()) return;
  await authAdminRequest('DELETE', `users/${encodeURIComponent(user.id)}`);
}

/** Save a Stripe test card for the Persona on its platform, as the card dialog would. */
async function saveTestCard(persona: { id: string; email: string; regionCode: string }, card: string): Promise<void> {
  const platform = credentialRegionFor(persona.regionCode);
  if (platform !== 'AU' && platform !== 'US') {
    throw new Error(`createPersona: region ${persona.regionCode} has no Stripe test platform`);
  }
  const stripe: Stripe = testStripe(platform as TestPlatform);
  const customer = await stripe.customers.create({
    email: persona.email,
    description: 'NoDitto e2e audit persona',
    metadata: stampedMetadata({ cardtrade_profile_id: persona.id }),
  });
  const method = await stripe.paymentMethods.attach(card, { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: method.id } });

  const brand = method.card?.brand ? method.card.brand.charAt(0).toUpperCase() + method.card.brand.slice(1) : 'Card';
  await updateRows('profiles', `id=eq.${persona.id}`, {
    payer_id: customer.id,
    payment_source_id: method.id,
    payment_token_type: 'credit-card',
    payment_method_label: `${brand} •••• ${method.card?.last4 ?? '0000'}`,
  });
}

/**
 * Create a marked Persona: an `auth.users` row with `app_metadata.sandbox = true` set
 * on the create call (Req 2.1), a `cardtrade_dev` profile in the state `spec` names,
 * and, when `spec.savedCard`, a Stripe TEST customer with a saved card stamped with
 * the run id (Req 2.7).
 *
 * The email is `e2e-<label>-…@example.com` and the display name `[E2E] <label>`, so
 * cleanup removes both. The returned password is random and lives only in memory.
 *
 * A saved card is written straight to the profile, so no card-fingerprint risk signal
 * is recorded; a "shared card" Persona must add its card through the UI instead.
 */
export async function createPersona(spec: PersonaSpec, opts: CreatePersonaOptions = {}): Promise<Persona> {
  e2eSchema();
  // Make sure the run id exists before anything is created, so a Stripe object can be stamped.
  if (spec.savedCard) runId();

  const email = personaEmail(spec.label);
  const password = `E2e!${randomBytes(18).toString('base64url')}`;
  const response = await authAdminRequest('POST', 'users', {
    email,
    password,
    email_confirm: opts.emailConfirmed ?? true,
    app_metadata: { sandbox: true },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`createPersona: auth admin create (${spec.label}) -> ${response.status}: ${text}`);
  }
  const raw = JSON.parse(text) as { id?: unknown; email?: unknown; app_metadata?: Record<string, unknown> };
  const user = {
    id: String(raw.id),
    email: typeof raw.email === 'string' ? raw.email : null,
    app_metadata: raw.app_metadata ?? {},
  };
  if (!isSandboxAccount(user)) {
    await deleteJustCreated(user, email);
    throw new Error(`createPersona: auth user for ${spec.label} came back without the sandbox flag; deleted it`);
  }

  const row = personaProfileRow(spec, user.id, email);
  try {
    await insertRow('profiles', row);
  } catch (error) {
    await deleteJustCreated(user, email);
    throw error;
  }

  const regionCode = String(row.region_code);
  if (spec.savedCard) {
    // The account is marked by now, so cleanup removes it if this throws.
    await saveTestCard({ id: user.id, email, regionCode }, opts.card ?? defaultCardFor(regionCode));
  }

  return {
    id: user.id,
    email,
    password,
    displayName: String(row.display_name),
    label: spec.label,
    regionCode,
    spec,
  };
}

/**
 * Flag an account the suite created through the REAL sign-up form, right after the
 * form returned. GoTrue's public sign-up cannot set `app_metadata`, so this is the
 * earliest the flag can be written for that path. Refuses an email that is not a
 * marked `e2e-…@example.com` address; `setAppMetadata` refuses anything off the
 * reserved domain as well.
 */
export async function flagFormSignUp(email: string): Promise<AuthUser> {
  if (!/^e2e-.+@example\.com$/i.test(email)) {
    throw new Error('flagFormSignUp: only a marked e2e-…@example.com sign-up may be flagged');
  }
  const id = await profileIdByEmail(email);
  if (!id) throw new Error('flagFormSignUp: no profile for that sign-up yet');
  return setAppMetadata(id, { sandbox: true });
}
