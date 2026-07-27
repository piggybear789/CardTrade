// app/listings/[id]/loading.tsx
//
// Without this file, /listings/[id] would inherit app/listings/loading.tsx's
// catalog-grid skeleton (sidebar + card grid), which doesn't match an item
// detail page. Falls back to the generic route loading UI instead.

export { default } from '@/app/loading';
