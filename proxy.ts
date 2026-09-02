import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Protected-route middleware (Req 1.7).
//
// Reads (and refreshes) the Supabase SSR session from cookies and redirects
// unauthenticated visitors to /sign-in when they request a protected path,
// preserving the original destination in `redirectTo` so the sign-in flow can
// send them back. The protected-path list is intentionally minimal; add paths
// here (and to `config.matcher`) as those pages are built.
const PROTECTED_PREFIXES = [
  // Covers /profile/payouts too, so the Payouts dashboard needs no entry of its own.
  "/profile",
  "/listings/new",
  "/listings/mine",
  "/trades",
  "/messages",
  "/notifications",
  "/purchases",
  "/sales",
  "/offers",
  "/saved",
  "/account",
  "/onboarding",
  "/deals",
  // Covers /admin/arbitration too. Middleware only proves there IS a session — the
  // capability check is the page's own `is_admin` read and `requireStaff`, and every
  // staff action re-checks. This entry exists so an anonymous visitor is sent to
  // sign-in instead of being served a "Not authorized" page they cannot act on.
  "/admin",
];

// Protected routes that a PREFIX cannot express, because the variable segment comes
// first. `/listings/[id]/edit` writes a listing, but `/listings/[id]` is public, so it
// cannot be covered by a prefix without closing every listing detail page.
//
// It was in `config.matcher` but not in `PROTECTED_PREFIXES`, so `isProtected()` was
// false for it and neither the sign-in redirect, the FRAUD-BAN redirect, nor the
// onboarding gate ran on a route that mutates. The page authenticates and checks
// ownership itself and RLS refuses a banned member's write, so this is defence in
// depth — but it is the only write route that had none of the three.
const PROTECTED_PATTERNS: readonly RegExp[] = [/^\/listings\/[^/]+\/edit\/?$/];

function isProtected(pathname: string): boolean {
  return (
    PROTECTED_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ) || PROTECTED_PATTERNS.some((pattern) => pattern.test(pathname))
  );
}

export async function proxy(request: NextRequest) {
  // Start with a pass-through response; cookie writes below re-bind it so the
  // refreshed session is propagated to the browser.
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Without Supabase configured we cannot evaluate the session; fail open so
  // local/dev without env vars still serves pages.
  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    db: { schema: 'cardtrade' },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // GUARDED, because this is the only unguarded await in the request path and it
  // talks to a remote auth server. `getCachedAuthUser` already wraps the identical
  // call in try/catch and returns null; this did not, so anything `getUser()` threw
  // — a revoked or malformed refresh token, a GoTrue blip, a network timeout —
  // propagated out of the proxy and became a 500 on EVERY route in the matcher,
  // including the catalog. Production logs already carry `AuthApiError: Refresh
  // token is not valid` from this line.
  //
  // Falling back to `null` is fail-closed on access and fail-open on availability:
  // a protected path redirects to sign-in, a public one is served as a guest. Both
  // are correct outcomes for a session we could not verify, and neither grants
  // anything. The bad cookie then gets cleared by the sign-in flow.
  let user = null as Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'];
  try {
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch {
    user = null;
  }

  const { pathname } = request.nextUrl;
  if (isProtected(pathname) && !user) {
    const redirectUrl = request.nextUrl.clone();
    const search = request.nextUrl.search;
    redirectUrl.pathname = "/sign-in";
    redirectUrl.search = "";
    // Keep the query string too: pages like /trades?redirectTo=/trades/123
    // carry the task the visitor was in the middle of, and losing it strands
    // them on the catalog after signing in.
    redirectUrl.searchParams.set("redirectTo", `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  // ONBOARDING IS REQUIRED ONCE THEY HAVE AN ACCOUNT.
  //
  // The catalog is public for guests. Signing up is therefore the decision to
  // transact, not a prerequisite for looking. An unfinished session that hits the
  // catalog or any protected route is sent back to the wizard; sign-out is the
  // way back to guest browsing.
  //
  // `/` IS THE CATALOG, so it is gated like one. This used to be the marketing
  // landing page and was deliberately left open; keeping that exemption after the
  // move would have let a fraud-banned or half-onboarded member browse the whole
  // catalog just by dropping the `/listings` suffix.
  //
  // Public catalog pages only. `/listings/new`, `/listings/mine` and
  // `/listings/[id]/edit` are already `isProtected`.
  const onCatalog =
    pathname === '/' ||
    (pathname.startsWith('/listings/') && !isProtected(pathname));

  if (user && pathname !== '/onboarding' && (isProtected(pathname) || onCatalog)) {
    // Same reasoning as the auth read above: a throw here would 500 the request
    // rather than fail the gate. Both branches below are already written to no-op
    // when `profileError` is set, so an unreadable profile just means neither
    // redirect fires and the page renders — which is what an errored read already
    // did before this could throw.
    let profile: { onboarding_completed_at: string | null; fraud_banned_at: string | null } | null =
      null;
    let profileError: unknown = null;
    try {
      const result = await supabase
        .from('profiles')
        .select('onboarding_completed_at, fraud_banned_at')
        .eq('id', user.id)
        .maybeSingle();
      profile = result.data;
      profileError = result.error;
    } catch (caught) {
      profileError = caught;
    }

    if (!profileError && profile?.fraud_banned_at) {
      const suspendedUrl = request.nextUrl.clone();
      suspendedUrl.pathname = '/account-suspended';
      suspendedUrl.search = '';
      return NextResponse.redirect(suspendedUrl);
    }

    if (!profileError && !profile?.onboarding_completed_at) {
      const onboardingUrl = request.nextUrl.clone();
      const search = request.nextUrl.search;
      onboardingUrl.pathname = '/onboarding';
      onboardingUrl.search = '';
      onboardingUrl.searchParams.set('redirectTo', `${pathname}${search}`);
      return NextResponse.redirect(onboardingUrl);
    }
  }

  return response;
}

export const config = {
  // Only run on the protected trees to keep middleware overhead minimal.
  matcher: [
    // The catalog homepage. Guests may browse, so this costs one session read on
    // the highest-traffic route — the price of the fraud-ban and onboarding gates
    // covering the catalog wherever it is served from.
    "/",
    "/profile/:path*",
    // Guests may browse. A signed-in member with no `onboarding_completed_at`
    // is sent back to the wizard. `isProtected()` still limits anonymous auth
    // redirects to /listings/new, /listings/mine and /listings/[id]/edit.
    "/listings/:path*",
    "/trades/:path*",
    "/messages/:path*",
    "/notifications/:path*",
    "/purchases/:path*",
    "/sales/:path*",
    "/offers/:path*",
    "/saved/:path*",
    "/account/:path*",
    "/onboarding/:path*",
    "/deals/:path*",
    // `:path*` matches the bare prefix as well as its children, so this covers /admin
    // and /admin/arbitration/... alike.
    "/admin/:path*",
  ],
};
