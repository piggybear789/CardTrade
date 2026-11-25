// scripts/e2e/audit-report.ts
//
// Generates the self-contained HTML Audit_Report (`audit-report/`) from the newest
// run manifest, the Coverage_Map, and `.pathways.json` (Task 17.1).
//
// Requirements: 3.5, 4.7, 5.3, 5.6, 29.6, 32.3, 32.4, 33.1–33.7

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  aggregateRun,
  type PathwayRecord,
  type RunManifest,
  type UniversePathway,
} from '../../tests/e2e/audit/core/aggregate';
import {
  ARTIFACT_ROOT,
  RUNS_DIR,
  supersededRuns,
  type Viewport,
} from '../../tests/e2e/audit/core/artifactPaths';
import { findingDraft } from '../../tests/e2e/audit/core/findings';
import {
  renderIndex,
  renderPathwayPage,
  type ReportPathwayRecord,
  type ReportRun,
} from '../../tests/e2e/audit/core/html';
import { findLeaks, isForbiddenArtifact, secretValues } from '../../tests/e2e/audit/core/mask';
import { COVERAGE_MAP } from '../../tests/e2e/audit/coverage';
import { readPathwayUniverse } from '../../tests/e2e/audit/pathwayUniverse';

const ROOT = process.cwd();
const RUNS_ROOT = path.join(ROOT, ARTIFACT_ROOT, RUNS_DIR);
const REPORT_DIR = path.join(ROOT, 'audit-report');
const MEDIA_DIR = path.join(REPORT_DIR, 'media');
const FINDINGS_MD = path.join(ROOT, 'tests', 'e2e', 'FINDINGS.md');

function newestManifestPath(): string {
  if (!existsSync(RUNS_ROOT)) {
    throw new Error(`No runs directory found at ${RUNS_ROOT}. Run \`npm run audit\` first.`);
  }
  const candidates = readdirSync(RUNS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(RUNS_ROOT, d.name, 'manifest.json'))
    .filter((p) => existsSync(p))
    .map((p) => ({ path: p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (candidates.length === 0) {
    throw new Error(`No manifest.json found under ${RUNS_ROOT}.`);
  }
  return candidates[0].path;
}

function areaFromId(id: string): UniversePathway['area'] {
  const prefix = id.split('.')[0];
  return prefix as UniversePathway['area'];
}

function copyMediaFile(relativeSource: string): string {
  if (isForbiddenArtifact(relativeSource)) {
    throw new Error(`Refusing forbidden artifact path in report media: ${relativeSource}`);
  }
  const absSource = path.resolve(ROOT, relativeSource);
  if (!existsSync(absSource)) return relativeSource;

  const relUnderArtifacts = path.relative(path.join(ROOT, ARTIFACT_ROOT), absSource);
  const safeRel = relUnderArtifacts.startsWith('..')
    ? path.basename(absSource)
    : relUnderArtifacts;
  if (isForbiddenArtifact(safeRel)) {
    throw new Error(`Refusing forbidden media destination: ${safeRel}`);
  }
  const dest = path.join(MEDIA_DIR, safeRel);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(absSource, dest);
  return `media/${safeRel.replace(/\\/g, '/')}`;
}

function rewriteRecordMedia(record: PathwayRecord): ReportPathwayRecord {
  return {
    ...record,
    steps: record.steps.map((step) => ({
      ...step,
      screenshots: step.screenshots.map((shot) => ({
        ...shot,
        path: copyMediaFile(shot.path),
      })),
    })),
    videos: record.videos.map((video) => ({
      ...video,
      path: copyMediaFile(video.path),
    })),
    ...(record.tracePath ? { tracePath: copyMediaFile(record.tracePath) } : {}),
  };
}

function assertNoLeaksInTextFiles(dir: string, secrets: readonly string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      assertNoLeaksInTextFiles(full, secrets);
      continue;
    }
    if (!/\.(html|js|json|md|txt|css)$/i.test(entry.name)) continue;
    const text = readFileSync(full, 'utf8');
    const leaks = findLeaks(text, process.env);
    if (leaks.length > 0) {
      throw new Error(`Secret leak detected in ${path.relative(ROOT, full)}: ${leaks.join(', ')}`);
    }
  }
}

export function generateAuditReport(): { reportDir: string; runId: string } {
  const manifestPath = newestManifestPath();
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RunManifest;
  const universeIds = readPathwayUniverse(ROOT).ids;
  const universe: UniversePathway[] = universeIds.map((id) => ({ id, area: areaFromId(id) }));

  const aggregated = aggregateRun(manifest, universe, COVERAGE_MAP);

  rmSync(REPORT_DIR, { recursive: true, force: true });
  mkdirSync(path.join(REPORT_DIR, 'pathways'), { recursive: true });
  mkdirSync(MEDIA_DIR, { recursive: true });

  const rewrittenResults = manifest.results.map(rewriteRecordMedia);
  const reportRun: ReportRun = {
    manifest: aggregated.manifest,
    totals: aggregated.totals,
    pathways: aggregated.pathways,
    coverage: aggregated.coverage,
  };

  const indexHtml = renderIndex(reportRun);
  writeFileSync(path.join(REPORT_DIR, 'index.html'), indexHtml, 'utf8');
  writeFileSync(
    path.join(REPORT_DIR, 'data.js'),
    `window.__AUDIT__ = ${JSON.stringify({ ...reportRun, results: rewrittenResults })};\n`,
    'utf8',
  );

  // Per-pathway HTML pages
  const byId = new Map<string, ReportPathwayRecord[]>();
  for (const r of rewrittenResults) {
    const list = byId.get(r.declaration.id) ?? [];
    list.push(r);
    byId.set(r.declaration.id, list);
  }
  for (const [id, records] of byId.entries()) {
    const html = renderPathwayPage(records[0].declaration, records);
    writeFileSync(path.join(REPORT_DIR, 'pathways', `${id}.html`), html, 'utf8');
  }

  const findingsMd = existsSync(FINDINGS_MD) ? readFileSync(FINDINGS_MD, 'utf8') : '';
  const draft = findingDraft(findingsMd, manifest.results);
  writeFileSync(path.join(REPORT_DIR, 'findings-draft.md'), draft, 'utf8');

  // Verify no secret values leaked into any published text file
  const secrets = secretValues(process.env);
  assertNoLeaksInTextFiles(REPORT_DIR, secrets);

  // Clean superseded run directories per (pathwayId, viewport) pair
  const allRuns = readdirSync(RUNS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const toDelete = new Set<string>();
  for (const r of manifest.results) {
    for (const oldRun of supersededRuns(allRuns, r.declaration.id, r.viewport)) {
      toDelete.add(oldRun);
    }
  }
  for (const oldRun of toDelete) {
    rmSync(path.join(RUNS_ROOT, oldRun), { recursive: true, force: true });
  }

  console.log(`[audit-report] Wrote report for run ${manifest.runId} to ${REPORT_DIR}`);
  return { reportDir: REPORT_DIR, runId: manifest.runId };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  generateAuditReport();
}
