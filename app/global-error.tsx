'use client';

// app/global-error.tsx
//
// Last-resort boundary for errors thrown in the root layout itself. It replaces
// the whole document, so it must render its own <html>/<body>. Deliberately
// dependency-free (inline styles) so it renders even if the app shell is the
// thing that failed.

import { useEffect, useState } from 'react';

import { useErrorReference } from '@/components/layout/ErrorScreen';
import { reportError } from '@/lib/actions/errorReports';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Logs a browser error (production only) and gives every error a reference, exactly
  // as `ErrorScreen` does. The report here is one tap with no note: this screen cannot
  // count on the stylesheet, so it keeps the form out of it.
  const reference = useErrorReference(error);
  const [report, setReport] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  useEffect(() => {
    console.error('Global error boundary caught:', error);
  }, [error]);

  async function sendReport() {
    setReport('sending');
    try {
      const result = await reportError({ reference, path: window.location.pathname });
      setReport(result.ok ? 'sent' : 'failed');
    } catch {
      setReport('failed');
    }
  }

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Literal `--obsidian` and `--mist`. Hardcoded because a global error
          // boundary replaces the root layout and cannot count on the stylesheet
          // having loaded, so these two must be kept in step with globals.css by
          // hand — as must `viewport.themeColor` in `app/layout.tsx`.
          background: '#120f15',
          color: '#efe7f3',
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
              color: '#9e67c1',
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
              background: '#804fa1',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '0.95rem',
              padding: '0.75rem 1.75rem',
            }}
          >
            Reload
          </button>
          <p
            role="status"
            style={{
              margin: '1.5rem 0 0',
              fontSize: '0.8125rem',
              color: 'rgba(238,234,241,0.6)',
            }}
          >
            {report === 'sent' ? (
              'Report sent. '
            ) : (
              <>
                <button
                  type="button"
                  onClick={sendReport}
                  disabled={report === 'sending'}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: '#efe7f3',
                    font: 'inherit',
                    textDecoration: 'underline',
                    textUnderlineOffset: '4px',
                  }}
                >
                  {/* Width-stable without the UI primitives this file cannot import:
                      both labels share one grid cell, so "Sending…" does not reflow the
                      sentence and drag the Ref across. */}
                  <span style={{ display: 'inline-grid' }}>
                    <span
                      style={{
                        gridArea: '1 / 1',
                        visibility: report === 'sending' ? 'hidden' : 'visible',
                      }}
                      aria-hidden={report === 'sending' || undefined}
                    >
                      Report this problem
                    </span>
                    <span
                      style={{
                        gridArea: '1 / 1',
                        visibility: report === 'sending' ? 'visible' : 'hidden',
                      }}
                      aria-hidden={report !== 'sending' || undefined}
                    >
                      Sending…
                    </span>
                  </span>
                </button>
                {report === 'failed' ? ' (did not send, try again) ' : ' · '}
              </>
            )}
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>Ref {reference}</span>
          </p>
        </div>
      </body>
    </html>
  );
}
