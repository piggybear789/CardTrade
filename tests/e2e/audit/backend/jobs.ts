// tests/e2e/audit/backend/jobs.ts
//
// JOB_ENDPOINT CALLS for the e2e UX audit suite: the scheduled money-moving routes
// (`/api/jobs/cash-sale-payouts`, `/api/jobs/trade-inspections`) driven on demand.
//
// Requirements:
//   26.1  a Pathway that depends on a Job_Endpoint calls it with the sandbox
//         `JOBS_SECRET` as a bearer token and verifies the outcome
//   26.2  the refusals for a missing or a wrong bearer token are drivable
//
// THE TARGET IS FIXED. Every call goes to the main App_Server on localhost:3100 and
// there is no `baseUrl` option. These routes pay sellers and release collateral, and
// the same secret may be configured on a deployment, so a helper that could be
// pointed elsewhere is one typo away from draining a real platform balance. The aux
// server does not need them: its Pathways reach the same work through the mock.
//
// The secret is read with `envValue` and placed only in the Authorization header. It
// is never returned, logged or put into an error message.

import { randomBytes } from 'node:crypto';

import { envValue, e2eSchema } from '../../support/db';

/** The only App_Server a job call may reach (design: Main, port 3100). */
export const JOB_SERVER_URL = 'http://localhost:3100';

/** Every Job_Endpoint under `app/api/jobs/`. */
export const JOB_NAMES = ['cash-sale-payouts', 'trade-inspections'] as const;

/** A Job_Endpoint name. */
export type JobName = (typeof JOB_NAMES)[number];

/**
 * How the request authenticates: the configured `JOBS_SECRET`, no Authorization
 * header at all, or a bearer token that is certainly not the secret.
 */
export type JobAuth = 'correct' | 'missing' | 'wrong';

/**
 * `POST` is how the suite and an operator call a job; `GET` is how Vercel Cron does
 * (`Authorization: Bearer $CRON_SECRET`). Both handlers run the same pass.
 */
export type JobMethod = 'POST' | 'GET';

/** The reply of one job call. `body` is the parsed JSON, or the raw text if it is not JSON. */
export interface JobResult {
  status: number;
  body: unknown;
}

/** True only when `name` is exactly a Job_Endpoint name. */
export function isJobName(name: unknown): name is JobName {
  return typeof name === 'string' && (JOB_NAMES as readonly string[]).includes(name);
}

/** The Authorization header for a mode. Throws when `correct` is asked and no secret is set. */
function authorization(auth: JobAuth): Record<string, string> {
  if (auth === 'missing') return {};
  if (auth === 'wrong') return { authorization: `Bearer e2e-wrong-${randomBytes(16).toString('hex')}` };
  const secret = envValue('JOBS_SECRET')?.trim();
  if (!secret) throw new Error('refusing job call: JOBS_SECRET is not set');
  return { authorization: `Bearer ${secret}` };
}

/**
 * The URL and request init for one job call. Exported so a unit test can check the
 * target and the header modes without a server. Throws for a name that is not a
 * Job_Endpoint, before any secret is read.
 */
export function jobRequest(
  name: string,
  auth: JobAuth = 'correct',
  method: JobMethod = 'POST',
): { url: string; init: RequestInit } {
  if (!isJobName(name)) {
    throw new Error(`refusing job call ${JSON.stringify(name)}: known jobs are ${JOB_NAMES.join(', ')}`);
  }
  return {
    url: `${JOB_SERVER_URL}/api/jobs/${name}`,
    init: { method, headers: authorization(auth), cache: 'no-store' },
  };
}

/**
 * Call a Job_Endpoint on the main App_Server and return its status and parsed body.
 * Does not judge the reply, so refusal Pathways can assert the 401 themselves.
 * Refuses to run unless the harness is pointed at the sandbox schema.
 */
export async function runJob(
  name: JobName,
  opts: { auth?: JobAuth; method?: JobMethod } = {},
): Promise<JobResult> {
  e2eSchema();
  const { url, init } = jobRequest(name, opts.auth ?? 'correct', opts.method ?? 'POST');
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep the text
  }
  return { status: response.status, body };
}

/**
 * Call a Job_Endpoint with the correct secret and return its JSON summary
 * (`{ ok: true, ...totals }`). Throws unless the route answered 200 with `ok: true`,
 * so a Pathway never asserts a state the job did not produce. The thrown message
 * carries the route's own `error` text, which names no secret.
 */
export async function runJobOk(
  name: JobName,
  opts: { method?: JobMethod } = {},
): Promise<Record<string, unknown>> {
  const result = await runJob(name, { auth: 'correct', method: opts.method });
  const body = result.body as { ok?: unknown; error?: unknown } | null;
  if (result.status !== 200 || typeof body !== 'object' || body === null || body.ok !== true) {
    const reason = body && typeof body === 'object' && typeof body.error === 'string' ? `: ${body.error}` : '';
    throw new Error(`job ${name} did not succeed (HTTP ${result.status})${reason}`);
  }
  return body as Record<string, unknown>;
}
