/**
 * Whether this request carries a Supabase auth session cookie.
 *
 * Cookie presence is not a verified session — the token may be expired — but
 * its absence is conclusive: there is no session to refresh, and calling
 * `auth.getUser()` would only add a round trip that returns null.
 *
 * Chunked cookies (`sb-…-auth-token.0`) still include `auth-token` in the name.
 */
export function hasSupabaseSessionCookie(cookies: readonly { name: string }[]): boolean {
  return cookies.some((cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('auth-token'));
}
