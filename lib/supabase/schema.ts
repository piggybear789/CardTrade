// lib/supabase/schema.ts
//
// WHICH POSTGRES SCHEMA THE APP READS AND WRITES. The ONE place it is decided; every
// Supabase client, the proxy and every Realtime subscription reads `DB_SCHEMA`.
//
//   cardtrade      production. The default, and the only value a production
//                  deployment may run with.
//   cardtrade_dev  the dev sandbox: a structural clone of `cardtrade` in the SAME
//                  Supabase project, holding only seeded test data. Built and reset
//                  by `npm run dev:db:reset` (scripts/dev/cloneDevSchema.mjs).
//
// Chosen by `NEXT_PUBLIC_SUPABASE_SCHEMA`, which `.env.local` sets to
// `cardtrade_dev` so `npm run dev` and the e2e suites never touch production rows.
// NEXT_PUBLIC because the browser client and Realtime need it too; it is a schema
// name, not a secret. Inlined at build time, like every NEXT_PUBLIC value.
//
// Shared with the production project: `auth.users` (sandbox accounts are real auth
// accounts, tagged `app_metadata.sandbox`), Storage buckets, and the Edge proxy. Not
// shared: every `cardtrade` table, view, function, policy and grant.
//
// No `server-only`: the browser client and `proxy.ts` (Edge) import this.

export const PRODUCTION_SCHEMA = 'cardtrade';
export const DEV_SCHEMA = 'cardtrade_dev';

const ALLOWED = [PRODUCTION_SCHEMA, DEV_SCHEMA] as const;
type AllowedSchema = (typeof ALLOWED)[number];

function resolveSchema(): AllowedSchema {
  // Read as a literal property so Next inlines it into the client bundle.
  const raw = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA?.trim() || PRODUCTION_SCHEMA;
  if (!(ALLOWED as readonly string[]).includes(raw)) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_SCHEMA must be one of ${ALLOWED.join(', ')}; got "${raw}".`,
    );
  }
  // A production deployment on the sandbox would show members an empty marketplace
  // and take their sign-ups into test tables. Refuse rather than serve it.
  if (raw !== PRODUCTION_SCHEMA && process.env.VERCEL_ENV === 'production') {
    throw new Error('The dev schema cannot be used by a production deployment.');
  }
  return raw as AllowedSchema;
}

/**
 * The schema every client targets. Typed as `'cardtrade'` because
 * `database.types.ts` describes the production schema and the dev schema is a
 * structural clone of it, so one set of types covers both.
 */
export const DB_SCHEMA = resolveSchema() as typeof PRODUCTION_SCHEMA;

/** True when this process is pointed at the dev sandbox. */
export const IS_DEV_SCHEMA = (DB_SCHEMA as string) === DEV_SCHEMA;
