// lib/actions/result.ts
//
// Shared discriminated result types for the server-action layer. Every action
// returns one of these so the UI can branch on `ok` and, on failure, render an
// inline error against the reported `field` (Req 1.3, 1.5) or a general message.
//
// This module is intentionally free of `'use server'` and any Supabase/React
// imports - it is pure types imported by both the action modules and the
// components that consume their results.

/** Successful action outcome carrying the produced value. */
export type ActionSuccess<T> = { ok: true; data: T };

/**
 * Failed action outcome. `error` is a typed, machine-branchable code; `message`
 * is a human-readable explanation; `field` (optional) names the offending input
 * so a form can surface the error inline.
 */
export type ActionFailure<E extends string> = {
  ok: false;
  error: E;
  message: string;
  field?: string;
};

/** Discriminated union the UI branches on. */
export type ActionResult<T, E extends string> = ActionSuccess<T> | ActionFailure<E>;

/** Build a success result. */
export function ok<T>(data: T): ActionSuccess<T> {
  return { ok: true, data };
}

/** Build a failure result. */
export function fail<E extends string>(
  error: E,
  message: string,
  field?: string,
): ActionFailure<E> {
  return field !== undefined
    ? { ok: false, error, message, field }
    : { ok: false, error, message };
}
