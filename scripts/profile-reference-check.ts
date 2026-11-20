/**
 * Runs one References background check outside Next and prints every outbound call
 * it makes: host + path, status, wall time, and for Anthropic / OpenAI / Gemini the
 * model, max_tokens, thinking setting and the token usage the provider reported.
 *
 * Usage (the `react-server` condition makes `server-only` resolve to its empty module):
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/profile-reference-check.ts <handle> [--cached]
 *
 * Writes a real `identity_check_runs` row, exactly as the website does. Query strings
 * are dropped from the log so no API key is printed.
 */
// `ws` is a transitive dependency with no `@types/ws` installed. Without this the
// script fails `tsc`, and because tsconfig includes `scripts/`, so does `next build`.
// @ts-expect-error -- no declaration file for 'ws'; only assigned to a global below.
import WebSocket from 'ws';
import { startOrLoadBackgroundCheck } from '@/lib/references/enrichment';

// supabase-js needs a global WebSocket, which Node gained only in 22.
if (!('WebSocket' in globalThis)) (globalThis as Record<string, unknown>).WebSocket = WebSocket;

type CallLog = {
  at: number;
  ms: number;
  method: string;
  target: string;
  status: number | string;
  model?: string;
  maxTokens?: number;
  thinking?: string;
  usage?: string;
};

const handle = process.argv[2];
const useCache = process.argv.includes('--cached');
if (!handle) {
  console.error('Usage: profile-reference-check.ts <handle> [--cached]');
  process.exit(1);
}

const t0 = Date.now();
const calls: CallLog[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const started = Date.now();
  const entry: CallLog = {
    at: started - t0,
    ms: 0,
    method: init?.method ?? 'GET',
    target: `${url.host}${url.pathname}`.slice(0, 90),
    status: 'pending',
  };
  if (typeof init?.body === 'string' && init.body.startsWith('{')) {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (typeof body.model === 'string') entry.model = body.model;
      const max = body.max_tokens ?? (body.generationConfig as { maxOutputTokens?: number } | undefined)?.maxOutputTokens;
      if (typeof max === 'number') entry.maxTokens = max;
      if (body.thinking) entry.thinking = JSON.stringify(body.thinking);
    } catch {
      // Not JSON we care about.
    }
  }
  calls.push(entry);
  try {
    const res = await realFetch(input, init);
    entry.status = res.status;
    entry.ms = Date.now() - started;
    if (entry.model) {
      const copy = res.clone();
      copy
        .json()
        .then((json: { usage?: Record<string, unknown>; usageMetadata?: Record<string, unknown>; error?: unknown; stop_reason?: string }) => {
          const usage = json.usage ?? json.usageMetadata;
          entry.usage = usage ? JSON.stringify(usage) : JSON.stringify(json.error ?? null).slice(0, 200);
          if (json.stop_reason) entry.usage += ` stop=${json.stop_reason}`;
        })
        .catch(() => undefined);
    }
    return res;
  } catch (error) {
    entry.status = error instanceof Error ? error.name : 'error';
    entry.ms = Date.now() - started;
    throw error;
  }
};

async function main() {
  const dossier = await startOrLoadBackgroundCheck(
    { query: `@${handle.replace(/^@/, '')}`, platform: 'instagram', forceRefresh: !useCache },
    { onStep: (step) => console.log(`[${Date.now() - t0}ms] step`, JSON.stringify(step)) },
  );
  const total = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 300));

  console.log('\n--- outbound calls ---');
  for (const c of calls.sort((a, b) => a.at - b.at)) {
    const ai = c.model ? ` model=${c.model} max=${c.maxTokens ?? '-'} thinking=${c.thinking ?? 'unset'} usage=${c.usage ?? '-'}` : '';
    console.log(`+${String(c.at).padStart(6)}ms ${String(c.ms).padStart(6)}ms ${String(c.status).padEnd(4)} ${c.method.padEnd(4)} ${c.target}${ai}`);
  }
  console.log(`\nTotal: ${total}ms, ${calls.length} calls`);
  if (!dossier) {
    console.log('No dossier (invalid query).');
    return;
  }
  console.log('\n--- dossier ---');
  console.log(
    JSON.stringify(
      {
        runId: dossier.runId,
        status: dossier.status,
        tier: dossier.assessment?.tier,
        judge: dossier.judge,
        ebayFound: dossier.ebay?.found ?? null,
        instagram: dossier.forensics?.visibleProfile
          ? {
              followers: dossier.forensics.visibleProfile.followersCount,
              posts: dossier.forensics.visibleProfile.postsCount,
            }
          : null,
        webMentions: dossier.webMentions.map((m) => `${m.riskFlag} ${m.sourceLabel}: ${m.title}`),
        scamMatches: dossier.scamRisk.matchedReportCount,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
