// tests/unit/viewportHint.test.ts
//
// The first-paint viewport guess. A wrong DESKTOP guess on a phone would render the
// desktop tree and rebuild it at hydration, which is worse than the phone-first default
// it replaces — so ambiguity must come back `undefined`, not desktop.

import { describe, expect, it } from 'vitest';

import { guessViewportFromHeaders, parseViewportCookie } from '@/lib/layout/viewportHint';

function headersOf(values: Record<string, string>) {
  return (name: string) => values[name.toLowerCase()] ?? null;
}

describe('parseViewportCookie', () => {
  it('reads the tiers the writer encodes', () => {
    expect(parseViewportCookie('ds')).toEqual({ isDesktop: true, isSplit: true });
    expect(parseViewportCookie('d')).toEqual({ isDesktop: true, isSplit: false });
    expect(parseViewportCookie('m')).toEqual({ isDesktop: false, isSplit: false });
  });

  it('returns undefined when absent, so the header fallback runs', () => {
    expect(parseViewportCookie(undefined)).toBeUndefined();
    expect(parseViewportCookie('')).toBeUndefined();
  });
});

describe('guessViewportFromHeaders', () => {
  it('trusts the Sec-CH-UA-Mobile client hint first', () => {
    expect(guessViewportFromHeaders(headersOf({ 'sec-ch-ua-mobile': '?1' }))).toEqual({
      isDesktop: false,
      isSplit: false,
    });
    expect(
      guessViewportFromHeaders(
        headersOf({ 'sec-ch-ua-mobile': '?0', 'user-agent': 'Mozilla/5.0 (iPhone)' }),
      ),
    ).toEqual({ isDesktop: true, isSplit: true });
  });

  it('recognises phones and desktops from the user agent', () => {
    expect(
      guessViewportFromHeaders(
        headersOf({
          'user-agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        }),
      )?.isDesktop,
    ).toBe(false);
    expect(
      guessViewportFromHeaders(
        headersOf({
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
        }),
      )?.isDesktop,
    ).toBe(true);
    expect(
      guessViewportFromHeaders(
        headersOf({ 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/130.0' }),
      )?.isSplit,
    ).toBe(true);
  });

  it('does not guess for tablets or unknown agents', () => {
    expect(
      guessViewportFromHeaders(
        headersOf({ 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }),
      ),
    ).toBeUndefined();
    expect(
      guessViewportFromHeaders(
        headersOf({ 'user-agent': 'Mozilla/5.0 (Linux; Android 14; SM-X710) Safari/537.36' }),
      ),
    ).toBeUndefined();
    expect(guessViewportFromHeaders(headersOf({ 'user-agent': 'curl/8.0' }))).toBeUndefined();
    expect(guessViewportFromHeaders(headersOf({}))).toBeUndefined();
  });
});
