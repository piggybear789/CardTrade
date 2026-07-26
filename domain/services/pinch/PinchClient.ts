// domain/services/pinch/PinchClient.ts
//
// Thin HTTP client for the Pinch Payments REST API: OAuth2 client-credentials
// token acquisition with in-process caching, the required headers on every
// request, and normalised error handling.
//
// Contract notes taken from the Pinch docs:
//   * Token: POST https://auth.getpinch.com.au/connect/token with
//     grant_type=client_credentials. Tokens last ~1 hour, so they are cached and
//     refreshed slightly early rather than fetched per call.
//   * Every API request sends `Authorization: Bearer`, `pinch-version` and
//     (optionally) `Current-Merchant` for Managed Merchant calls.
//   * Errors: 400 returns either `{ errors: [{ message, field }] }` or a
//     FluentValidation array of `{ propertyName, errorMessage }`; 403 means the
//     token was rejected *or* carries a nonce replay result. Both shapes are
//     normalised here so callers never parse raw provider payloads.
//
// Server-only: uses `fetch` and holds credentials. Never import from client code.

import type { PinchConfig } from './config';

/** A single normalised field error from a 400 response. */
export interface PinchFieldError {
  field?: string;
  message: string;
}

/** Error thrown for any non-success Pinch response. */
export class PinchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors: PinchFieldError[] = [],
  ) {
    super(message);
    this.name = 'PinchApiError';
  }
}

/** Injectable fetch so tests can drive the client without network access. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** Per-request overrides. */
export interface RequestOptions {
  /**
   * Act on behalf of this Managed Merchant for this call only (`Current-Merchant`
   * header). Omit to use the configured default (the platform merchant).
   */
  merchantRef?: string;
  /**
   * Override the `Time-Travel` instant for this call (ISO-8601). Test mode only;
   * the header is never sent in `live`.
   */
  timeTravel?: string;
}

interface CachedToken {
  accessToken: string;
  /** Epoch ms after which the token must be re-fetched. */
  expiresAtMs: number;
}

/** Refresh this many ms before actual expiry so in-flight calls never race it. */
const TOKEN_SKEW_MS = 60_000;

export interface PinchClientOptions {
  config: PinchConfig;
  fetchFn?: FetchLike;
  /** Injectable clock (epoch ms) for deterministic token-expiry tests. */
  nowMs?: () => number;
}

/**
 * Normalise the several documented Pinch error body shapes into a message plus
 * field errors. Unknown shapes degrade to the raw text (truncated) so a
 * surprising response still produces a useful message.
 */
function parseErrorBody(status: number, raw: string): { message: string; fields: PinchFieldError[] } {
  if (!raw.trim()) {
    return { message: `Pinch request failed with status ${status}`, fields: [] };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { message: raw.slice(0, 300), fields: [] };
  }

  // FluentValidation array: [{ propertyName, errorMessage }]
  if (Array.isArray(body)) {
    const fields = body
      .map((entry) => {
        const e = entry as { propertyName?: string; errorMessage?: string; message?: string };
        const message = e.errorMessage ?? e.message;
        return message ? { field: e.propertyName || undefined, message } : null;
      })
      .filter((f): f is PinchFieldError => f !== null);
    return {
      message: fields.map((f) => f.message).join('; ') || `Pinch request failed (${status})`,
      fields,
    };
  }

  // Documented `{ errors: [{ message, field }] }` shape.
  const obj = body as { errors?: Array<{ message?: string; field?: string }>; message?: string };
  if (Array.isArray(obj.errors)) {
    const fields = obj.errors
      .map((e) => (e.message ? { field: e.field, message: e.message } : null))
      .filter((f): f is PinchFieldError => f !== null);
    return {
      message: fields.map((f) => f.message).join('; ') || `Pinch request failed (${status})`,
      fields,
    };
  }

  return { message: obj.message ?? `Pinch request failed (${status})`, fields: [] };
}

/**
 * Authenticated JSON transport for the Pinch API. One instance per process is
 * enough; the access token is cached on the instance.
 */
export class PinchClient {
  private readonly fetchFn: FetchLike;
  private readonly nowMs: () => number;
  private token: CachedToken | null = null;
  /** In-flight token request, shared so concurrent calls fetch one token. */
  private tokenRequest: Promise<CachedToken> | null = null;

  constructor(private readonly opts: PinchClientOptions) {
    this.fetchFn =
      opts.fetchFn ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  /** The environment this client targets (`test` or `live`). */
  get environment(): PinchConfig['environment'] {
    return this.opts.config.environment;
  }

  /**
   * Fetch (or reuse) an access token. Concurrent callers await the same request.
   */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAtMs > this.nowMs()) {
      return this.token.accessToken;
    }
    if (!this.tokenRequest) {
      this.tokenRequest = this.requestToken().finally(() => {
        this.tokenRequest = null;
      });
    }
    this.token = await this.tokenRequest;
    return this.token.accessToken;
  }

  /** Exchange the Application ID + secret for a bearer token. */
  private async requestToken(): Promise<CachedToken> {
    const { authUrl, clientId, clientSecret } = this.opts.config;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString();

    const response = await this.fetchFn(authUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const raw = await response.text();

    if (!response.ok) {
      // Deliberately does not echo the credentials or the raw provider body
      // beyond its message text.
      const { message } = parseErrorBody(response.status, raw);
      throw new PinchApiError(`Pinch authentication failed: ${message}`, response.status);
    }

    const parsed = JSON.parse(raw) as { access_token?: string; expires_in?: number };
    if (!parsed.access_token) {
      throw new PinchApiError('Pinch authentication returned no access_token', response.status);
    }
    const ttlMs = (parsed.expires_in ?? 3600) * 1000;
    return {
      accessToken: parsed.access_token,
      expiresAtMs: this.nowMs() + Math.max(ttlMs - TOKEN_SKEW_MS, 0),
    };
  }

  /**
   * Perform an authenticated JSON request against the API.
   *
   * @param path API path beginning with `/` (e.g. `/payers`).
   * @throws {PinchApiError} on any non-2xx response, except a 403 nonce-replay
   * which is unwrapped and returned as the existing record (idempotent retry).
   */
  async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'pinch-version': this.opts.config.apiVersion,
      accept: 'application/json',
    };
    // Per-request sub-merchant routing takes precedence over the configured
    // default, so one client can act for many managed merchants: a marketplace
    // collection settles to the seller's own account rather than the platform's.
    const merchantId = options?.merchantRef ?? this.opts.config.merchantId;
    if (merchantId) {
      headers['Current-Merchant'] = merchantId;
    }
    // `Time-Travel` makes Pinch's TEST environment behave as if the request
    // arrived at the given instant, so overnight direct-debit processing and
    // settlement can be triggered on demand. Hard-gated to test: sending it in
    // live is a documented no-op, but we refuse to emit it at all.
    if (this.opts.config.environment === 'test') {
      const timeTravel = options?.timeTravel ?? this.opts.config.timeTravel;
      if (timeTravel) {
        headers['Time-Travel'] = timeTravel;
      }
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    const response = await this.fetchFn(`${this.opts.config.apiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();

    if (!response.ok) {
      // A 403 carrying `isNonceReplay` is a success for our purposes: the
      // original submission already went through, so return that record rather
      // than double-charging on retry.
      const replay = this.unwrapNonceReplay<T>(response.status, raw);
      if (replay) return replay.data;

      const { message, fields } = parseErrorBody(response.status, raw);
      throw new PinchApiError(message, response.status, fields);
    }

    if (!raw.trim()) return undefined as T;
    return JSON.parse(raw) as T;
  }

  /** Detect and unwrap the documented 403 nonce-replay envelope. */
  private unwrapNonceReplay<T>(status: number, raw: string): { data: T } | null {
    if (status !== 403 || !raw.trim()) return null;
    try {
      const parsed = JSON.parse(raw) as { isNonceReplay?: boolean; data?: T };
      if (parsed?.isNonceReplay && parsed.data) return { data: parsed.data };
    } catch {
      return null;
    }
    return null;
  }
}
