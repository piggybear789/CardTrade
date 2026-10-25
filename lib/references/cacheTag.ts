// lib/references/cacheTag.ts
//
// The tag on every cached read of reference data (`lib/references/graph.ts`,
// `searchReferences`). Anything that changes what a references page shows expires it:
// `updateTag` from a Server Action, so the member sees their own change straight away;
// `revalidateTag(tag, { expire: 0 })` from a Route Handler.

export const REFERENCES_CACHE_TAG = 'references';
