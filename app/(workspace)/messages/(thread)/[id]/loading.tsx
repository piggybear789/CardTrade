'use client';

// app/(workspace)/messages/(thread)/[id]/loading.tsx
//
// The thread pane while a thread loads — and ONLY the thread pane.
//
// This boundary sits inside `(thread)/layout.tsx`, so the shell and the inbox pane are
// never part of it: they stay mounted through a switch and need no stand-in. The old
// loader, at `messages/[id]/`, had to redraw the whole page — shell, a skeleton rail
// reserved to the pane's exact geometry, and the thread — because the page was all of
// those things, and every click swapped the real inbox for placeholder rows.
//
// A CLIENT COMPONENT, so the placeholder can be the thread itself. It reads the target
// id from the URL and draws it from the live inbox: the real header from the list entry,
// and the real messages if the thread has been open in this tab (`ThreadPreview`). A
// thread the client knows nothing about gets the generic `ChatThreadSkeleton`.
//
// The rules this file used to state still hold. It is a LEAF loader, and the
// `messages/` slot above both groups stays empty: a boundary there would be the fallback
// for `/messages` too, which is a different shape. See `(inbox)/loading.tsx`.

import { useParams } from 'next/navigation';

import { ThreadPreview } from '@/components/messages/ThreadPane';

export default function ConversationLoading() {
  const params = useParams();
  const conversationId = typeof params.id === 'string' ? params.id : null;
  return <ThreadPreview conversationId={conversationId} />;
}
