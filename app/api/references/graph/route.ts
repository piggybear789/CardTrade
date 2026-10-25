// app/api/references/graph/route.ts
//
// One person's reference graph as JSON, for walking the Trust Network: the graph
// starts moving toward someone while their page loads. It resolves the address with
// the loader `/references/[handle]` uses (`?handle=<slug>&on=<platform>`), so the page
// that arrives draws exactly what the walk already shows.

import { NextResponse, type NextRequest } from 'next/server';

import { loadReferencePage } from '@/lib/references/graph';

/** Longer than any handle a platform allows; anything past it is not a handle. */
const MAX_HANDLE_LENGTH = 100;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const handle = params.get('handle')?.trim() ?? '';
  if (!handle || handle.length > MAX_HANDLE_LENGTH) {
    return NextResponse.json({ error: 'Choose a member to load.' }, { status: 400 });
  }

  const page = await loadReferencePage(handle, params.get('on'));
  if (!page) {
    return NextResponse.json({ error: 'This member’s references are not available.' }, { status: 404 });
  }
  // The graph links every person by platform or id, so a walk never asks for a bare
  // handle that several people share. If one does, it names nobody in particular.
  if (page.kind === 'choose') {
    return NextResponse.json({ error: 'More than one person goes by this handle.' }, { status: 409 });
  }

  return NextResponse.json(page.graph, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
