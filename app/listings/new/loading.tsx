// app/listings/new/loading.tsx
//
// Without this file, /listings/new would inherit app/listings/loading.tsx's
// catalog-grid skeleton (sidebar + card grid), which doesn't match a create
// form. Falls back to the generic route loading UI instead.

export { default } from '@/app/loading';
