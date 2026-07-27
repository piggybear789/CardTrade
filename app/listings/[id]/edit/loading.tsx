// app/listings/[id]/edit/loading.tsx
//
// Without this file, /listings/[id]/edit would inherit app/listings/loading.tsx's
// catalog-grid skeleton (sidebar + card grid), which doesn't match an edit
// form. Falls back to the generic route loading UI instead.

export { default } from '@/app/loading';
