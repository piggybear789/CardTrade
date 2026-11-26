// scripts/e2e/story-videos.ts
//
// Turns the newest audit run's raw Playwright videos into videos a person can follow.
//
// The raw recordings are one WebM per member browser per Pathway: two silent windows
// running side by side in real time, with every wait, sign-in and job call left in.
// This script cuts them into a story instead, using what the run manifest already
// records about every step (name, kind, acting member, start time, duration):
//
//   - a title card per Pathway (title, area, viewport, payments mode)
//   - for each step, the ACTING member's video over that step's window, captioned
//     "Step 3 of 18 · Seller · Alice opens the new sale"
//   - long steps are sped up to fit a cap, short ones held long enough to read
//   - steps with no browser (a simulated clock move, a job run) become a short card,
//     so time that was skipped is said to be skipped
//
// Output, under audit-report/videos/:
//   <viewport>/<pathway-id>.mp4   one story per passing Pathway with a clean masker check
//   noditto-e2e-<viewport>.mp4    every story in that viewport, grouped by area
//
// Needs ffmpeg and ffprobe on PATH. Only videos the masker marked clean are used, the
// same rule as the highlight reel (Req 36.2), so no unmasked secret or email is cut in.
//
// Usage: npx tsx scripts/e2e/story-videos.ts [--run <run-id>] [--viewport desktop|phone] [--only <id-substring>]
// Record first with E2E_VIDEO=1, or only failing and journey Pathways keep a video.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PathwayRecord, RunManifest, StepRecord } from '../../tests/e2e/audit/core/aggregate';
import { ARTIFACT_ROOT, RUNS_DIR } from '../../tests/e2e/audit/core/artifactPaths';

const ROOT = process.cwd();
const OUT_ROOT = path.join('audit-report', 'videos');
const TMP = path.join('audit-report', 'videos', '.tmp');

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const BG = '0x0f172a';
const FONT = "C\\:/Windows/Fonts/segoeui.ttf";
const FONT_BOLD = "C\\:/Windows/Fonts/segoeuib.ttf";

/** A step is shown for at least this long, so its caption can be read. */
const MIN_STEP_S = 2.2;
/** A step longer than this is sped up to fit it. */
const MAX_STEP_S = 7;
/** Seconds of video kept before a step starts, so the cut lands just before the action. */
const LEAD_S = 0.4;
/** How long a title card and a skipped-time card stay up. */
const TITLE_S = 3;
const CARD_S = 2.2;

const ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an'];

function args(): { viewports: string[]; only?: string } {
  const argv = process.argv.slice(2);
  const viewport = argv[argv.indexOf('--viewport') + 1];
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
  return { viewports: argv.includes('--viewport') ? [viewport] : ['desktop', 'phone'], only };
}

function hasBinary(cmd: string): boolean {
  return spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
}

function ffmpeg(argv: string[]): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...argv], { stdio: 'inherit' });
}

function durationSec(file: string): number {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { encoding: 'utf8' },
  );
  const parsed = Number.parseFloat(out.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestManifest(): RunManifest {
  const runsRoot = path.join(ROOT, ARTIFACT_ROOT, RUNS_DIR);
  const argv = process.argv.slice(2);
  if (argv.includes('--run')) {
    const chosen = path.join(runsRoot, argv[argv.indexOf('--run') + 1], 'manifest.json');
    if (!existsSync(chosen)) throw new Error(`No manifest at ${chosen}`);
    return JSON.parse(readFileSync(chosen, 'utf8')) as RunManifest;
  }
  const manifests = readdirSync(runsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(runsRoot, d.name, 'manifest.json'))
    .filter((p) => existsSync(p))
    // Run ids start with their UTC start time, so name order is run order. File times
    // are not: a later report pass can rewrite an older run's manifest.
    .sort((a, b) => path.basename(path.dirname(b)).localeCompare(path.basename(path.dirname(a))));
  if (manifests.length === 0) throw new Error('No audit run manifest found. Run the suite first.');
  return JSON.parse(readFileSync(manifests[0], 'utf8')) as RunManifest;
}

/** "seller" -> "Seller", "trade-abandon" -> "Trade abandon". */
function label(member: string): string {
  const words = member.replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

let textFileCounter = 0;
/**
 * drawtext reads its text from a FILE, so step names never need filter escaping. The
 * path is relative to the working directory, so it carries no drive-letter colon.
 */
function textFile(text: string): string {
  textFileCounter += 1;
  const file = path.join(TMP, `t${textFileCounter}.txt`).replace(/\\/g, '/');
  writeFileSync(file, text, 'utf8');
  return file;
}

function drawText(text: string, opts: { size: number; y: string; bold?: boolean; color?: string }): string {
  return (
    `drawtext=fontfile='${opts.bold ? FONT_BOLD : FONT}':textfile='${textFile(text)}':` +
    `fontsize=${opts.size}:fontcolor=${opts.color ?? 'white'}:x=(w-text_w)/2:y=${opts.y}:line_spacing=10`
  );
}

/** Wrap a long line to roughly `max` characters, for cards. */
function wrap(text: string, max: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

let segmentCounter = 0;
function nextSegment(): string {
  segmentCounter += 1;
  return path.join(TMP, `s${segmentCounter}.mp4`);
}

/** A plain card: a coloured background with centred lines of text. */
function card(out: string, seconds: number, lines: Array<{ text: string; size: number; y: string; bold?: boolean; color?: string }>): void {
  const filters = lines.map((line) => drawText(line.text, line)).join(',');
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${BG}:s=${WIDTH}x${HEIGHT}:d=${seconds}:r=${FPS}`,
    '-vf', `${filters},fade=t=in:st=0:d=0.25,fade=t=out:st=${(seconds - 0.25).toFixed(2)}:d=0.25`,
    ...ENCODE, out,
  ]);
}

interface MemberVideo {
  file: string;
  /** Wall-clock instant (ms) the recording's first frame corresponds to. */
  startMs: number;
  durationS: number;
}

/** Seconds between the last step ending and the browser context closing. */
const CLOSE_AFTER_LAST_STEP_S = 0.3;

/**
 * Where a recording starts on the wall clock. A recording ends when its context
 * closes, just after the Pathway's last step, so that end minus the duration is when
 * it began. The file's own timestamp is NOT used: Playwright finishes writing it a few
 * seconds after the close, which put every cut that much late.
 */
function memberVideo(file: string, record: PathwayRecord): MemberVideo | null {
  if (!existsSync(file)) return null;
  const durationS = durationSec(file);
  if (durationS <= 0) return null;
  const lastStepEnd = Math.max(...record.steps.map((s) => Date.parse(s.startedAt) + s.durationMs));
  const endMs = Number.isFinite(lastStepEnd) ? lastStepEnd + CLOSE_AFTER_LAST_STEP_S * 1000 : statSync(file).mtimeMs;
  return { file, startMs: endMs - durationS * 1000, durationS };
}

/** One captioned cut of the acting member's video over a step's window. */
function stepClip(out: string, video: MemberVideo, step: StepRecord, caption: string): boolean {
  const stepStart = (Date.parse(step.startedAt) - video.startMs) / 1000 - LEAD_S;
  const start = Math.max(0, Math.min(stepStart, video.durationS - 0.5));
  const realLength = Math.max(MIN_STEP_S, step.durationMs / 1000 + LEAD_S);
  const length = Math.min(realLength, video.durationS - start);
  if (length < 0.5) return false;
  const shown = Math.min(Math.max(length, MIN_STEP_S), MAX_STEP_S);
  const speed = length / shown;
  // Faster than real time when the step was long; never slower, a short step is held
  // on its last frame instead (tpad), so the motion stays natural.
  const timing = speed > 1 ? `setpts=PTS/${speed.toFixed(3)},` : '';
  const hold = shown > length ? `tpad=stop_mode=clone:stop_duration=${(shown - length).toFixed(2)},` : '';
  const speedNote = speed > 1.15 ? `   (${speed.toFixed(1)}x)` : '';
  const filter =
    `${timing}${hold}` +
    `scale=${WIDTH}:${HEIGHT - 90}:force_original_aspect_ratio=decrease,` +
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih-90)/2:color=${BG},fps=${FPS},` +
    `drawbox=x=0:y=ih-90:w=iw:h=90:color=0x020617@0.92:t=fill,` +
    drawText(caption + speedNote, { size: 30, y: 'h-62' });
  ffmpeg(['-ss', start.toFixed(3), '-t', length.toFixed(3), '-i', video.file, '-vf', filter, '-t', shown.toFixed(3), ...ENCODE, out]);
  return true;
}

function concat(parts: string[], out: string): void {
  const list = path.join(TMP, `concat-${path.basename(out)}.txt`);
  writeFileSync(list, parts.map((p) => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
}

/** Build one Pathway's story video. Returns its path, or null when nothing usable was recorded. */
function buildStory(record: PathwayRecord, out: string): string | null {
  const videos = new Map<string, MemberVideo>();
  for (const v of record.videos) {
    if (!v.masked) continue;
    const mv = memberVideo(path.resolve(ROOT, v.path), record);
    if (mv) videos.set(v.member, mv);
  }
  if (videos.size === 0) return null;

  const parts: string[] = [];
  const title = nextSegment();
  card(title, TITLE_S, [
    { text: record.declaration.area.toUpperCase(), size: 26, y: '(h/2)-120', color: '0x94a3b8' },
    { text: wrap(record.declaration.title, 46), size: 46, y: '(h/2)-60', bold: true },
    {
      text: `${record.viewport === 'phone' ? 'Phone (iPhone 14, WebKit)' : 'Desktop (Chrome)'}  ·  ` +
        `${record.paymentsMode === 'mock' ? 'Mock payments' : 'Stripe test mode'}`,
      size: 26, y: '(h/2)+110', color: '0x94a3b8',
    },
  ]);
  parts.push(title);

  const total = record.steps.length;
  for (const step of record.steps) {
    const position = `Step ${step.index} of ${total}`;
    const member = step.members.find((m) => videos.has(m));
    if (!member || step.kind === 'simulated' || step.kind === 'arrange') {
      const skipped = nextSegment();
      card(skipped, CARD_S, [
        { text: position, size: 24, y: '(h/2)-90', color: '0x94a3b8' },
        { text: wrap(step.name, 50), size: 38, y: '(h/2)-40', bold: true },
        {
          text: step.kind === 'simulated' ? 'Simulated: time or an outside event is fast-forwarded' : 'Behind the scenes, no screen to show',
          size: 24, y: '(h/2)+100', color: '0x94a3b8',
        },
      ]);
      parts.push(skipped);
      continue;
    }
    const clip = nextSegment();
    const prefix = step.kind === 'assert' ? 'Check' : position;
    if (stepClip(clip, videos.get(member)!, step, `${prefix}  ·  ${label(member)}  ·  ${step.name}`)) parts.push(clip);
  }

  concat(parts, out);
  return out;
}

function main(): void {
  if (!hasBinary('ffmpeg') || !hasBinary('ffprobe')) {
    console.log('[story-videos] ffmpeg/ffprobe not found on PATH (scoop install ffmpeg).');
    return;
  }
  const { viewports, only } = args();
  const manifest = newestManifest();
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  for (const viewport of viewports) {
    const records = manifest.results
      .filter((r) => r.viewport === viewport && r.status === 'passed' && r.videos.length > 0)
      .filter((r) => !only || r.declaration.id.includes(only))
      .sort((a, b) => a.declaration.area.localeCompare(b.declaration.area) || a.declaration.id.localeCompare(b.declaration.id));
    console.log(`[story-videos] run ${manifest.runId}, ${viewport}: ${records.length} passing Pathway(s) with video`);
    const dir = path.join(OUT_ROOT, viewport);
    mkdirSync(dir, { recursive: true });

    const stories: string[] = [];
    let area = '';
    for (const record of records) {
      try {
        if (record.declaration.area !== area) {
          area = record.declaration.area;
          const divider = nextSegment();
          card(divider, 2, [{ text: area.replace(/-/g, ' ').toUpperCase(), size: 64, y: '(h-text_h)/2', bold: true }]);
          stories.push(divider);
        }
        const out = buildStory(record, path.join(dir, `${record.declaration.id}.mp4`));
        if (out) {
          stories.push(out);
          console.log(`[story-videos] ${viewport}  ${record.declaration.id}`);
        }
      } catch (error) {
        console.log(`[story-videos] skipped ${viewport} ${record.declaration.id}: ${(error as Error).message}`);
      }
    }
    if (stories.length > 0 && !only) {
      const film = path.join(OUT_ROOT, `noditto-e2e-${viewport}.mp4`);
      concat(stories, film);
      console.log(`[story-videos] Wrote ${film}`);
    }
  }
  rmSync(TMP, { recursive: true, force: true });
}

main();
