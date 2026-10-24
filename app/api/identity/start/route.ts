import { NextResponse, type NextRequest } from 'next/server';

import { beginIdentityCheck } from '@/lib/actions/identity';
import { DEFAULT_IDENTITY_RETURN_PATH, safeIdentityReturnPath } from '@/lib/identity/identityReturn';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

// app/api/identity/start/route.ts
//
// Starts the identity check straight away and sends the member to the provider, which
// returns them through `/identity/return` to the page they came from. It is the answer
// to "you need to verify first": a member who tries to leave a reference or claim a
// handle is taken into the check, not stopped at a message.
//
// A GET, because it is a navigation: a link or a redirect lands here. It creates a
// provider session, so it only ever acts for the signed-in member, and never for a
// request that arrives from another website.

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { nextUrl } = request;
  const returnPath = safeIdentityReturnPath(nextUrl.searchParams.get('returnPath'));
  const back = (path: string) => NextResponse.redirect(new URL(path, nextUrl));

  if (request.headers.get('sec-fetch-site') === 'cross-site') return back(returnPath);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const here = `${nextUrl.pathname}${nextUrl.search}`;
    return back(`/sign-in?redirectTo=${encodeURIComponent(here)}`);
  }

  // A member who has already passed needs no check, and no new provider session.
  const { data: profile } = await createAdminClient()
    .from('profiles')
    .select('identity_check_status')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.identity_check_status === 'VERIFIED') return back(returnPath);

  let started;
  try {
    started = await beginIdentityCheck(returnPath);
  } catch {
    return back(DEFAULT_IDENTITY_RETURN_PATH);
  }
  // The verification tab shows the provider's reason and offers a retry.
  if (!started.ok) return back(DEFAULT_IDENTITY_RETURN_PATH);
  if (started.data.url) return NextResponse.redirect(started.data.url);

  // No link to follow: it was decided just now, or the provider is still reviewing.
  return back(started.data.progress === 'DECIDED' ? returnPath : DEFAULT_IDENTITY_RETURN_PATH);
}
