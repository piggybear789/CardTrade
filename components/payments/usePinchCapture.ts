'use client';

// components/payments/usePinchCapture.ts
//
// Client-side loader for the Pinch CaptureJS tokenisation library (Req 2.1,
// 5.4). Card details entered into `AddPaymentMethodDialog` are handed straight
// to `Pinch.Capture(...).createToken(...)` IN THE BROWSER; only the resulting
// short-lived token ever reaches our server
// (`lib/actions/payments.ts::attachPaymentSource`). Keep the `integrity` +
// `crossorigin` attributes on the script tag — see
// `.kiro/steering/pinch-payments.md`.

import { useEffect, useRef, useState } from 'react';

const SCRIPT_ID = 'pinch-capturejs';
const SCRIPT_SRC = 'https://cdn.getpinch.com.au/capturejs/pinch.capture.v2.js';
const SCRIPT_INTEGRITY =
  'sha384-hglYFSKC4AMA/rAQOGB3OiA8u5ri5F4qNMGgw4I+fggDSlTmPyREcj1J+VGnkAX8';

/** The subset of the CaptureJS surface this app uses. */
export interface PinchCaptureToken {
  token: string;
}

export interface PinchCaptureInstance {
  createToken(params: Record<string, string>): Promise<PinchCaptureToken>;
}

declare global {
  interface Window {
    Pinch?: {
      Capture: (opts: { publishableKey: string }) => PinchCaptureInstance;
    };
  }
}

let scriptLoadPromise: Promise<void> | null = null;

/** Load the CaptureJS script at most once per page, reusing an in-flight load. */
function loadCaptureScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Pinch CaptureJS requires a browser environment.'));
  }
  if (window.Pinch) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      if (window.Pinch) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error('Could not load the card entry library.')),
      );
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.integrity = SCRIPT_INTEGRITY;
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the card entry library.'));
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

export type PinchCaptureStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Load CaptureJS and construct a `Pinch.Capture` instance for `publishableKey`.
 * Pass `null` to defer loading (e.g. until a dialog actually opens).
 */
export function usePinchCapture(publishableKey: string | null): {
  status: PinchCaptureStatus;
  capture: PinchCaptureInstance | null;
  error: string | null;
} {
  const [status, setStatus] = useState<PinchCaptureStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const captureRef = useRef<PinchCaptureInstance | null>(null);

  useEffect(() => {
    if (!publishableKey) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);

    loadCaptureScript()
      .then(() => {
        if (cancelled) return;
        if (!window.Pinch) throw new Error('Card entry library did not initialise.');
        captureRef.current = window.Pinch.Capture({ publishableKey });
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load the card entry library.');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [publishableKey]);

  return { status, capture: captureRef.current, error };
}
