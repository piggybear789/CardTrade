'use client';

// app/global-error.tsx
//
// Last-resort boundary for errors thrown in the root layout itself. It replaces
// the whole document, so it must render its own <html>/<body>. Deliberately
// dependency-free (inline styles) so it renders even if the app shell is the
// thing that failed.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error boundary caught:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#120f15',
          color: '#eeeaf1',
          fontFamily:
            'Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <p
            style={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#9a6fb8',
            }}
          >
            NoDitto
          </p>
          <h1
            style={{
              margin: '1rem 0 0',
              fontSize: '2rem',
              lineHeight: 1.1,
              fontWeight: 600,
            }}
          >
            The app failed to load
          </h1>
          <p
            style={{
              margin: '0.75rem 0 0',
              lineHeight: 1.6,
              color: 'rgba(238,234,241,0.72)',
            }}
          >
            An unexpected error stopped the page from rendering. Your account,
            funds, and trades are unaffected.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.75rem',
              cursor: 'pointer',
              borderRadius: '0.5rem',
              border: 'none',
              // The deeper `--primary`, not `--iris`: the lighter lilac cannot
              // carry white at this 15px label size.
              background: '#77469b',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '0.95rem',
              padding: '0.75rem 1.75rem',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
