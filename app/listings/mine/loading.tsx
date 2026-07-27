// app/listings/mine/loading.tsx
//
// Without this file, /listings/mine would inherit app/listings/loading.tsx's
// catalog-grid skeleton (sidebar + card grid), which doesn't match this
// section's list layout. Falls back to the generic route loading UI instead.

export { default } from '@/app/loading';
