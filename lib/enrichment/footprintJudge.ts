import 'server-only';

// lib/enrichment/footprintJudge.ts
//
// Super-cheap holistic LLM judge for a trader's cross-platform digital footprint.
// Replaces brittle programmatic warnings (like flagging a real collector with 3K followers
// and 134 eBay feedback for having 12 curated IG posts) with holistic reasoning.
//
// Provider priority (cheapest first — matches `lib/references/bioModel.ts`):
//   1. `ANTHROPIC_AWS_API_KEY` + `ANTHROPIC_AWS_WORKSPACE_ID` -> `claude-haiku-5-5` (thinking disabled)
//   2. `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY`      -> `gemini-2.5-flash-lite`
//   3. `OPENAI_API_KEY`                                       -> `gpt-4o-mini`
//   4. `ANTHROPIC_API_KEY`                                    -> `claude-haiku-4-5-20251001`
//
// When no LLM key is configured, falls back to a strict, low-noise deterministic judge
// that ONLY flags concrete verified red flags (never heuristic noise on established accounts).

import type {
  BackgroundCheckDossier,
  FootprintJudgeVerdict,
  FootprintJudgeWarning,
  RealnessTier,
} from '@/domain/references/enrichment';
import { filterOpenWebMentions } from '@/domain/references/footprintPresentation';

type JudgeProvider =
  | { kind: 'anthropic-aws'; key: string; workspace: string; region: string; model: string }
  | { kind: 'gemini'; key: string; model: string }
  | { kind: 'openai'; key: string; model: string }
  | { kind: 'anthropic'; key: string; model: string };

function resolveJudgeProvider(): JudgeProvider | null {
  const awsKey = process.env.ANTHROPIC_AWS_API_KEY?.trim();
  const awsWorkspace = process.env.ANTHROPIC_AWS_WORKSPACE_ID?.trim();
  if (awsKey && awsWorkspace) {
    return {
      kind: 'anthropic-aws',
      key: awsKey,
      workspace: awsWorkspace,
      region: process.env.AWS_REGION?.trim() || 'us-west-2',
      model: 'claude-haiku-5-5',
    };
  }

  const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY)?.trim();
  if (geminiKey) {
    return {
      kind: 'gemini',
      key: geminiKey,
      model: process.env.GEMINI_CHECK_MODEL?.trim() || 'gemini-2.5-flash-lite',
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      kind: 'openai',
      key: openaiKey,
      model: process.env.OPENAI_CHECK_MODEL?.trim() || 'gpt-4o-mini',
    };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    return {
      kind: 'anthropic',
      key: anthropicKey,
      model: 'claude-haiku-4-5-20251001',
    };
  }

  return null;
}

const JUDGE_SYSTEM = `You are a trading-card trust & footprint judge for NoDitto.
Given a JSON snapshot of a trader's verified and public cross-platform footprint (NoDitto refs, eBay history/sales, Instagram metrics, open-web mentions, scam DB, PSA cert, price comps, payment forensics), return ONLY valid JSON:
{
  "tier": "ID_VERIFIED" | "ESTABLISHED_FOOTPRINT" | "LIMITED_FOOTPRINT" | "WARNING_FLAGGED",
  "summary": "One plain, grounded sentence (<= 180 chars) describing the overall footprint honestly.",
  "warnings": [{ "severity": "HIGH" | "CAUTION", "title": "Short title", "detail": "One plain sentence" }],
  "highlights": ["2 to 4 crisp 2-4 word factual pills, e.g. '134 eBay feedback', 'Member since Aug 2021', '3,039 IG followers'"]
}

Critical rules:
- Judge HOLISTICALLY. Never warn about normal collector traits (e.g. having 10-20 curated Instagram posts, 0 active eBay listings right now when they have past verified sales, following other collectors back, or having a hobby bio like '#pokemon #tcg') when the account shows real cross-platform history.
- Keep "warnings" EMPTY ([]) unless there is a concrete, genuine risk signal: a scam database match, a PSA cert listed by a different seller, extreme below-market pricing, PayID/bank name mismatch, DM scam script, explicit public scam call-out, or clear lookalike / impersonation / throwaway signs when the account has NO established footprint.
- Base every fact strictly on the JSON input. Never invent dates, scores, or claims.
- "facebookSearchIndex" is what search engines hold about a Facebook profile. A profile missing from search proves nothing (many people hide theirs). Other accounts with the same name are worth one CAUTION only when there are 3 or more and nothing else establishes the account; never call the person a scammer for sharing a name.
- Use "ID_VERIFIED" only if a matched NoDitto member has identityVerified: true and there are no HIGH warnings.
- Use "ESTABLISHED_FOOTPRINT" if there is clear multi-year or multi-platform real activity (e.g. eBay feedback >= 10, verified sales, strong IG + community mentions, or >= 2 positive NoDitto refs) and no HIGH warnings.
- Use "WARNING_FLAGGED" only when there is at least one HIGH warning.`;

async function callCheapJudge(provider: JudgeProvider, payloadJson: string): Promise<string | null> {
  if (provider.kind === 'anthropic-aws') {
    const res = await fetch(
      `https://aws-external-anthropic.${provider.region}.api.aws/v1/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${provider.key}`,
          'anthropic-version': '2023-06-01',
          'anthropic-workspace-id': provider.workspace,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 320,
          thinking: { type: 'disabled' },
          system: JUDGE_SYSTEM,
          messages: [{ role: 'user', content: payloadJson }],
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      },
    ).catch(() => null);
    if (!res?.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      content?: Array<{ type?: string; text?: string }>;
    } | null;
    return body?.content?.find((b) => b.type === 'text')?.text?.trim() || null;
  }

  if (provider.kind === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(provider.key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: JUDGE_SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: payloadJson }] }],
        generationConfig: {
          maxOutputTokens: 320,
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res?.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    return json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() || null;
  }

  if (provider.kind === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 320,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: JUDGE_SYSTEM },
          { role: 'user', content: payloadJson },
        ],
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res?.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    return json?.choices?.[0]?.message?.content?.trim() || null;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': provider.key,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 320,
      thinking: { type: 'disabled' },
      system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: payloadJson }],
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    content?: Array<{ type?: string; text?: string }>;
  } | null;
  return body?.content?.find((b) => b.type === 'text')?.text?.trim() || null;
}

const VALID_TIERS = new Set<RealnessTier>([
  'ID_VERIFIED',
  'ESTABLISHED_FOOTPRINT',
  'LIMITED_FOOTPRINT',
  'WARNING_FLAGGED',
]);

function parseJudgeJson(raw: string | null, model: string): FootprintJudgeVerdict | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const tier = typeof obj.tier === 'string' && VALID_TIERS.has(obj.tier as RealnessTier)
      ? (obj.tier as RealnessTier)
      : null;
    const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
    if (!tier || !summary) return null;

    const warnings: FootprintJudgeWarning[] = Array.isArray(obj.warnings)
      ? obj.warnings
          .flatMap<FootprintJudgeWarning>((w) => {
            if (!w || typeof w !== 'object') return [];
            const rec = w as Record<string, unknown>;
            const severity: 'HIGH' | 'CAUTION' | null =
              rec.severity === 'HIGH' ? 'HIGH' : rec.severity === 'CAUTION' ? 'CAUTION' : null;
            const title = typeof rec.title === 'string' ? rec.title.trim() : '';
            const detail = typeof rec.detail === 'string' ? rec.detail.trim() : '';
            return severity && title ? [{ severity, title, detail }] : [];
          })
          .slice(0, 4)
      : [];

    const highlights = Array.isArray(obj.highlights)
      ? obj.highlights
          .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
          .map((h) => h.trim())
          .slice(0, 4)
      : [];

    return {
      source: 'llm',
      model,
      tier,
      summary,
      warnings,
      highlights,
    };
  } catch {
    return null;
  }
}

/**
 * High-precision deterministic fallback used when no LLM key is configured.
 * Strictly avoids noisy heuristics on established accounts — only flags concrete red flags.
 */
export function buildDeterministicJudgeVerdict(
  dossier: Pick<
    BackgroundCheckDossier,
    | 'assessment'
    | 'scamRisk'
    | 'forensics'
    | 'paymentForensics'
    | 'psaCert'
    | 'priceComp'
    | 'dmAnalysis'
    | 'matchedMembers'
    | 'ebay'
    | 'sherlock'
    | 'webMentions'
  > & { lookalikes?: BackgroundCheckDossier['lookalikes'] },
): FootprintJudgeVerdict {
  const warnings: FootprintJudgeWarning[] = [];

  if (dossier.scamRisk.matchedReportCount > 0) {
    warnings.push({
      severity: 'HIGH',
      title: `Matched ${dossier.scamRisk.matchedReportCount} scam report${dossier.scamRisk.matchedReportCount === 1 ? '' : 's'}`,
      detail: `Matched on ${dossier.scamRisk.matchedKinds.join(', ')}. Avoid unprotected bank transfer or PayID.`,
    });
  } else if (dossier.scamRisk.nameMatchCount > 0) {
    warnings.push({
      severity: 'CAUTION',
      title: `${dossier.scamRisk.nameMatchCount} report${dossier.scamRisk.nameMatchCount === 1 ? '' : 's'} mention a similar name`,
      detail: 'Names can overlap — double-check payment details before sending money.',
    });
  }

  if (dossier.psaCert?.riskLevel === 'HIGH') {
    warnings.push({
      severity: 'HIGH',
      title: `PSA cert #${dossier.psaCert.certNumber} listed elsewhere on eBay`,
      detail: dossier.psaCert.riskReason ?? 'Conflicting active eBay listing found for this cert.',
    });
  }

  if (dossier.priceComp && dossier.priceComp.riskLevel === 'HIGH' && dossier.priceComp.riskReason) {
    warnings.push({
      severity: 'HIGH',
      title:
        dossier.priceComp.discountPercent !== null && dossier.priceComp.discountPercent > 0
          ? `Price is ${dossier.priceComp.discountPercent}% below eBay median`
          : 'Unusual pricing vs eBay comps',
      detail: dossier.priceComp.riskReason,
    });
  }

  for (const flag of dossier.paymentForensics?.flags ?? []) {
    if (flag.severity === 'HIGH') {
      warnings.push({ severity: 'HIGH', title: flag.label, detail: flag.detail });
    }
  }

  for (const flag of dossier.dmAnalysis?.flags ?? []) {
    if (flag.severity === 'HIGH') {
      warnings.push({ severity: 'HIGH', title: flag.label, detail: flag.detail });
    }
  }

  const externalMentions = filterOpenWebMentions(dossier.webMentions);

  for (const m of externalMentions) {
    if (m.riskFlag === 'WARNING') {
      warnings.push({
        severity: 'HIGH',
        title: m.title,
        detail: m.snippet || `Flagged mention on ${m.sourceLabel}.`,
      });
    }
  }

  const totalPosRefs = dossier.matchedMembers.reduce((sum, m) => sum + m.positiveRefs, 0);
  const ebayFeedback = dossier.ebay?.found ? (dossier.ebay.feedbackScore ?? 0) : 0;
  const ebayActiveCount = dossier.ebay?.found ? dossier.ebay.activeListingsCount : 0;
  const hasRealEbayActivity = ebayFeedback > 0 || ebayActiveCount > 0;
  const igFollowers = dossier.forensics?.visibleProfile?.followersCount ?? 0;
  const igPosts = dossier.forensics?.visibleProfile?.postsCount ?? 0;
  const externalWebCount = externalMentions.length;

  const hasEstablishedHistory = Boolean(
    ebayFeedback >= 10 ||
      dossier.matchedMembers.some((m) => m.identityVerified || m.positiveRefs >= 2) ||
      (igFollowers >= 1000 && igPosts >= 20) ||
      (igFollowers >= 500 && (externalWebCount >= 1 || dossier.sherlock.length >= 1)),
  );

  // Only surface profile-forensics flags when there is NO established history to refute them.
  const topLookalike = dossier.lookalikes?.[0] ?? null;
  if (!hasEstablishedHistory && dossier.forensics) {
    if (dossier.forensics.riskLevel === 'HIGH') {
      for (const flag of dossier.forensics.flags) {
        if (flag.severity === 'HIGH') {
          warnings.push({ severity: 'HIGH', title: flag.label, detail: flag.detail });
        }
      }
    }
    if (dossier.forensics.riskLevel === 'HIGH' || dossier.forensics.riskLevel === 'ELEVATED') {
      for (const flag of dossier.forensics.flags) {
        if (flag.severity !== 'CAUTION') continue;
        if (flag.code === 'LOOKALIKE_OF_ESTABLISHED' && topLookalike) {
          warnings.push({
            severity: 'CAUTION',
            title: `Handle resembles @${topLookalike.handle} (${topLookalike.positiveRefs} positive ${topLookalike.positiveRefs === 1 ? 'ref' : 'refs'})`,
            detail: flag.detail,
          });
        } else {
          warnings.push({ severity: 'CAUTION', title: flag.label, detail: flag.detail });
        }
      }
    }
  }

  const highlights: string[] = [];
  if (totalPosRefs > 0) {
    highlights.push(
      `${totalPosRefs.toLocaleString('en-US')} positive ${totalPosRefs === 1 ? 'reference' : 'references'}`,
    );
  }
  if (dossier.ebay?.found && ebayFeedback > 0) {
    highlights.push(
      `${ebayFeedback.toLocaleString('en-US')} eBay feedback${dossier.ebay.feedbackPercentage ? ` · ${dossier.ebay.feedbackPercentage}%` : ''}`,
    );
  }
  if (dossier.ebay?.memberSince && (hasRealEbayActivity || highlights.length < 2)) {
    highlights.push(`eBay since ${dossier.ebay.memberSince.replace(/\s+in\s+/i, ' · ')}`);
  }
  const followers = dossier.forensics?.visibleProfile?.followersCount;
  if (typeof followers === 'number' && followers > 0) {
    highlights.push(`${followers.toLocaleString('en-US')} IG followers`);
  }
  if (dossier.ebay?.recentSales && dossier.ebay.recentSales.length > 0 && highlights.length < 3) {
    highlights.push(`${dossier.ebay.recentSales.length} verified eBay sales`);
  }

  const hasHighWarning = warnings.some((w) => w.severity === 'HIGH');
  const isVerified = dossier.matchedMembers.some((m) => m.identityVerified);
  const tier: RealnessTier = hasHighWarning
    ? 'WARNING_FLAGGED'
    : isVerified
      ? 'ID_VERIFIED'
      : hasEstablishedHistory
        ? 'ESTABLISHED_FOOTPRINT'
        : 'LIMITED_FOOTPRINT';

  let summary: string;
  if (hasHighWarning) {
    summary = warnings[0]!.detail || warnings[0]!.title;
  } else if (isVerified) {
    summary = 'ID-verified NoDitto trader with clean public signals across checked platforms.';
  } else if (hasEstablishedHistory) {
    const parts: string[] = [];
    if (totalPosRefs > 0) {
      parts.push(
        `${totalPosRefs.toLocaleString('en-US')} positive ${totalPosRefs === 1 ? 'reference' : 'references'}`,
      );
    }
    if (dossier.ebay?.found && hasRealEbayActivity) {
      parts.push(
        `active eBay seller (${ebayFeedback.toLocaleString('en-US')} feedback${dossier.ebay.feedbackPercentage ? `, ${dossier.ebay.feedbackPercentage}% positive` : ''})`,
      );
    } else if (dossier.ebay?.found && dossier.ebay.memberSince) {
      parts.push(`eBay account since ${dossier.ebay.memberSince}`);
    }
    if (typeof followers === 'number' && followers > 0) {
      parts.push(`Instagram profile (${followers.toLocaleString('en-US')} followers)`);
    }
    if (externalWebCount > 0) {
      parts.push(
        `${externalWebCount} public web ${externalWebCount === 1 ? 'mention' : 'mentions'}`,
      );
    }
    summary =
      parts.length > 0
        ? `Established public footprint with ${parts.join(', ')}, and no scam reports.`
        : 'Established cross-platform footprint with no scam reports found.';
  } else if (warnings.length > 0) {
    summary = topLookalike
      ? `No verified history found, and @${topLookalike.handle} (${topLookalike.positiveRefs} positive ${topLookalike.positiveRefs === 1 ? 'ref' : 'refs'}) has a similar handle — verify before paying.`
      : `Limited public history with ${warnings.length} caution ${warnings.length === 1 ? 'signal' : 'signals'} — verify before paying.`;
  } else {
    summary =
      'Limited public trading history found across eBay and the open web. Public signals are not a NoDitto reference.';
  }

  return {
    source: 'fallback',
    model: null,
    tier,
    summary,
    warnings: warnings.slice(0, 4),
    highlights: highlights.slice(0, 3),
  };
}

/** Runs the cheap LLM judge if a key is configured, otherwise returns the clean fallback. */
export async function judgeFootprint(
  dossier: Pick<
    BackgroundCheckDossier,
    | 'queryLabel'
    | 'assessment'
    | 'scamRisk'
    | 'forensics'
    | 'paymentForensics'
    | 'psaCert'
    | 'priceComp'
    | 'dmAnalysis'
    | 'matchedMembers'
    | 'ebay'
    | 'sherlock'
    | 'webMentions'
  > & { lookalikes?: BackgroundCheckDossier['lookalikes'] },
): Promise<FootprintJudgeVerdict> {
  const fallback = buildDeterministicJudgeVerdict(dossier);
  const provider = resolveJudgeProvider();
  if (!provider) return fallback;

  const compactInput = {
    subject: dossier.queryLabel,
    scamRisk: dossier.scamRisk,
    matchedNoDittoMembers: dossier.matchedMembers.map((m) => ({
      identityVerified: m.identityVerified,
      positiveRefs: m.positiveRefs,
      negativeRefs: m.negativeRefs,
    })),
    ebay: dossier.ebay
      ? {
          found: dossier.ebay.found,
          username: dossier.ebay.username,
          feedbackScore: dossier.ebay.feedbackScore,
          feedbackPercentage: dossier.ebay.feedbackPercentage,
          positive12m: dossier.ebay.positive12m,
          negative12m: dossier.ebay.negative12m,
          memberSince: dossier.ebay.memberSince,
          activeListingsCount: dossier.ebay.activeListingsCount,
          verifiedSalesCount: dossier.ebay.recentSales?.length ?? 0,
          topSales: (dossier.ebay.recentSales ?? []).slice(0, 3).map((s) => ({
            title: s.title,
            priceText: s.priceText,
            when: s.when,
          })),
        }
      : null,
    instagram: dossier.forensics?.visibleProfile
      ? {
          displayName: dossier.forensics.visibleProfile.displayName,
          followers: dossier.forensics.visibleProfile.followersCount,
          following: dossier.forensics.visibleProfile.followingCount,
          posts: dossier.forensics.visibleProfile.postsCount,
          bio: dossier.forensics.visibleProfile.bio,
          isPrivate: dossier.forensics.visibleProfile.isPrivate,
        }
      : null,
    // What search engines hold about a Facebook profile (Facebook itself is never read).
    facebookSearchIndex: dossier.forensics?.facebookIndex
      ? {
          indexed: dossier.forensics.facebookIndex.indexed,
          displayName: dossier.forensics.facebookIndex.displayName,
          nameGuessedFromLink: dossier.forensics.facebookIndex.nameSource === 'SLUG',
          livesIn: dossier.forensics.facebookIndex.livesIn,
          worksAt: dossier.forensics.facebookIndex.worksAt,
          friends: dossier.forensics.facebookIndex.friendsCount,
          followers: dossier.forensics.facebookIndex.followersCount,
          otherAccountsWithSameName: dossier.forensics.facebookIndex.sameNameAccounts.length,
        }
      : null,
    psaCert: dossier.psaCert
      ? {
          certNumber: dossier.psaCert.certNumber,
          riskLevel: dossier.psaCert.riskLevel,
          riskReason: dossier.psaCert.riskReason,
        }
      : null,
    priceComp: dossier.priceComp
      ? {
          askingPrice: dossier.priceComp.askingPrice,
          medianPrice: dossier.priceComp.medianPrice,
          discountPercent: dossier.priceComp.discountPercent,
          riskLevel: dossier.priceComp.riskLevel,
        }
      : null,
    paymentForensics: dossier.paymentForensics
      ? {
          riskLevel: dossier.paymentForensics.riskLevel,
          flags: dossier.paymentForensics.flags.map((f) => ({ severity: f.severity, label: f.label })),
        }
      : null,
    dmAnalysis: dossier.dmAnalysis
      ? {
          riskLevel: dossier.dmAnalysis.riskLevel,
          flags: dossier.dmAnalysis.flags.map((f) => ({ severity: f.severity, label: f.label })),
        }
      : null,
    webMentions: dossier.webMentions.slice(0, 6).map((m) => ({
      source: m.sourceLabel,
      title: m.title.slice(0, 120),
      riskFlag: m.riskFlag,
    })),
    forensics: dossier.forensics
      ? {
          riskLevel: dossier.forensics.riskLevel,
          riskScore: dossier.forensics.riskScore,
          flags: dossier.forensics.flags
            .filter((f) => f.severity !== 'INFO')
            .map((f) => ({ severity: f.severity, label: f.label, detail: f.detail })),
        }
      : null,
    lookalikes: (dossier.lookalikes ?? []).slice(0, 3).map((l) => ({
      handle: l.handle,
      platform: l.platform,
      positiveRefs: l.positiveRefs,
    })),
    sherlockSitesCount: dossier.sherlock.length,
  };

  const raw = await callCheapJudge(provider, JSON.stringify(compactInput));
  const parsed = parseJudgeJson(raw, provider.model);
  if (!parsed) return fallback;

  // Hard safety guard: never let the LLM accidentally drop a verified scam DB match.
  if (dossier.scamRisk.matchedReportCount > 0 && parsed.tier !== 'WARNING_FLAGGED') {
    return {
      ...parsed,
      tier: 'WARNING_FLAGGED',
      warnings: [
        ...fallback.warnings.filter((w) => w.severity === 'HIGH'),
        ...parsed.warnings,
      ].slice(0, 4),
    };
  }

  return parsed;
}
