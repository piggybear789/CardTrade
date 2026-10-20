// app/api/references/graph/route.ts
//
// One person's reference graph as JSON, for walking the Trust Network: the graph
// starts moving toward someone while their page loads. It loads by handle with the
// loader `/references/[handle]` uses, so the page that arrives draws exactly what
// the walk already shows.

import { NextResponse, type NextRequest } from 'next/server';

import { loadHandleReferenceGraph } from '@/lib/references/graph';

/** Longer than any handle a platform allows; anything past it is not a handle. */
const MAX_HANDLE_LENGTH = 100;

export async function GET(request: NextRequest) {
  const handle = request.nextUrl.searchParams.get('handle')?.trim() ?? '';
  if (!handle || handle.length > MAX_HANDLE_LENGTH) {
    return NextResponse.json({ error: 'Choose a member to load.' }, { status: 400 });
  }

  const graph = await loadHandleReferenceGraph(handle);
  if (!graph) {
    return NextResponse.json({ error: 'This member’s references are not available.' }, { status: 404 });
  }

  return NextResponse.json(graph, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
