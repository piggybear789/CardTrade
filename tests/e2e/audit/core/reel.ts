// tests/e2e/audit/core/reel.ts
//
// HIGHLIGHT REEL PLAN for the e2e UX audit suite. Pure: no I/O, no `node:fs`, no
// `ffprobe`, no `ffmpeg`. `scripts/e2e/highlight-reel.ts` reads the newest results,
// asks `ffprobe` for each video's duration, hands both to `planReel`, and cuts exactly
// the segments it returns. Everything that decides WHICH video and HOW MUCH of it is
// here, so the rule can be checked with fast-check instead of by watching a reel.
//
// Requirements:
//   36.1  the reel is at most 90 seconds and is cut only from passing Pathway_Videos
//         named in the checked-in selection list, in that list's order
//   36.2  only videos whose masker check was clean (zero uncovered matches) are used
//   36.3  every segment carries its Pathway's title, which the script burns in with
//         `drawtext`
//   36.5  the selection list itself (`tests/e2e/audit/highlights.ts`) opens with the
//         cash-sale and trade lifecycles; this module keeps whatever order it is given,
//         so the lifecycles lead the reel because they lead the list
//
// Durations are accounted in whole MILLISECONDS. Summing seconds as floats can land a
// hair over the budget (0.1 + 0.2 > 0.3), and "at most 90 s" is an exact promise, so
// every segment's `durationS` is an integer number of milliseconds divided by 1000 and
// `reelDurationMs` is the exact total.

import { isMemberLabel, isPathwayId, isViewport, type Viewport } from './artifactPaths';

/** The longest reel the suite will plan, in seconds (Req 36.1). */
export const REEL_MAX_S = 90;

/**
 * The most one segment takes by default, in seconds. Lifecycle videos run for minutes;
 * without a cap the first one would fill the whole reel and the trade lifecycle, which
 * the selection list puts second on purpose, would never appear.
 */
export const DEFAULT_SEGMENT_MAX_S = 30;

/**
 * The shortest segment worth cutting, in seconds. A segment squeezed into the last
 * second of the budget shows a title card and nothing else, so it is dropped instead.
 */
export const MIN_SEGMENT_S = 3;

/** One line of the checked-in selection list (`tests/e2e/audit/highlights.ts`). */
export interface ReelSelectionEntry {
  /** The Pathway whose video to use, e.g. `journeys.cash-sale-lifecycle`. */
  pathwayId: string;
  /** The member context whose video to use, e.g. `buyer`. */
  member: string;
  /** The viewport profile whose run to use. */
  viewport: Viewport;
  /** Where in the video to start, in seconds. Defaults to 0. */
  startS?: number;
  /** The most this entry may take, in seconds. Defaults to `DEFAULT_SEGMENT_MAX_S`. */
  maxS?: number;
}

/**
 * One recorded video, as the script reads it from the newest run's manifest plus
 * `ffprobe`. `status` is the Pathway's status for that viewport; `masked` is true only
 * when the masker recorded zero uncovered matches for this video.
 */
export interface ReelVideoResult {
  pathwayId: string;
  viewport: Viewport;
  member: string;
  /** The Pathway's title, from its declaration. */
  title: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped';
  masked: boolean;
  /** The video file, as the manifest names it. */
  video: string;
  /** The video's length in seconds, from `ffprobe`. */
  durationS: number;
}

/** One cut of the reel, in reel order (design, `ReelSegment`). */
export interface ReelSegment {
  pathwayId: string;
  title: string;
  video: string;
  startS: number;
  durationS: number;
}

/** Why a selection entry produced no segment. */
export type ReelSkipReason =
  | 'invalid-entry'
  | 'no-video'
  | 'not-passed'
  | 'not-masked'
  | 'no-duration'
  | 'too-short'
  | 'duplicate'
  | 'budget-spent';

/** A selection entry left out of the reel, so the script can print why. */
export interface ReelSkip {
  pathwayId: string;
  member: string;
  viewport: string;
  reason: ReelSkipReason;
}

/** The planned reel: the segments to cut, what was left out, and the exact total. */
export interface ReelPlan {
  segments: ReelSegment[];
  skipped: ReelSkip[];
  /** The sum of every segment's duration, in seconds (equals `reelDurationMs / 1000`). */
  totalS: number;
}

/** Options for `planReel`; every value is in seconds. */
export interface ReelOptions {
  /** The reel budget. Clamped to `REEL_MAX_S`, so no caller can plan a longer reel. */
  maxTotalS?: number;
  /** The default per-segment cap for entries without `maxS`. */
  segmentMaxS?: number;
  /** The shortest segment worth cutting. */
  minSegmentS?: number;
}

/** Seconds to whole milliseconds, rounding down so a cap is never exceeded. */
function toMs(seconds: number): number {
  return Math.floor(seconds * 1000);
}

/** True when `value` is a finite number of seconds at or above zero. */
function isNonNegativeSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function entryIsValid(entry: ReelSelectionEntry): boolean {
  return isPathwayId(entry.pathwayId)
    && isMemberLabel(entry.member)
    && isViewport(entry.viewport)
    && (entry.startS === undefined || isNonNegativeSeconds(entry.startS))
    && (entry.maxS === undefined || (isNonNegativeSeconds(entry.maxS) && entry.maxS > 0));
}

/**
 * The exact total length of `segments`, in milliseconds. Each `durationS` that
 * `planReel` writes is a whole number of milliseconds, so this is exact for its output.
 */
export function reelDurationMs(segments: readonly ReelSegment[]): number {
  return segments.reduce((total, segment) => total + Math.round(segment.durationS * 1000), 0);
}

/**
 * Plans the highlight reel (Req 36.1, 36.2, 36.3).
 *
 * Walks `selection` in order. For each entry it takes the FIRST result for the same
 * Pathway, viewport and member, so the caller passes the newest run's results only; a
 * failing newest run is skipped rather than replaced by an older passing one, because
 * an older video may show behaviour the product no longer has.
 *
 * An entry becomes a segment only when that result passed (`flaky` does not count: it
 * failed at least once), its masker check was clean, and it has a positive duration
 * beyond `startS`. The segment takes the smallest of what is left of the video, the
 * entry's cap and what is left of the budget, and is dropped if that is under
 * `minSegmentS`. A video already used by an earlier entry is not cut twice.
 *
 * Guarantees: segments keep the selection order, each carries its result's title, and
 * their durations sum to at most `REEL_MAX_S` seconds, exactly, in whole milliseconds.
 */
export function planReel(
  selection: readonly ReelSelectionEntry[],
  results: readonly ReelVideoResult[],
  options: ReelOptions = {},
): ReelPlan {
  const budgetS = isNonNegativeSeconds(options.maxTotalS) ? Math.min(options.maxTotalS, REEL_MAX_S) : REEL_MAX_S;
  const segmentMaxS = isNonNegativeSeconds(options.segmentMaxS) && options.segmentMaxS > 0
    ? options.segmentMaxS
    : DEFAULT_SEGMENT_MAX_S;
  const minSegmentMs = Math.max(1, toMs(isNonNegativeSeconds(options.minSegmentS) ? options.minSegmentS : MIN_SEGMENT_S));

  let remainingMs = toMs(budgetS);
  const segments: ReelSegment[] = [];
  const skipped: ReelSkip[] = [];
  const usedVideos = new Set<string>();

  for (const entry of selection) {
    const skip = (reason: ReelSkipReason): void => {
      skipped.push({ pathwayId: entry.pathwayId, member: entry.member, viewport: entry.viewport, reason });
    };

    if (!entryIsValid(entry)) { skip('invalid-entry'); continue; }

    const result = results.find((candidate) =>
      candidate.pathwayId === entry.pathwayId
      && candidate.viewport === entry.viewport
      && candidate.member === entry.member);

    if (result === undefined) { skip('no-video'); continue; }
    if (result.status !== 'passed') { skip('not-passed'); continue; }
    if (result.masked !== true) { skip('not-masked'); continue; }
    if (usedVideos.has(result.video)) { skip('duplicate'); continue; }

    const startMs = toMs(entry.startS ?? 0);
    const videoMs = isNonNegativeSeconds(result.durationS) ? toMs(result.durationS) : 0;
    const availableMs = videoMs - startMs;
    if (availableMs <= 0) { skip('no-duration'); continue; }

    const takeMs = Math.min(availableMs, toMs(entry.maxS ?? segmentMaxS), remainingMs);
    if (takeMs < minSegmentMs) {
      // Under the minimum because the VIDEO is short, or because the budget ran out.
      skip(takeMs === remainingMs && remainingMs < availableMs ? 'budget-spent' : 'too-short');
      continue;
    }

    usedVideos.add(result.video);
    remainingMs -= takeMs;
    segments.push({
      pathwayId: result.pathwayId,
      title: result.title,
      video: result.video,
      startS: startMs / 1000,
      durationS: takeMs / 1000,
    });
  }

  return { segments, skipped, totalS: reelDurationMs(segments) / 1000 };
}
