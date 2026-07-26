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
  "/profile",
  "/listings/new",
  "/listings/mine",
  "/trades",
  "/purchases",
  "/sales",
  "/offers",
  "/saved",
  "/account",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
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

  return response;
}

export const config = {
  // Only run on the protected trees to keep middleware overhead minimal.
  matcher: [
    "/profile/:path*",
    "/listings/new/:path*",
    "/listings/mine/:path*",
    "/trades/:path*",
    "/purchases/:path*",
    "/sales/:path*",
    "/offers/:path*",
    "/saved/:path*",
    "/account/:path*",
  ],
};
