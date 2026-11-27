import 'server-only';

// lib/enrichment/aiTraderCheck.ts
//
// Ultra-cheap multimodal AI orchestrator for the chat-first trader check.
// Automatically routes to the cheapest configured multimodal model:
//   1. Gemini 2.5 Flash-Lite (`GEMINI_API_KEY`)        ~$0.0001 / check
//   2. OpenAI GPT-4o-mini (`OPENAI_API_KEY`)           ~$0.0002 / check
//   3. Claude Haiku (`ANTHROPIC_API_KEY` / AWS key)    ~$0.0005 / check
//
// Degrades cleanly to a deterministic plain-English verdict synthesized directly
// from live eBay / NoDitto / scam-hash / forensics data when no LLM key is set.

import sharp from 'sharp';

import type { BackgroundCheckDossier, VisibleProfileMetrics } from '@/domain/references/enrichment';
import { parseSmartCheckInput } from '@/domain/references/lookup';
import { startOrLoadBackgroundCheck } from '@/lib/references/enrichment';

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AttachedScreenshot {
  buffer: Buffer;
  mimeType: string;
}

export interface AiTraderCheckResult {
  reply: string;
  model: string | null;
  dossier: BackgroundCheckDossier | null;
  needsAiKeyForImages: boolean;
}

interface ExtractedFromChat {
  query: string | null;
  facebookUrl: string | null;
  location: string | null;
  paymentDetail: string | null;
  payeeName: string | null;
  psaCertNumber: string | null;
  cardQuery: string | null;
  askingPrice: string | null;
  dmText: string | null;
  visibleProfile: VisibleProfileMetrics | null;
  visualNotes: string | null;
}

type Provider =
  | { kind: 'gemini'; apiKey: string; model: string }
  | { kind: 'openai'; apiKey: string; model: string }
  | { kind: 'anthropic'; apiKey: string; workspaceId?: string; baseUrl: string; model: string; aws: boolean };

function resolveCheapProvider(): Provider | null {
  const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY)?.trim();
  if (geminiKey) {
    return {
      kind: 'gemini',
      apiKey: geminiKey,
      model: process.env.GEMINI_CHECK_MODEL?.trim() || 'gemini-2.5-flash-lite',
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      kind: 'openai',
      apiKey: openaiKey,
      model: process.env.OPENAI_CHECK_MODEL?.trim() || 'gpt-4o-mini',
    };
  }

  const awsKey = process.env.ANTHROPIC_AWS_API_KEY?.trim();
  const awsWorkspace = process.env.ANTHROPIC_AWS_WORKSPACE_ID?.trim();
  if (awsKey && awsWorkspace) {
    return {
      kind: 'anthropic',
      apiKey: awsKey,
      workspaceId: awsWorkspace,
      // The AWS-hosted Messages API, authenticated with a Bearer token, as every other
      // AI module here calls it. This used to default to api.anthropic.com with the AWS
      // key as `x-api-key`, which answered 401 and silently dropped every chat turn to
      // the deterministic reply.
      baseUrl: (
        process.env.ANTHROPIC_AWS_BASE_URL?.trim() ||
        `https://aws-external-anthropic.${process.env.AWS_REGION?.trim() || 'us-west-2'}.api.aws`
      ).replace(/\/$/, ''),
      model: 'claude-haiku-5-5',
      aws: true,
    };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    return {
      kind: 'anthropic',
      apiKey: anthropicKey,
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-haiku-4-5-20251001',
      aws: false,
    };
  }

  return null;
}

async function prepareImageBase64(buffer: Buffer): Promise<string> {
  const resized = await sharp(buffer)
    .rotate()
    .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
  return resized.toString('base64');
}

async function callCheapModel(
  provider: Provider,
  opts: {
    system: string;
    userText: string;
    imagesBase64?: string[];
    maxTokens?: number;
    jsonMode?: boolean;
  },
): Promise<string | null> {
  const images = opts.imagesBase64 ?? [];
  const maxTokens = opts.maxTokens ?? 450;

  if (provider.kind === 'gemini') {
    const parts: Array<Record<string, unknown>> = [];
    for (const data of images) {
      parts.push({ inline_data: { mime_type: 'image/jpeg', data } });
    }
    parts.push({ text: opts.userText });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.2,
          ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (!res?.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    return json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() || null;
  }

  if (provider.kind === 'openai') {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: opts.userText }];
    for (const data of images) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${data}`, detail: 'low' },
      });
    }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: maxTokens,
        temperature: 0.2,
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content },
        ],
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (!res?.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    return json?.choices?.[0]?.message?.content?.trim() || null;
  }

  // Anthropic Messages API
  const content: Array<Record<string, unknown>> = [];
  for (const data of images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data },
    });
  }
  content.push({ type: 'text', text: opts.userText });

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...(provider.aws ? { authorization: `Bearer ${provider.apiKey}` } : { 'x-api-key': provider.apiKey }),
  };
  if (provider.workspaceId) headers['anthropic-workspace-id'] = provider.workspaceId;

  const res = await fetch(`${provider.baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens,
      // Haiku 5.5 thinks by default and bills it as output, which can spend the whole
      // cap on these short replies and return no text.
      thinking: { type: 'disabled' },
      system: opts.system,
      messages: [{ role: 'user', content }],
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!res?.ok) return null;
  const json = (await res.json().catch(() => null)) as {
    content?: Array<{ type?: string; text?: string }>;
  } | null;
  return json?.content?.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim() || null;
}

const EXTRACT_SYSTEM = `Extract structured trading-card seller check signals from the user's message and any attached screenshots (Instagram/Facebook/eBay profile, Messenger/IG DM, listing photo with PSA slab, or PayID/bank transfer screen).
Return ONLY valid JSON with these exact keys (use null when not clearly visible):
{
  "query": string | null,
  "facebookUrl": string | null,
  "location": string | null,
  "paymentDetail": string | null,
  "payeeName": string | null,
  "psaCertNumber": string | null,
  "cardQuery": string | null,
  "askingPrice": string | null,
  "dmText": string | null,
  "visibleProfile": {
    "postsCount": number | null,
    "followersCount": number | null,
    "followingCount": number | null,
    "isPrivate": boolean | null,
    "category": string | null,
    "bio": string | null,
    "joinedText": string | null
  } | null,
  "visualNotes": string | null
}`;

function safeParseExtracted(raw: string | null): ExtractedFromChat | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
    const vp = obj.visibleProfile && typeof obj.visibleProfile === 'object'
      ? (obj.visibleProfile as Record<string, unknown>)
      : null;

    const visibleProfile: VisibleProfileMetrics | null =
      vp &&
      (num(vp.postsCount) !== null ||
        num(vp.followersCount) !== null ||
        num(vp.followingCount) !== null ||
        bool(vp.isPrivate) !== null ||
        str(vp.category) !== null ||
        str(vp.bio) !== null)
        ? {
            platform: str(vp.platform) ?? 'instagram',
            handle: str(vp.handle) ?? str(obj.query),
            displayName: str(vp.displayName),
            source: 'SCREENSHOT',
            postsCount: num(vp.postsCount),
            followersCount: num(vp.followersCount),
            followingCount: num(vp.followingCount),
            isPrivate: bool(vp.isPrivate),
            isVerified: bool(vp.isVerified),
            category: str(vp.category),
            bio: str(vp.bio),
          }
        : null;

    return {
      query: str(obj.query),
      facebookUrl: str(obj.facebookUrl),
      location: str(obj.location),
      paymentDetail: str(obj.paymentDetail),
      payeeName: str(obj.payeeName),
      psaCertNumber: str(obj.psaCertNumber),
      cardQuery: str(obj.cardQuery),
      askingPrice: str(obj.askingPrice),
      dmText: str(obj.dmText),
      visibleProfile,
      visualNotes: str(obj.visualNotes),
    };
  } catch {
    return null;
  }
}

function buildDeterministicReply(
  dossier: BackgroundCheckDossier,
  hadImagesWithoutKey: boolean,
): string {
  const lines: string[] = [];

  if (dossier.assessment.tier === 'WARNING_FLAGGED') {
    lines.push(`Hold off: I found red flags for ${dossier.queryLabel}.`);
  } else if (dossier.assessment.tier === 'ID_VERIFIED') {
    lines.push(`${dossier.queryLabel} is ID-verified on NoDitto.`);
  } else if (dossier.assessment.tier === 'ESTABLISHED_FOOTPRINT') {
    lines.push(`${dossier.queryLabel} has an established public footprint.`);
  } else if (dossier.ebay?.found) {
    lines.push(
      `Found a real eBay account for ${dossier.ebay.username}, though there aren't verified NoDitto references yet.`,
    );
  } else {
    lines.push(`Not much public history showed up for ${dossier.queryLabel} yet.`);
  }

  const facts: string[] = [];
  if (dossier.scamRisk.matchedReportCount > 0) {
    facts.push(`Matches ${dossier.scamRisk.matchedReportCount} scam report(s) (${dossier.scamRisk.matchedKinds.join(', ')})`);
  }
  if (dossier.psaCert?.riskLevel === 'HIGH' && dossier.psaCert.riskReason) {
    facts.push(dossier.psaCert.riskReason);
  }
  if (dossier.priceComp?.riskReason) {
    facts.push(dossier.priceComp.riskReason);
  }
  if (dossier.paymentForensics?.flags[0]) {
    facts.push(dossier.paymentForensics.flags[0].label);
  }
  if (dossier.dmAnalysis?.flags[0]) {
    facts.push(dossier.dmAnalysis.flags[0].label);
  }
  if (dossier.forensics?.mlPrediction && dossier.forensics.mlPrediction.band !== 'LOW') {
    facts.push(`Profile metrics score ${dossier.forensics.mlPrediction.percent}% fake-account likelihood`);
  }
  if (dossier.ebay?.found) {
    if (dossier.ebay.feedbackScore !== null) {
      const memberPart = dossier.ebay.memberSince ? `, member since ${dossier.ebay.memberSince}` : '';
      const salesPart =
        dossier.ebay.recentSales && dossier.ebay.recentSales.length > 0
          ? `, ${dossier.ebay.recentSales.length} verified recent sale(s)`
          : '';
      facts.push(
        `eBay (${dossier.ebay.username}): ${dossier.ebay.feedbackScore.toLocaleString('en-US')} feedback (${dossier.ebay.feedbackPercentage ?? '—'}% positive${memberPart}${salesPart})`,
      );
    } else {
      facts.push(`eBay account @${dossier.ebay.username} confirmed (${dossier.ebay.activeListingsCount} active listings)`);
    }
  }
  if (dossier.forensics?.visibleProfile?.followersCount != null) {
    const vp = dossier.forensics.visibleProfile;
    facts.push(
      `Instagram profile: ${vp.followersCount!.toLocaleString('en-US')} followers${vp.postsCount != null ? `, ${vp.postsCount.toLocaleString('en-US')} posts` : ''}`,
    );
  }
  if (dossier.webMentions.length > 0) {
    facts.push(`${dossier.webMentions.length} public web mention(s) found`);
  }
  if (dossier.sherlock.length > 0) {
    facts.push(`Matching handle found on ${dossier.sherlock.length} other public site(s)`);
  }

  if (facts.length > 0) {
    lines.push(facts.join('. ') + '.');
  }

  if (hadImagesWithoutKey) {
    lines.push(
      'Tip: screenshot AI reading needs a cheap multimodal key (`GEMINI_API_KEY` for Gemini 2.5 Flash-Lite or `OPENAI_API_KEY` for GPT-4o-mini) in `.env.local`.',
    );
  } else if (dossier.assessment.tier === 'LIMITED_FOOTPRINT') {
    lines.push('Drop a screenshot of their profile, DM, or PayID details here to dig deeper.');
  }

  return lines.join(' ');
}

const VERDICT_SYSTEM = `You are NoDitto's sharp, no-BS trading-card anti-scam assistant.
Write a short, plain-English verdict (2 to 4 crisp sentences max, no filler, no markdown headers) answering whether this trader/deal looks real or risky.
Rules:
- Base EVERY claim strictly on the live check JSON and any attached screenshots. Never invent feedback scores, dates, or scams not in the data.
- Call out red flags first (scam hash match, stolen PSA cert listed by another eBay seller, steep below-market price, PayID/bank name mismatch, DM scam script, follow-farming/burner profile, 2025+ Facebook ID era).
- If eBay confirms an account exists with 0 active listings, say so plainly and remind the buyer to tap the eBay profile link to check feedback/sold history.
- End with one practical next step (e.g. drop a screenshot of their chat/PayID, or use PayPal Goods & Services / NoDitto escrow).`;

/**
 * Runs a single chat turn: extracts signals from message + dropped screenshots (if an
 * ultra-cheap multimodal key is configured), executes our live eBay/NoDitto/forensics/OSINT
 * check, and returns a natural AI verdict + structured dossier.
 */
export async function runAiTraderCheck(input: {
  message: string;
  screenshots?: AttachedScreenshot[];
  history?: ChatHistoryTurn[];
  currentTarget?: string | null;
  forceRefresh?: boolean;
}): Promise<AiTraderCheckResult> {
  const provider = resolveCheapProvider();
  const message = (input.message ?? '').trim();
  const screenshots = (input.screenshots ?? []).slice(0, 3);
  const imagesBase64 =
    provider && screenshots.length > 0
      ? await Promise.all(screenshots.map((s) => prepareImageBase64(s.buffer)))
      : [];

  const needsAiKeyForImages = !provider && screenshots.length > 0;

  // Step 1: Parse text + (optionally) extract structured signals from screenshots via cheap vision
  const smart = parseSmartCheckInput(message);
  let extracted: ExtractedFromChat | null = null;
  if (provider && (imagesBase64.length > 0 || message.length > 24)) {
    const rawExtracted = await callCheapModel(provider, {
      system: EXTRACT_SYSTEM,
      userText: [
        input.currentTarget ? `Current subject being checked: ${input.currentTarget}` : '',
        message ? `User message: ${message}` : 'Analyze the attached screenshot(s).',
      ]
        .filter(Boolean)
        .join('\n'),
      imagesBase64,
      maxTokens: 350,
      jsonMode: true,
    });
    extracted = safeParseExtracted(rawExtracted);
  }

  // An @handle or a link the member typed beats the extractor's copy of it: the model
  // drops the "@", and a bare word is checked as a PERSON NAME, which skips eBay and the
  // handle's references (seen live: "is @x legit?" became a name search for "x").
  const typedIdentifier = /^(?:@|https?:\/\/)/i.test(smart.query) ? smart.query : null;
  const effectiveQuery =
    typedIdentifier ||
    extracted?.query ||
    smart.query ||
    input.currentTarget?.trim() ||
    extracted?.paymentDetail ||
    extracted?.psaCertNumber ||
    '';

  let dossier: BackgroundCheckDossier | null = null;
  if (effectiveQuery) {
    dossier = await startOrLoadBackgroundCheck({
      query: effectiveQuery,
      location: extracted?.location ?? null,
      facebookUrl: extracted?.facebookUrl ?? smart.facebookUrl ?? null,
      paymentDetail: extracted?.paymentDetail ?? smart.paymentDetail ?? null,
      payeeName: extracted?.payeeName ?? null,
      psaCertNumber: extracted?.psaCertNumber ?? smart.psaCertNumber ?? null,
      cardQuery: extracted?.cardQuery ?? null,
      askingPrice: (() => {
        const raw = extracted?.askingPrice ?? smart.askingPrice ?? null;
        if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
        if (typeof raw === 'string') {
          const parsed = Number.parseFloat(raw.replace(/[^0-9.]/g, ''));
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        }
        return null;
      })(),
      askingCurrency: 'AUD',
      dmText: extracted?.dmText ?? smart.dmText ?? null,
      visibleProfile: extracted?.visibleProfile ?? null,
      // A DM, payment detail or cert is judged on top of a stored run without searching
      // the web again, and profile figures read off a screenshot skip the cache by
      // themselves. Forcing a fresh run here made nearly every chat turn (any message of
      // six words or more reads as a DM) a ~50k-token web search.
      forceRefresh: Boolean(input.forceRefresh),
    });
  }

  // Step 2: Generate concise natural-language verdict using the cheap model (or clean fallback)
  if (provider) {
    const historySnippet = (input.history ?? [])
      .slice(-4)
      .map((h) => `${h.role === 'user' ? 'Buyer' : 'Assistant'}: ${h.text}`)
      .join('\n');

    const compactDossier = dossier
      ? {
          queryLabel: dossier.queryLabel,
          tier: dossier.assessment.tier,
          signalsSummary: dossier.assessment.signalsSummary,
          scamRisk: dossier.scamRisk,
          ebay: dossier.ebay,
          psaCert: dossier.psaCert,
          priceComp: dossier.priceComp,
          paymentForensics: dossier.paymentForensics,
          forensics: dossier.forensics,
          dmAnalysis: dossier.dmAnalysis,
          lookalikes: dossier.lookalikes,
          matchedMembers: dossier.matchedMembers,
          sherlockCount: dossier.sherlock.length,
          webMentions: dossier.webMentions.slice(0, 3),
        }
      : null;

    const aiReply = await callCheapModel(provider, {
      system: VERDICT_SYSTEM,
      userText: [
        historySnippet ? `Recent chat:\n${historySnippet}` : '',
        `Latest buyer message: ${message || '(uploaded screenshot)'}`,
        extracted?.visualNotes ? `Screenshot observations: ${extracted.visualNotes}` : '',
        compactDossier ? `Live verification data:\n${JSON.stringify(compactDossier)}` : 'No live target identifier was found yet.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      // The extract call has already read the screenshots into fields and visual notes,
      // so they are sent again only when that read failed.
      imagesBase64: extracted ? [] : imagesBase64,
      maxTokens: 280,
    });

    if (aiReply) {
      return {
        reply: aiReply,
        model: provider.model,
        dossier,
        needsAiKeyForImages: false,
      };
    }
  }

  if (dossier) {
    return {
      reply: buildDeterministicReply(dossier, needsAiKeyForImages),
      model: null,
      dossier,
      needsAiKeyForImages,
    };
  }

  return {
    reply: needsAiKeyForImages
      ? 'To read screenshots directly in chat, add a cheap multimodal key (`GEMINI_API_KEY` for Gemini 2.5 Flash-Lite or `OPENAI_API_KEY` for GPT-4o-mini) to `.env.local`, or type their @handle, eBay username or PayID below.'
      : 'Drop a handle, Instagram/Facebook/eBay link, PayID, PSA cert #, or DM message and I will check it.',
    model: null,
    dossier: null,
    needsAiKeyForImages,
  };
}
