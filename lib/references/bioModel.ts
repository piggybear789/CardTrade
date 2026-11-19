import 'server-only';

// lib/references/bioModel.ts
//
// One cheap call to Haiku that phrases a handle's structured facts as a short profile line
// (0171). The model is `claude-haiku-5-5` on the same AWS-hosted endpoint the importer
// uses (`ANTHROPIC_AWS_API_KEY`, `ANTHROPIC_AWS_WORKSPACE_ID`, `AWS_REGION`).
//
// WHAT KEEPS IT CHEAP. This model THINKS by default, and thinking is billed as output: a
// test with a 120-token cap spent all of it thinking and returned no text. So thinking is
// switched off (`thinking: { type: 'disabled' }`). A call is then about 260 tokens in and
// 35 out, and the output is capped at 160. Nothing is retried, and a thin set of facts
// never reaches the model at all (`bioFactsAreEnough`).
//
// WHAT KEEPS IT SAFE. The prompt carries structured facts only (`domain/references/bio.ts`),
// the reply must arrive inside `<bio>` tags and finish on its own (`end_turn`, not
// `max_tokens`), and it is then held to `bioProblem`. With thinking off the model sometimes
// writes its drafting notes into the text; the tags and the length rules throw those away.
// A rejected reply is reported, never repaired by hand.

import {
  bioFactsAreEnough,
  bioPrompt,
  bioProblem,
  parseBioReply,
  type BioFacts,
} from '@/domain/references/bio';

export const BIO_MODEL = 'claude-haiku-5-5';

const MAX_OUTPUT_TOKENS = 160;
const REQUEST_TIMEOUT_MS = 20_000;

export type BioOutcome =
  | { ok: true; bio: string; model: string; inputTokens: number; outputTokens: number }
  | {
      ok: false;
      reason: 'NOT_CONFIGURED' | 'TOO_THIN' | 'DECLINED' | 'REJECTED' | 'MODEL_ERROR';
      /** Why, for a staff member. Never the model's raw text. */
      detail?: string;
    };

function config(): { key: string; workspace: string; region: string } | null {
  const key = process.env.ANTHROPIC_AWS_API_KEY?.trim();
  const workspace = process.env.ANTHROPIC_AWS_WORKSPACE_ID?.trim();
  return key && workspace ? { key, workspace, region: process.env.AWS_REGION?.trim() || 'us-west-2' } : null;
}

export function bioModelConfigured(): boolean {
  return config() !== null;
}

/** Phrase `facts` as a profile line, or say why not. Never throws. */
export async function writeBio(facts: BioFacts): Promise<BioOutcome> {
  if (!bioFactsAreEnough(facts)) return { ok: false, reason: 'TOO_THIN' };
  const settings = config();
  if (!settings) return { ok: false, reason: 'NOT_CONFIGURED' };

  let response: Response;
  try {
    response = await fetch(`https://aws-external-anthropic.${settings.region}.api.aws/v1/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${settings.key}`,
        'anthropic-version': '2023-06-01',
        'anthropic-workspace-id': settings.workspace,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: BIO_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: bioPrompt(facts) }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    return { ok: false, reason: 'MODEL_ERROR', detail: error instanceof Error ? error.message : 'request failed' };
  }
  if (!response.ok) return { ok: false, reason: 'MODEL_ERROR', detail: `The model returned ${response.status}.` };

  const body = (await response.json().catch(() => null)) as {
    content?: { type?: string; text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  } | null;
  if (!body) return { ok: false, reason: 'MODEL_ERROR', detail: 'The reply could not be read.' };
  if (body.stop_reason !== 'end_turn') {
    return { ok: false, reason: 'MODEL_ERROR', detail: 'The reply was cut off before it finished.' };
  }

  const text = body.content?.find((block) => block.type === 'text')?.text ?? '';
  const bio = parseBioReply(text);
  if (!bio) return { ok: false, reason: 'DECLINED', detail: 'The model found too little to say.' };
  const problem = bioProblem(bio, facts);
  if (problem) return { ok: false, reason: 'REJECTED', detail: `The draft was thrown away: ${problem}.` };

  return {
    ok: true,
    bio,
    model: BIO_MODEL,
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };
}
