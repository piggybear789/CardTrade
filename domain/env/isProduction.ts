// domain/env/isProduction.ts
//
// The ONE "is this production" predicate (ESC-16), shared by the error logger and the
// payment provider resolution so the two cannot disagree about which deployment they
// are in.
//
// On Vercel that is `VERCEL_ENV === 'production'`, so preview deployments are NOT
// production; elsewhere it is `NODE_ENV === 'production'`.
//
// Pure: reads only the env object it is given.

/** A minimal environment view, so tests can pass a plain object. */
export type EnvLike = Record<string, string | undefined>;

export function isProductionEnv(env: EnvLike = process.env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production';
  return env.NODE_ENV === 'production';
}
