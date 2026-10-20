// app/api/references/graph/route.ts
//
// One member's reference graph as JSON, for walking the Trust Network in place:
// double-clicking someone loads their graph without leaving the page. It is the
// same public-safe structure `/references/[handle]` renders server-side.

import { NextResponse, type NextRequest } from 'next/server';

import { isUuid } from '@/domain/references/reference';
import { loadProfileReferenceGraph } from '@/lib/references/graph';

export async function GET(request: NextRequest) {
  const profileId = request.nextUrl.searchParams.get('profile');
  if (!isUuid(profileId)) {
    return NextResponse.json({ error: 'Choose a member to load.' }, { status: 400 });
  }

  const graph = await loadProfileReferenceGraph(profileId);
  if (!graph) {
    return NextResponse.json({ error: 'This member’s references are not available.' }, { status: 404 });
  }

  return NextResponse.json(graph, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
