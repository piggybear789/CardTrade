// scripts/e2e/highlight-reel.ts
//
// Optional highlight reel builder (Task 19.1, Req 36.1–36.4).
// Reads the newest manifest, queries ffprobe durations, plans clips with `planReel`,
// and stitches `audit-report/highlight-reel.mp4` via ffmpeg. Exits 0 if ffmpeg is absent.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { RunManifest } from '../../tests/e2e/audit/core/aggregate';
import { ARTIFACT_ROOT, RUNS_DIR } from '../../tests/e2e/audit/core/artifactPaths';
import { planReel, type ReelSelectionEntry, type ReelVideoResult } from '../../tests/e2e/audit/core/reel';
import { HIGHLIGHT_SELECTION } from '../../tests/e2e/audit/highlights';

const ROOT = process.cwd();
const RUNS_ROOT = path.join(ROOT, ARTIFACT_ROOT, RUNS_DIR);
const OUT_MP4 = path.join(ROOT, 'audit-report', 'highlight-reel.mp4');

function hasBinary(cmd: string): boolean {
  const res = spawnSync(cmd, ['-version'], { stdio: 'ignore' });
  return res.status === 0;
}

function durationSec(file: string): number {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { encoding: 'utf8' },
    );
    const parsed = Number.parseFloat(out.trim());
    return Number.isFinite(parsed) ? parsed : 10;
  } catch {
    return 10;
  }
}

function main(): void {
  if (!existsSync(RUNS_ROOT)) {
    console.log('[highlight-reel] No runs found; skipping.');
    return;
  }
  const manifests = readdirSync(RUNS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(RUNS_ROOT, d.name, 'manifest.json'))
    .filter((p) => existsSync(p))
    .map((p) => ({ path: p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (manifests.length === 0) {
    console.log('[highlight-reel] No manifest.json found; skipping.');
    return;
  }
  const manifest = JSON.parse(readFileSync(manifests[0].path, 'utf8')) as RunManifest;
  const hasFfmpeg = hasBinary('ffmpeg') && hasBinary('ffprobe');

  const selection: ReelSelectionEntry[] = HIGHLIGHT_SELECTION.map((pathwayId) => ({
    pathwayId,
    member: 'buyer',
    viewport: 'desktop',
  }));

  const results: ReelVideoResult[] = [];
  for (const r of manifest.results) {
    for (const v of r.videos) {
      const absVideo = path.resolve(ROOT, v.path);
      results.push({
        pathwayId: r.declaration.id,
        viewport: r.viewport,
        member: v.member,
        title: r.declaration.title,
        status: r.status,
        masked: v.masked,
        video: absVideo,
        durationS: hasFfmpeg && existsSync(absVideo) ? durationSec(absVideo) : 15,
      });
    }
  }

  const plan = planReel(selection, results);
  if (!hasFfmpeg) {
    console.log('[highlight-reel] ffmpeg/ffprobe not found on PATH. Planned segments:');
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (plan.segments.length === 0) {
    console.log('[highlight-reel] No eligible clips for highlight reel.');
    return;
  }

  mkdirSync(path.dirname(OUT_MP4), { recursive: true });
  const listFile = path.join(path.dirname(OUT_MP4), 'reel-concat.txt');
  writeFileSync(
    listFile,
    plan.segments.map((c) => `file '${c.video.replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8',
  );
  execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', OUT_MP4], {
    stdio: 'inherit',
  });
  console.log(`[highlight-reel] Wrote ${OUT_MP4}`);
}

main();
