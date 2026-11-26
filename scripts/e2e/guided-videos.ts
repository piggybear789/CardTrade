// scripts/e2e/guided-videos.ts
//
// Guided demo videos from an e2e run's recordings, for someone who has never seen
// NoDitto. One video per journey in `scripts/e2e/guided/journeys.ts`, plus one film of
// all of them. Built only from what the run already recorded: no tests are re-run.
//
// Each video, at 1920x1080:
//   - an opening card: what NoDitto is, what this journey shows, who is in it, and the
//     chapter list with start times
//   - a chapter card at each new chapter
//   - every step: the acting member's screen in a frame of THEIR colour, a name tag, and
//     a two-line caption (what happens, why it matters)
//   - a click ring where the screen first changed after an action (worked out from the
//     recording, since the browser videos have no cursor)
//   - even pacing: real speed; a short step is held so its caption can be read; a long
//     one shows its start and end with "⏩ N seconds later" between, never sped up
//   - steps with no screen (a scheduled job, a carrier update) as a "behind the scenes"
//     card
// Chapters are written as a YouTube-style list (<id>.chapters.txt) and as MP4 chapter
// metadata.
//
// Usage: npx tsx scripts/e2e/guided-videos.ts [--run <run-id>] [--only <journey-id-part>]

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PathwayRecord, RunManifest, StepRecord } from '../../tests/e2e/audit/core/aggregate';
import { ARTIFACT_ROOT, RUNS_DIR } from '../../tests/e2e/audit/core/artifactPaths';
import { JOURNEYS, type CastMember, type Caption, type Journey } from './guided/journeys';

const ROOT = process.cwd();
const OUT = path.join('docs', 'e2e-videos', 'guided');
const TMP = path.join('docs', 'e2e-videos', 'guided', '.tmp');

const W = 1920;
const H = 1080;
const FPS = 30;
const BG = '0x0b1220';
const PANEL = '0x111a2e';
const MUTED = '0x94a3b8';
const FONT = 'C\\:/Windows/Fonts/segoeui.ttf';
const BOLD = 'C\\:/Windows/Fonts/segoeuib.ttf';

/** The screen area, under the chapter bar and above the caption bar. */
const TOP_BAR = 96;
const CAPTION_H = 190;
const SCREEN_BOX = { x: 60, y: TOP_BAR + 14, w: W - 120, h: H - TOP_BAR - CAPTION_H - 28 };
const BORDER = 6;

/** Pacing (seconds). */
const MIN_STEP = 3.2;
const MAX_STEP = 7.5;
const KEEP_HEAD = 3.4;
const KEEP_TAIL = 3.0;
const LEAD = 0.35;
const CARD_STEP = 3.4;
const CHAPTER_CARD = 2.2;

const ENCODE = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an'];

function args(): { run?: string; only?: string } {
  const a = process.argv.slice(2);
  const get = (flag: string) => (a.includes(flag) ? a[a.indexOf(flag) + 1] : undefined);
  return { run: get('--run'), only: get('--only') };
}

function ffmpeg(argv: string[]): void {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...argv], { stdio: 'inherit' });
}

function durationOf(file: string): number {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  });
  const n = Number.parseFloat(out.trim());
  return Number.isFinite(n) ? n : 0;
}

function manifestFor(runId?: string): RunManifest {
  const runsRoot = path.join(ROOT, ARTIFACT_ROOT, RUNS_DIR);
  const ids = readdirSync(runsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(runsRoot, d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort()
    .reverse();
  const id = runId ?? ids[0];
  if (!id) throw new Error('No run manifest found.');
  return JSON.parse(readFileSync(path.join(runsRoot, id, 'manifest.json'), 'utf8')) as RunManifest;
}

// --- text and cards ---------------------------------------------------------------------

let n = 0;
function textFile(text: string): string {
  n += 1;
  const file = path.join(TMP, `t${n}.txt`).replace(/\\/g, '/');
  writeFileSync(file, text, 'utf8');
  return file;
}
function seg(): string {
  n += 1;
  return path.join(TMP, `s${n}.mp4`);
}

interface Line {
  text: string;
  size: number;
  x?: string;
  y: string;
  bold?: boolean;
  colour?: string;
}
function draw(line: Line): string {
  return (
    `drawtext=fontfile='${line.bold ? BOLD : FONT}':textfile='${textFile(line.text)}':fontsize=${line.size}:` +
    `fontcolor=${line.colour ?? 'white'}:x=${line.x ?? '(w-text_w)/2'}:y=${line.y}:line_spacing=12`
  );
}

function wrap(text: string, max: number): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/** A full-frame card with the given lines, faded in and out. */
function card(seconds: number, lines: Line[], extra: string[] = []): string {
  const out = seg();
  const filters = [...lines.map(draw), ...extra].join(',');
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${BG}:s=${W}x${H}:d=${seconds}:r=${FPS}`,
    '-vf', `${filters},fade=t=in:st=0:d=0.3,fade=t=out:st=${(seconds - 0.3).toFixed(2)}:d=0.3`,
    ...ENCODE, out,
  ]);
  return out;
}

/** The chapter bar and caption bar drawn over a step frame. */
function chrome(params: {
  chapter: string;
  position: string;
  journeyTitle: string;
  caption: Caption;
  who?: CastMember;
  note?: string;
}): string[] {
  const { caption, who } = params;
  const capY = H - CAPTION_H;
  const parts = [
    `drawbox=x=0:y=0:w=iw:h=${TOP_BAR}:color=${PANEL}:t=fill`,
    draw({ text: params.chapter, size: 36, x: '60', y: `${(TOP_BAR - 44) / 2}`, bold: true }),
    draw({ text: `${params.journeyTitle}   ·   ${params.position}`, size: 24, x: `w-text_w-60`, y: `${(TOP_BAR - 28) / 2}`, colour: MUTED }),
    `drawbox=x=0:y=${capY}:w=iw:h=${CAPTION_H}:color=${PANEL}:t=fill`,
  ];
  let textX = 60;
  if (who) {
    const tag = `${who.name}${who.role ? ` · ${who.role}` : ''}`;
    parts.push(
      `drawbox=x=60:y=${capY + 34}:w=${Math.max(140, tag.length * 15 + 40)}:h=48:color=${who.colour}@0.95:t=fill`,
      draw({ text: tag, size: 26, x: '80', y: `${capY + 43}`, bold: true, colour: '0x0b1220' }),
    );
    textX = 60 + Math.max(140, tag.length * 15 + 40) + 30;
  }
  parts.push(
    draw({ text: caption.what, size: 38, x: `${textX}`, y: `${capY + 36}`, bold: true }),
    ...(caption.why ? [draw({ text: wrap(caption.why, 110), size: 28, x: `${textX}`, y: `${capY + 96}`, colour: '0xcbd5e1' })] : []),
  );
  if (params.note) {
    parts.push(
      `drawbox=x=w-420:y=${TOP_BAR + 30}:w=360:h=58:color=0x0b1220@0.85:t=fill`,
      draw({ text: params.note, size: 28, x: 'w-400', y: `${TOP_BAR + 43}`, bold: true }),
    );
  }
  return parts;
}

// --- recordings ---------------------------------------------------------------------------

interface Recording {
  file: string;
  startMs: number;
  duration: number;
  width: number;
  height: number;
}

function probeSize(file: string): { width: number; height: number } {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  });
  const [w, h] = out.trim().split(',').map(Number);
  return { width: w || 1280, height: h || 720 };
}

const THUMB_W = 160;
const THUMB_H = 90;

/** A greyscale thumbnail of an image or a video frame, as raw bytes. */
function thumb(input: string[], frames = 1): Buffer | null {
  const res = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', ...input, ...(frames === 1 ? ['-frames:v', '1'] : []), '-vf', `scale=${THUMB_W}:${THUMB_H},format=gray`, '-f', 'rawvideo', '-'],
    { maxBuffer: 200_000_000 },
  );
  return res.status === 0 && res.stdout.length >= THUMB_W * THUMB_H ? res.stdout : null;
}

/**
 * ALIGN BY PICTURE, NOT BY CLOCK. A recording ends when its browser context closes,
 * which is after the test's own cleanup, so "last step end + a moment" put every cut a
 * few seconds late (a caption for Buy now over the delivery dialog). Each step's
 * screenshot was taken when the step ENDED, so the frame in the recording that looks
 * most like that screenshot fixes when the recording started. Searched over a window
 * around the clock estimate, four frames a second; the best of up to three steps wins.
 */
function alignStart(file: string, estimateMs: number, record: PathwayRecord, member: string, duration: number): number {
  const shots = record.steps
    .flatMap((s) => s.screenshots.filter((sh) => sh.member === member).map((sh) => ({ step: s, path: path.resolve(ROOT, sh.path) })))
    .filter((s) => existsSync(s.path))
    .slice(0, 3);
  let best: { error: number; startMs: number } | null = null;
  for (const shot of shots) {
    const target = thumb(['-i', shot.path]);
    if (!target) continue;
    const expected = (Date.parse(shot.step.startedAt) + shot.step.durationMs - estimateMs) / 1000;
    const from = Math.max(0, expected - 15);
    const to = Math.min(duration, expected + 3);
    if (to <= from) continue;
    const frames = thumb(['-ss', from.toFixed(2), '-t', (to - from).toFixed(2), '-i', file, '-r', '4'], 0);
    if (!frames) continue;
    const size = THUMB_W * THUMB_H;
    for (let i = 0; (i + 1) * size <= frames.length; i += 1) {
      let error = 0;
      for (let p = 0; p < size; p += 1) error += Math.abs(frames[i * size + p] - target[p]);
      error /= size;
      const t = from + i / 4;
      const startMs = Date.parse(shot.step.startedAt) + shot.step.durationMs - t * 1000;
      if (!best || error < best.error) best = { error, startMs };
    }
  }
  // Only trust a close match; a screenshot of a page the recording never showed (a full
  // page capture on a phone) leaves the clock estimate in place.
  return best && best.error < 12 ? best.startMs : estimateMs;
}

function recordingsFor(record: PathwayRecord): Map<string, Recording> {
  const lastEnd = Math.max(...record.steps.map((s) => Date.parse(s.startedAt) + s.durationMs));
  const out = new Map<string, Recording>();
  for (const v of record.videos) {
    if (!v.masked) continue;
    const file = path.resolve(ROOT, v.path);
    if (!existsSync(file)) continue;
    const duration = durationOf(file);
    if (duration <= 0) continue;
    const endMs = Number.isFinite(lastEnd) ? lastEnd + 300 : statSync(file).mtimeMs;
    const estimate = endMs - duration * 1000;
    const startMs = alignStart(file, estimate, record, v.member, duration);
    console.log(`[guided]   ${record.declaration.id} ${v.member}: aligned by ${((startMs - estimate) / 1000).toFixed(2)}s`);
    out.set(v.member, { file, startMs, duration, ...probeSize(file) });
  }
  return out;
}

/** Where the recording sits on the 1920x1080 frame (scaled to fit the screen box). */
function placement(rec: Recording): { w: number; h: number; x: number; y: number } {
  const scale = Math.min((SCREEN_BOX.w - 2 * BORDER) / rec.width, (SCREEN_BOX.h - 2 * BORDER) / rec.height);
  const w = Math.round((rec.width * scale) / 2) * 2;
  const h = Math.round((rec.height * scale) / 2) * 2;
  return { w, h, x: Math.round(SCREEN_BOX.x + (SCREEN_BOX.w - w) / 2), y: Math.round(SCREEN_BOX.y + (SCREEN_BOX.h - h) / 2) };
}

/**
 * Where the screen first changed after an action began, in recording pixels, or null
 * when nothing local changed (a whole-page navigation or no change at all). Compares two
 * small greyscale frames on a 32x18 grid and takes the centre of the changed cells.
 */
function clickPoint(rec: Recording, atSeconds: number): { x: number; y: number } | null {
  const sw = 320;
  const sh = 180;
  const grab = (t: number): Buffer | null => {
    const res = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-ss', Math.max(0, t).toFixed(3), '-i', rec.file, '-frames:v', '1', '-vf', `scale=${sw}:${sh},format=gray`, '-f', 'rawvideo', '-'],
      { maxBuffer: 10_000_000 },
    );
    return res.status === 0 && res.stdout.length >= sw * sh ? res.stdout : null;
  };
  const a = grab(atSeconds);
  const b = grab(atSeconds + 0.8);
  if (!a || !b) return null;
  const cols = 32;
  const rows = 18;
  const cw = sw / cols;
  const ch = sh / rows;
  let changed = 0;
  let sx = 0;
  let sy = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let diff = 0;
      for (let y = Math.floor(r * ch); y < Math.floor((r + 1) * ch); y += 1) {
        for (let x = Math.floor(c * cw); x < Math.floor((c + 1) * cw); x += 1) {
          diff += Math.abs(a[y * sw + x] - b[y * sw + x]);
        }
      }
      if (diff / (cw * ch) > 18) {
        changed += 1;
        sx += c + 0.5;
        sy += r + 0.5;
      }
    }
  }
  const fraction = changed / (cols * rows);
  if (changed === 0 || fraction > 0.3) return null;
  return { x: (sx / changed / cols) * rec.width, y: (sy / changed / rows) * rec.height };
}

/** One rendered piece of a step: a span of a recording, with chrome and optional ring. */
function stepClip(params: {
  rec: Recording;
  start: number;
  length: number;
  hold: number;
  colour: string;
  chromeParts: string[];
  ring?: { x: number; y: number; from: number } | null;
}): string {
  const out = seg();
  const { rec } = params;
  const p = placement(rec);
  const ring = params.ring
    ? (() => {
        const rx = Math.round(p.x + (params.ring.x / rec.width) * p.w);
        const ry = Math.round(p.y + (params.ring.y / rec.height) * p.h);
        const t0 = params.ring.from.toFixed(2);
        const t1 = (params.ring.from + 1.1).toFixed(2);
        // A ring: an outer box minus an inner one does not exist in ffmpeg, so two
        // drawboxes make a bold square outline in amber, with a soft fill.
        return [
          `drawbox=x=${rx - 34}:y=${ry - 34}:w=68:h=68:color=0xfbbf24@0.95:t=5:enable='between(t,${t0},${t1})'`,
          `drawbox=x=${rx - 22}:y=${ry - 22}:w=44:h=44:color=0xfbbf24@0.25:t=fill:enable='between(t,${t0},${t1})'`,
        ];
      })()
    : [];
  const total = params.length + params.hold;
  const filter = [
    `[1:v]trim=start=${params.start.toFixed(3)}:duration=${params.length.toFixed(3)},setpts=PTS-STARTPTS,` +
      (params.hold > 0 ? `tpad=stop_mode=clone:stop_duration=${params.hold.toFixed(2)},` : '') +
      `scale=${p.w}:${p.h},pad=${p.w + 2 * BORDER}:${p.h + 2 * BORDER}:${BORDER}:${BORDER}:color=${params.colour}[scr]`,
    `[0:v][scr]overlay=${p.x - BORDER}:${p.y - BORDER}:shortest=1,${[...params.chromeParts, ...ring].join(',')}[v]`,
  ].join(';');
  ffmpeg([
    '-f', 'lavfi', '-i', `color=c=${BG}:s=${W}x${H}:d=${total.toFixed(3)}:r=${FPS}`,
    '-i', rec.file,
    '-filter_complex', filter, '-map', '[v]', '-t', total.toFixed(3),
    ...ENCODE, out,
  ]);
  return out;
}

// --- one journey ---------------------------------------------------------------------------

interface Built {
  file: string;
  chapters: Array<{ title: string; at: number }>;
}

function buildJourney(journey: Journey, record: PathwayRecord): Built | null {
  const recs = recordingsFor(record);
  if (recs.size === 0) return null;
  const cast = new Map(journey.cast.map((c) => [c.label, c]));
  const parts: string[] = [];
  const chapters: Array<{ title: string; at: number }> = [];
  let clock = 0;
  const push = (file: string) => {
    parts.push(file);
    clock += durationOf(file);
  };

  const total = record.steps.length;
  let chapterTitle = '';
  let chapterNo = 0;
  for (const step of record.steps) {
    const chapterStart = journey.chapters[step.index];
    if (chapterStart) {
      chapterNo += 1;
      chapterTitle = `${chapterNo} · ${chapterStart}`;
      chapters.push({ title: chapterStart, at: clock });
      push(card(CHAPTER_CARD, [
        { text: `Chapter ${chapterNo}`, size: 30, y: '(h/2)-80', colour: MUTED },
        { text: chapterStart, size: 72, y: '(h/2)-30', bold: true },
      ]));
    }
    const caption = journey.captions[step.index] ?? { what: step.name, why: '' };
    if (!journey.captions[step.index]) console.log(`[guided] ${journey.id}: no caption for step ${step.index} (${step.name})`);
    const position = `Step ${step.index} of ${total}`;
    const memberLabel = step.members.find((m) => recs.has(m));
    const behindTheScenes = step.kind === 'arrange' || step.kind === 'simulated' || !memberLabel;

    if (behindTheScenes) {
      push(card(CARD_STEP, [
        { text: 'BEHIND THE SCENES', size: 26, y: '(h/2)-150', colour: MUTED, bold: true },
        { text: wrap(caption.what, 46), size: 54, y: '(h/2)-90', bold: true },
        { text: wrap(caption.why, 70), size: 32, y: '(h/2)+60', colour: '0xcbd5e1' },
      ], [
        `drawbox=x=0:y=0:w=iw:h=${TOP_BAR}:color=${PANEL}:t=fill`,
        draw({ text: chapterTitle || journey.title, size: 36, x: '60', y: `${(TOP_BAR - 44) / 2}`, bold: true }),
        draw({ text: `${journey.title}   ·   ${position}`, size: 24, x: 'w-text_w-60', y: `${(TOP_BAR - 28) / 2}`, colour: MUTED }),
      ]));
      continue;
    }

    const rec = recs.get(memberLabel!)!;
    const who = cast.get(memberLabel!) ?? { label: memberLabel!, name: memberLabel!, role: '', colour: '0x94a3b8' };
    const startAt = Math.max(0, (Date.parse(step.startedAt) - rec.startMs) / 1000 - LEAD);
    // Ends on the step's own last frame: running on into the next action put the next
    // step's dialog under this step's caption.
    const realLength = Math.min(step.durationMs / 1000 + LEAD + 0.1, rec.duration - startAt);
    if (realLength < 0.3) continue;
    const chromeArgs = { chapter: chapterTitle || journey.title, position, journeyTitle: journey.title, caption, who };
    const ring = step.kind === 'action' ? clickPoint(rec, startAt + LEAD) : null;

    if (realLength <= MAX_STEP) {
      push(stepClip({
        rec, start: startAt, length: realLength, hold: Math.max(0, MIN_STEP - realLength), colour: who.colour,
        chromeParts: chrome(chromeArgs), ring: ring ? { ...ring, from: LEAD } : null,
      }));
    } else {
      // EVEN PACING: the start and the end at real speed, the wait in between cut and
      // said, never sped up.
      const skipped = Math.round(realLength - KEEP_HEAD - KEEP_TAIL);
      push(stepClip({
        rec, start: startAt, length: KEEP_HEAD, hold: 0, colour: who.colour,
        chromeParts: chrome(chromeArgs), ring: ring ? { ...ring, from: LEAD } : null,
      }));
      push(stepClip({
        rec, start: startAt + realLength - KEEP_TAIL, length: KEEP_TAIL, hold: 0.4, colour: who.colour,
        chromeParts: chrome({ ...chromeArgs, note: `⏩  ${skipped} seconds later` }),
      }));
    }
  }

  // The opening card, made last so it can list the chapters with their start times. Its
  // own length is added to every chapter time.
  const castLines = journey.cast.map((c) => `${c.name}${c.role ? ` (${c.role})` : ''}`).join('     ');
  const introSeconds = 9;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const chapterList = chapters.map((c, i) => `${fmt(c.at + introSeconds)}   ${i + 1}. ${c.title}`).join('\n');
  const intro = card(introSeconds, [
    { text: journey.title, size: 66, y: '120', bold: true },
    { text: journey.intro.join('\n'), size: 34, y: '250', colour: '0xe2e8f0' },
    { text: `Starring  ${castLines}`, size: 30, y: '470', colour: MUTED },
    { text: 'Chapters', size: 30, x: '(w/2)-300', y: '560', bold: true, colour: MUTED },
    { text: chapterList, size: 30, x: '(w/2)-300', y: '610', colour: '0xe2e8f0' },
  ]);

  const list = path.join(TMP, `${journey.id}.concat.txt`);
  writeFileSync(list, [intro, ...parts].map((p) => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n'), 'utf8');
  const joined = path.join(TMP, `${journey.id}.joined.mp4`);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);

  const shifted = chapters.map((c) => ({ title: c.title, at: c.at + introSeconds }));
  const file = path.join(OUT, `${journey.id}.mp4`);
  withChapters(joined, file, [{ title: 'Introduction', at: 0 }, ...shifted]);
  writeFileSync(
    path.join(OUT, `${journey.id}.chapters.txt`),
    [`0:00 Introduction`, ...shifted.map((c) => `${fmt(c.at)} ${c.title}`)].join('\n') + '\n',
    'utf8',
  );
  return { file, chapters: [{ title: 'Introduction', at: 0 }, ...shifted] };
}

/** Copy `src` to `dst` with MP4 chapter markers. */
function withChapters(src: string, dst: string, chapters: Array<{ title: string; at: number }>): void {
  const end = durationOf(src);
  const meta = [';FFMETADATA1'];
  chapters.forEach((c, i) => {
    const next = chapters[i + 1]?.at ?? end;
    meta.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.at * 1000)}`, `END=${Math.round(next * 1000)}`, `title=${c.title}`);
  });
  const metaFile = path.join(TMP, `${path.basename(dst)}.meta.txt`);
  writeFileSync(metaFile, meta.join('\n') + '\n', 'utf8');
  ffmpeg(['-i', src, '-i', metaFile, '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movflags', '+faststart', dst]);
}

function main(): void {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    console.log('[guided] ffmpeg not found (scoop install ffmpeg).');
    return;
  }
  const { run, only } = args();
  const manifest = manifestFor(run);
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  console.log(`[guided] run ${manifest.runId}`);

  const built: Array<{ journey: Journey; result: Built }> = [];
  for (const journey of JOURNEYS.filter((j) => !only || j.id.includes(only))) {
    const record = manifest.results.find((r) => r.declaration.id === journey.id && r.viewport === 'desktop' && r.status === 'passed');
    if (!record) {
      console.log(`[guided] skipped ${journey.id}: no passing desktop recording in this run`);
      continue;
    }
    try {
      const result = buildJourney(journey, record);
      if (result) {
        built.push({ journey, result });
        console.log(`[guided] wrote ${result.file} (${Math.round(durationOf(result.file))}s)`);
      }
    } catch (error) {
      console.log(`[guided] failed ${journey.id}: ${(error as Error).message}`);
    }
  }

  // One film of every journey, each opening with its own card, chapters per journey.
  if (built.length > 1 && !only) {
    const list = path.join(TMP, 'all.concat.txt');
    writeFileSync(list, built.map((b) => `file '${path.resolve(b.result.file).replace(/\\/g, '/')}'`).join('\n'), 'utf8');
    const joined = path.join(TMP, 'all.joined.mp4');
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
    let offset = 0;
    const chapters: Array<{ title: string; at: number }> = [];
    for (const b of built) {
      chapters.push({ title: b.journey.title, at: offset });
      offset += durationOf(b.result.file);
    }
    const film = path.join(OUT, 'noditto-guided-demo.mp4');
    withChapters(joined, film, chapters);
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    writeFileSync(path.join(OUT, 'noditto-guided-demo.chapters.txt'), chapters.map((c) => `${fmt(c.at)} ${c.title}`).join('\n') + '\n', 'utf8');
    console.log(`[guided] wrote ${film} (${Math.round(durationOf(film))}s)`);
  }
  rmSync(TMP, { recursive: true, force: true });
}

main();
