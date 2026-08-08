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
  // Covers /admin/arbitration too. Middleware only proves there IS a session — the
  // capability check is the page's own `is_admin` read and `requireStaff`, and every
  // staff action re-checks. This entry exists so an anonymous visitor is sent to
  // sign-in instead of being served a "Not authorized" page they cannot act on.
  "/admin",
];

// Protected routes that a PREFIX cannot express, because the variable segment comes
// first. `/listings/[id]/edit` writes a listing, but `/listings` and `/listings/[id]`
// are public, so it cannot be covered by a prefix without closing the catalog.
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

export async function middleware(request: NextRequest) {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (isProtected(pathname) && !user) {
    const redirectUrl = request.nextUrl.clone();
    const search = request.nextUrl.search;
    redirectUrl.pathname = "/sign-in";
    redirectUrl.search = "";
    // Keep the query string too: pages like /profile?redirectTo=/deals/join/<token>
    // carry the task the visitor was in the middle of, and losing it strands
    // them on the catalog after signing in.
    redirectUrl.searchParams.set("redirectTo", `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  // ONBOARDING IS REQUIRED TO TRANSACT, NOT TO LOOK.
  //
  // `/listings` used to be treated as an onboarding entry point so a returning
  // member "could not silently skip the flow". The effect was that signing in and
  // clicking the catalog bounced them into a wizard with no dismiss control, no
  // sign-out and no way back to the listings they had asked for. Browsing is public
  // for anonymous visitors, so making it the one thing a signed-in member may NOT do
  // inverted the incentive: creating an account made the site less usable.
  //
  // The gate now covers protected paths only — the places that need a profile
  // because they write, spend, or receive. The catalog and item pages stay open, and
  // the wizard offers its own way out (see app/onboarding/page.tsx), so an
  // incomplete member can look around and finish later. Nothing about the money path
  // is relaxed: every route that opens a contract is protected and still gated.
  if (user && pathname !== '/onboarding' && isProtected(pathname)) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('onboarding_completed_at, fraud_banned_at')
      .eq('id', user.id)
      .maybeSingle();

    if (!profileError && profile?.fraud_banned_at) {
      const suspendedUrl = request.nextUrl.clone();
      suspendedUrl.pathname = '/account-suspended';
      suspendedUrl.search = '';
      return NextResponse.redirect(suspendedUrl);
    }

    if (!profileError && !profile?.onboarding_completed_at) {
      const onboardingUrl = request.nextUrl.clone();
      onboardingUrl.pathname = '/onboarding';
      onboardingUrl.search = '';
      return NextResponse.redirect(onboardingUrl);
    }
  }

  return response;
}

export const config = {
  // Only run on the protected trees to keep middleware overhead minimal.
  matcher: [
    "/profile/:path*",
    // The catalog stays public; this matcher only lets the middleware redirect a
    // signed-in, incomplete member after sign-in. `isProtected()` still limits
    // anonymous auth redirects to /listings/new and /listings/mine.
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
    // `:path*` matches the bare prefix as well as its children, so this covers /admin
    // and /admin/arbitration/... alike.
    "/admin/:path*",
  ],
};
