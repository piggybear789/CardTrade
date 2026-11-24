// tests/e2e/audit/core/html.ts
//
// THE AUDIT REPORT'S HTML for the e2e UX audit suite. Pure: no I/O, no Playwright, no
// `node:fs`, no network. `scripts/e2e/audit-report.ts` calls `aggregateRun`, hands the
// result and each Pathway's records in here, and writes the returned strings to
// `audit-report/index.html` and `audit-report/pathways/<id>.html`.
//
// Requirements:
//   33.1  the index groups Pathways by functional area and shows each Pathway's status
//         per viewport, with its simulated label and observation count
//   33.2  each Pathway has a page with its title, kind, ordered steps with their
//         member-labelled screenshots, its videos, its observations by step, and its
//         trace link when it failed
//   33.4  the index shows the Coverage_Map with each function's status per viewport,
//         the manual checks and the out-of-scope entries
//   33.7  the index filters Pathways by status, area, viewport and "has observations"
//         with plain JavaScript over `data-*` attributes, so it works from `file://`
//
// Every value interpolated into markup goes through `escapeHtml`, attribute values
// included. Media and trace links additionally go through `safeHref`, which refuses
// any URL with a scheme, so a generated string can never become a `javascript:` link.
//
// The input types below are the SUBSETS of the design's `AggregatedRun` and
// `PathwayRecord` this module reads, written structurally (as `findings.ts` does) so the
// full records from `aggregate.ts` and the reporter are accepted as they are.

import type { Area, CoverageEntry } from './coverageMap';
import { VIEWPORTS, type Viewport } from './artifactPaths';

/** A Pathway's status for one viewport in a run (design: `PathwayStatus`). */
export type ReportPathwayStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'not-run';

/** A Coverage_Map entry's status for one viewport (design: `CoverageStatus`). */
export type ReportCoverageStatus =
  | 'passing' | 'failing' | 'partly-run' | 'not-run'
  | 'manual' | 'not-automated' | 'out-of-scope';

/** Pathway statuses in the order the totals and the status filter list them. */
export const PATHWAY_STATUSES: readonly ReportPathwayStatus[] = ['passed', 'failed', 'flaky', 'skipped', 'not-run'];

/** The subset of a UX observation (design: `Observation`) the report shows. */
export interface ReportObservation {
  check: string;
  severity: 'blocking' | 'advisory';
  member: string;
  url: string;
  message: string;
  detail?: Record<string, string | number>;
  suppressedBy?: string;
  source: 'automated' | 'reviewer';
}

/** The subset of a step record (design: `StepRecord`) the report shows. */
export interface ReportStep {
  index: number;
  name: string;
  kind: 'action' | 'assert' | 'arrange' | 'simulated';
  simulated?: { mechanism: string; reason?: string };
  members: string[];
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  screenshots: Array<{ member: string; path: string }>;
  observations: ReportObservation[];
  error?: string;
}

/** The subset of a Pathway declaration (design: `PathwayDeclaration`) the report shows. */
export interface ReportDeclaration {
  id: string;
  title: string;
  area: Area;
  kind: 'happy' | 'refusal';
  provider: 'stripe' | 'mock';
  mockReason?: string;
  isolated?: boolean;
  suppress?: Array<{ check: string; url: string; reason: string }>;
  knownFindings?: string[];
}

/** The subset of one Pathway's result on one viewport (design: `PathwayRecord`). */
export interface ReportPathwayRecord {
  declaration: ReportDeclaration;
  viewport: Viewport;
  runId: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped';
  retries: number;
  steps: ReportStep[];
  videos: Array<{ member: string; path: string; masked: boolean }>;
  forced: Array<{ step: number; locator: string; reason: string }>;
  tracePath?: string;
  paymentsMode: 'stripe-test' | 'mock';
  simulated: boolean;
}

/** The subset of an aggregated run (design: `AggregatedRun`) the index shows. */
export interface ReportRun {
  manifest: {
    runId: string;
    startedAt: string;
    durationMs: number;
    commit: string;
    schema: string;
    servers: Array<{ name: string; port: number; paymentsMode: string }>;
    leftInStripe?: Array<{ type: string; id: string; reason: string }>;
  };
  totals: Record<ReportPathwayStatus, number>;
  pathways: Array<{
    id: string;
    area: Area;
    byViewport: Record<Viewport, ReportPathwayStatus>;
    simulated: boolean;
    observationCount: number;
  }>;
  coverage: Array<{ entry: CoverageEntry; byViewport: Record<Viewport, ReportCoverageStatus> }>;
}

/** Per-Pathway extras the index shows when the caller has them. */
export interface IndexPathwayDetail {
  title?: string;
  kind?: 'happy' | 'refusal';
  /** Payments mode per viewport the Pathway ran on (Req 33.3). */
  paymentsMode?: Partial<Record<Viewport, string>>;
}

/** Options for `renderIndex`. */
export interface RenderIndexOptions {
  /** Titles, kinds and payments modes by Pathway id. */
  details?: Readonly<Record<string, IndexPathwayDetail>>;
  /**
   * `src` of the data script (`window.__AUDIT__ = …`), relative to the index.
   * Defaults to `data.js`; `null` leaves it out.
   */
  dataScriptSrc?: string | null;
  /** Href of a Pathway's page, relative to the index. Defaults to `pathways/<id>.html`. */
  pathwayHref?: (id: string) => string;
}

/** Options for `renderPathwayPage`. */
export interface RenderPathwayPageOptions {
  /**
   * Href of a copied artifact (screenshot, video, trace) relative to the Pathway page.
   * Defaults to `../media/<path>` with `\` turned into `/`.
   */
  mediaHref?: (artifactPath: string) => string;
  /** Href of the index, relative to the Pathway page. Defaults to `../index.html`. */
  indexHref?: string;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes text for use in HTML content and in quoted attribute values: `&`, `<`, `>`,
 * `"` and `'` become entities. The output never contains a raw `<`, `>`, `"` or `'`
 * (Property 12). A non-string is converted with `String` first; nullish becomes ''.
 */
export function escapeHtml(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * A link target the report may emit: a relative path or fragment. Anything with a URL
 * scheme (`javascript:`, `data:`, `http:`, …) or a protocol-relative `//` start becomes
 * `#`, because the report links only to files it copied beside itself (Req 33.5).
 * Returned unescaped; callers still pass it through `escapeHtml`.
 */
export function safeHref(href: string): string {
  const trimmed = href.trim();
  // Browsers ignore tabs and newlines inside a scheme, so strip them before testing.
  const compact = trimmed.replace(/[\t\n\r]/g, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(compact) || /^[\\/]{2}/.test(compact)) return '#';
  return trimmed;
}

/** `href="…"`, made safe and escaped. */
function hrefAttr(href: string): string {
  return `href="${escapeHtml(safeHref(href))}"`;
}

/** `src="…"`, made safe and escaped. */
function srcAttr(src: string): string {
  return `src="${escapeHtml(safeHref(src))}"`;
}

/** Percent-encodes each `/`-separated segment of a relative path. */
function encodePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '')
    .map(encodeURIComponent)
    .join('/');
}

function defaultMediaHref(artifactPath: string): string {
  return `../media/${encodePath(artifactPath)}`;
}

function defaultPathwayHref(id: string): string {
  return `pathways/${encodeURIComponent(id)}.html`;
}

/** Human duration, e.g. `1h 02m 05s`, `3m 07s`, `850 ms`. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

const VIEWPORT_LABEL: Readonly<Record<Viewport, string>> = { desktop: 'Desktop', phone: 'Phone' };

/** A status badge. The class is drawn from the value, escaped like everything else. */
function badge(status: string): string {
  return `<span class="status status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

const STYLE = `
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0 auto; max-width: 1200px; padding: 1.5rem; line-height: 1.45; }
table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1.5rem; }
th, td { border-bottom: 1px solid #8884; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
.status { display: inline-block; padding: 0 0.4rem; border-radius: 0.25rem; font-size: 0.85em; background: #8882; }
.status-passed, .status-passing { background: #1a7f3733; }
.status-failed, .status-failing { background: #cf222e33; }
.status-flaky, .status-partly-run { background: #bf870033; }
.status-not-run, .status-skipped { background: #8883; }
.tag { font-size: 0.8em; padding: 0 0.35rem; border: 1px solid #8886; border-radius: 0.25rem; }
.blocking { color: #cf222e; font-weight: 600; }
.grid { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.grid figure { margin: 0; max-width: 360px; }
.grid img, .grid video { max-width: 100%; border: 1px solid #8884; }
#filters { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0.5rem 0 1rem; }
pre { white-space: pre-wrap; background: #8881; padding: 0.5rem; }
`.trim();

function page(title: string, body: string, scripts = ''): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    body,
    scripts,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/**
 * The filter script (Req 33.7). Static text with no interpolation: it reads the
 * `data-*` attributes each Pathway row carries and hides rows, and area groups left
 * empty, that the selected filters exclude. With a viewport selected, the status filter
 * applies to that viewport, and with no status a row shows only if it ran there.
 */
const FILTER_SCRIPT = `<script>
(function () {
  var form = document.getElementById('filters');
  if (!form) return;
  function apply() {
    var status = form.elements.status.value;
    var area = form.elements.area.value;
    var viewport = form.elements.viewport.value;
    var observations = form.elements.observations.value;
    var viewports = viewport ? [viewport] : ['desktop', 'phone'];
    document.querySelectorAll('tr[data-pathway]').forEach(function (row) {
      var statusOk = viewports.some(function (v) {
        var s = row.getAttribute('data-status-' + v);
        return status ? s === status : (!viewport || s !== 'not-run');
      });
      var areaOk = !area || row.getAttribute('data-area') === area;
      var obsOk = !observations || row.getAttribute('data-observations') === observations;
      row.hidden = !(statusOk && areaOk && obsOk);
    });
    document.querySelectorAll('section[data-area-group]').forEach(function (group) {
      group.hidden = !group.querySelector('tr[data-pathway]:not([hidden])');
    });
  }
  form.addEventListener('change', apply);
  form.addEventListener('reset', function () { setTimeout(apply, 0); });
  apply();
})();
</script>`;

function option(value: string, label: string): string {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function renderRunHeader(run: ReportRun): string {
  const m = run.manifest;
  const servers = m.servers.length === 0
    ? '<li>none recorded</li>'
    : m.servers
      .map((s) => `<li>${escapeHtml(s.name)} (port ${escapeHtml(s.port)}): payments ${escapeHtml(s.paymentsMode)}</li>`)
      .join('');
  const totals = PATHWAY_STATUSES
    .map((status) => `<li>${badge(status)} ${escapeHtml(run.totals[status] ?? 0)}</li>`)
    .join('');
  const left = m.leftInStripe && m.leftInStripe.length > 0
    ? [
      '<h3>Left in Stripe</h3>',
      '<table><thead><tr><th>Type</th><th>Id</th><th>Reason</th></tr></thead><tbody>',
      ...m.leftInStripe.map((o) =>
        `<tr><td>${escapeHtml(o.type)}</td><td>${escapeHtml(o.id)}</td><td>${escapeHtml(o.reason)}</td></tr>`),
      '</tbody></table>',
    ].join('\n')
    : '';
  return [
    '<header>',
    '<h1>NoDitto UX audit</h1>',
    '<dl>',
    `<dt>Run</dt><dd>${escapeHtml(m.runId)}</dd>`,
    `<dt>Started</dt><dd>${escapeHtml(m.startedAt)}</dd>`,
    `<dt>Commit</dt><dd><code>${escapeHtml(m.commit)}</code></dd>`,
    `<dt>Schema</dt><dd>${escapeHtml(m.schema)}</dd>`,
    `<dt>Duration</dt><dd>${escapeHtml(formatDuration(m.durationMs))}</dd>`,
    `<dt>Servers</dt><dd><ul>${servers}</ul></dd>`,
    '</dl>',
    `<h2>Totals</h2><ul class="totals">${totals}</ul>`,
    left,
    '</header>',
  ].join('\n');
}

function coverageMappingCell(entry: CoverageEntry): string {
  switch (entry.kind) {
    case 'automated': {
      const list = (ids: readonly string[]): string =>
        ids.length === 0 ? '—' : ids.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ');
      return `happy: ${list(entry.happy)}<br>refusal: ${list(entry.refusal)}`;
    }
    case 'manual':
      return `${escapeHtml(entry.reason)}<br>Manual check: ${escapeHtml(entry.manualCheck)}`;
    case 'not-automated':
    case 'out-of-scope':
      return escapeHtml(entry.reason);
    default:
      return '—';
  }
}

function renderCoverage(run: ReportRun): string {
  const rows = run.coverage.map(({ entry, byViewport }) => [
    `<tr data-coverage="${escapeHtml(entry.id)}" data-kind="${escapeHtml(entry.kind)}">`,
    `<td><code>${escapeHtml(entry.id)}</code></td>`,
    `<td>${escapeHtml(entry.function)}</td>`,
    `<td>${escapeHtml(entry.area)}</td>`,
    `<td>${escapeHtml(entry.kind)}</td>`,
    ...VIEWPORTS.map((v) => `<td>${badge(byViewport[v] ?? 'not-run')}</td>`),
    `<td>${coverageMappingCell(entry)}</td>`,
    '</tr>',
  ].join(''));

  const manual = run.coverage
    .map(({ entry }) => entry)
    .filter((entry): entry is Extract<CoverageEntry, { kind: 'manual' }> => entry.kind === 'manual');
  const outOfScope = run.coverage
    .map(({ entry }) => entry)
    .filter((entry): entry is Extract<CoverageEntry, { kind: 'out-of-scope' }> => entry.kind === 'out-of-scope');

  const manualList = manual.length === 0
    ? '<p>None.</p>'
    : `<ul>${manual.map((e) =>
      `<li><strong>${escapeHtml(e.function)}</strong> (<code>${escapeHtml(e.id)}</code>): ${escapeHtml(e.manualCheck)}</li>`).join('')}</ul>`;
  const scopeList = outOfScope.length === 0
    ? '<p>None.</p>'
    : `<ul>${outOfScope.map((e) =>
      `<li><strong>${escapeHtml(e.function)}</strong> (<code>${escapeHtml(e.id)}</code>): ${escapeHtml(e.reason)}</li>`).join('')}</ul>`;

  return [
    '<section id="coverage">',
    '<h2>Coverage map</h2>',
    '<table><thead><tr><th>Entry</th><th>Function</th><th>Area</th><th>Kind</th>',
    ...VIEWPORTS.map((v) => `<th>${escapeHtml(VIEWPORT_LABEL[v])}</th>`),
    '<th>Mapping</th></tr></thead><tbody>',
    ...rows,
    '</tbody></table>',
    '<h3>Manual checks</h3>',
    manualList,
    '<h3>Out of scope</h3>',
    scopeList,
    '</section>',
  ].join('\n');
}

function renderFilters(areas: readonly string[]): string {
  return [
    '<form id="filters" onsubmit="return false">',
    `<label>Status <select name="status">${option('', 'Any')}${PATHWAY_STATUSES.map((s) => option(s, s)).join('')}</select></label>`,
    `<label>Area <select name="area">${option('', 'Any')}${areas.map((a) => option(a, a)).join('')}</select></label>`,
    `<label>Viewport <select name="viewport">${option('', 'Any')}${VIEWPORTS.map((v) => option(v, VIEWPORT_LABEL[v])).join('')}</select></label>`,
    `<label>Observations <select name="observations">${option('', 'Any')}${option('yes', 'Has observations')}${option('no', 'None')}</select></label>`,
    '<button type="reset">Clear</button>',
    '</form>',
  ].join('\n');
}

function renderPathwayGroups(run: ReportRun, options: RenderIndexOptions): { html: string; areas: string[] } {
  const details = options.details ?? {};
  const hrefFor = options.pathwayHref ?? defaultPathwayHref;
  const groups = new Map<string, ReportRun['pathways']>();
  for (const pathway of run.pathways) {
    const list = groups.get(pathway.area) ?? [];
    list.push(pathway);
    groups.set(pathway.area, list);
  }
  const areas = [...groups.keys()];

  const sections = areas.map((area) => {
    const rows = (groups.get(area) ?? []).map((p) => {
      const detail = details[p.id] ?? {};
      const ran = VIEWPORTS.some((v) => p.byViewport[v] !== 'not-run');
      const name = ran
        ? `<a ${hrefAttr(hrefFor(p.id))}>${escapeHtml(detail.title ?? p.id)}</a>`
        : escapeHtml(detail.title ?? p.id);
      const modes = VIEWPORTS
        .filter((v) => detail.paymentsMode?.[v] !== undefined)
        .map((v) => `${escapeHtml(VIEWPORT_LABEL[v])}: ${escapeHtml(detail.paymentsMode?.[v])}`)
        .join('<br>');
      return [
        `<tr data-pathway="${escapeHtml(p.id)}" data-area="${escapeHtml(p.area)}"`,
        ...VIEWPORTS.map((v) => ` data-status-${v}="${escapeHtml(p.byViewport[v] ?? 'not-run')}"`),
        ` data-observations="${p.observationCount > 0 ? 'yes' : 'no'}"`,
        ` data-simulated="${p.simulated ? 'yes' : 'no'}">`,
        `<td>${name}<br><code>${escapeHtml(p.id)}</code></td>`,
        `<td>${escapeHtml(detail.kind ?? '')}</td>`,
        ...VIEWPORTS.map((v) => `<td>${badge(p.byViewport[v] ?? 'not-run')}</td>`),
        `<td>${p.simulated ? '<span class="tag">simulated</span>' : ''}</td>`,
        `<td>${escapeHtml(p.observationCount)}</td>`,
        `<td>${modes}</td>`,
        '</tr>',
      ].join('');
    });
    return [
      `<section data-area-group="${escapeHtml(area)}">`,
      `<h3>${escapeHtml(area)}</h3>`,
      '<table><thead><tr><th>Pathway</th><th>Kind</th>',
      ...VIEWPORTS.map((v) => `<th>${escapeHtml(VIEWPORT_LABEL[v])}</th>`),
      '<th>Simulated</th><th>Observations</th><th>Payments</th></tr></thead><tbody>',
      ...rows,
      '</tbody></table>',
      '</section>',
    ].join('\n');
  });

  return { html: sections.join('\n'), areas };
}

/**
 * The report's index page (Req 33.1, 33.3, 33.4, 33.7): run header and totals, the
 * Coverage_Map with each entry's status per viewport plus the manual checks and
 * out-of-scope entries, then every Pathway grouped by area with its status per
 * viewport, simulated label and observation count. Pathways that did not run on any
 * viewport are listed without a link. Filters are a static script over `data-*`
 * attributes, so the page works from `file://`.
 */
export function renderIndex(run: ReportRun, options: RenderIndexOptions = {}): string {
  const groups = renderPathwayGroups(run, options);
  const dataSrc = options.dataScriptSrc === undefined ? 'data.js' : options.dataScriptSrc;
  const scripts = [
    dataSrc === null ? '' : `<script ${srcAttr(dataSrc)}></script>`,
    FILTER_SCRIPT,
  ].join('\n');
  const body = [
    renderRunHeader(run),
    '<main>',
    renderCoverage(run),
    '<section id="pathways">',
    '<h2>Pathways</h2>',
    renderFilters(groups.areas),
    groups.html,
    '</section>',
    '</main>',
  ].join('\n');
  return page(`UX audit ${run.manifest.runId}`, body, scripts);
}

// ---------------------------------------------------------------------------
// Pathway page
// ---------------------------------------------------------------------------

function renderObservations(observations: readonly ReportObservation[]): string {
  if (observations.length === 0) return '';
  const items = observations.map((o) => {
    const detail = o.detail
      ? ` <small>${Object.entries(o.detail)
        .map(([k, v]) => `${escapeHtml(k)}=${escapeHtml(v)}`)
        .join(', ')}</small>`
      : '';
    const suppressed = o.suppressedBy !== undefined
      ? ` <span class="tag">suppressed: ${escapeHtml(o.suppressedBy)}</span>`
      : '';
    return [
      `<li data-check="${escapeHtml(o.check)}" data-severity="${escapeHtml(o.severity)}">`,
      `<span class="${o.severity === 'blocking' ? 'blocking' : ''}">${escapeHtml(o.severity)}</span> `,
      `<code>${escapeHtml(o.check)}</code> (${escapeHtml(o.member)}, ${escapeHtml(o.source)}): `,
      escapeHtml(o.message),
      ` <small>${escapeHtml(o.url)}</small>`,
      detail,
      suppressed,
      '</li>',
    ].join('');
  });
  return `<ul class="observations">${items.join('')}</ul>`;
}

function renderStep(step: ReportStep, mediaHref: (path: string) => string): string {
  const simulated = step.simulated
    ? ` <span class="tag">simulated: ${escapeHtml(step.simulated.mechanism)}${step.simulated.reason ? ` (${escapeHtml(step.simulated.reason)})` : ''}</span>`
    : '';
  const shots = step.screenshots.length === 0
    ? ''
    : `<div class="grid">${step.screenshots.map((shot) =>
      `<figure><a ${hrefAttr(mediaHref(shot.path))}><img loading="lazy" ${srcAttr(mediaHref(shot.path))} alt="${escapeHtml(`Step ${step.index}, ${shot.member}`)}"></a><figcaption>${escapeHtml(shot.member)}</figcaption></figure>`).join('')}</div>`;
  const error = step.error ? `<pre>${escapeHtml(step.error)}</pre>` : '';
  return [
    `<li data-step="${escapeHtml(step.index)}" data-status="${escapeHtml(step.status)}">`,
    `<strong>${escapeHtml(step.index)}. ${escapeHtml(step.name)}</strong> `,
    `${badge(step.status)} <span class="tag">${escapeHtml(step.kind)}</span>${simulated} `,
    `<small>${escapeHtml(step.members.join(', '))} · ${escapeHtml(formatDuration(step.durationMs))}</small>`,
    error,
    shots,
    renderObservations(step.observations),
    '</li>',
  ].join('');
}

function renderRecord(record: ReportPathwayRecord, mediaHref: (path: string) => string): string {
  const steps = [...record.steps].sort((a, b) => a.index - b.index);
  const forced = record.forced.length === 0
    ? '<p>No forced interactions.</p>'
    : [
      '<table><thead><tr><th>Step</th><th>Locator</th><th>Reason</th></tr></thead><tbody>',
      ...record.forced.map((f) =>
        `<tr><td>${escapeHtml(f.step)}</td><td><code>${escapeHtml(f.locator)}</code></td><td>${escapeHtml(f.reason)}</td></tr>`),
      '</tbody></table>',
    ].join('');
  const trace = record.status === 'failed' && record.tracePath
    ? `<p><a ${hrefAttr(mediaHref(record.tracePath))}>Trace (open with <code>npx playwright show-trace</code>)</a></p>`
    : '';
  return [
    `<section data-viewport="${escapeHtml(record.viewport)}">`,
    `<h2>${escapeHtml(VIEWPORT_LABEL[record.viewport] ?? record.viewport)} ${badge(record.status)}</h2>`,
    `<p>Run <code>${escapeHtml(record.runId)}</code> · payments ${escapeHtml(record.paymentsMode)} · retries ${escapeHtml(record.retries)}${record.simulated ? ' · <span class="tag">simulated</span>' : ''}</p>`,
    trace,
    '<h3>Steps</h3>',
    steps.length === 0 ? '<p>No steps recorded.</p>' : `<ol class="steps">${steps.map((s) => renderStep(s, mediaHref)).join('')}</ol>`,
    '<h3>Forced interactions</h3>',
    forced,
    '</section>',
  ].join('\n');
}

function renderVideos(records: readonly ReportPathwayRecord[], mediaHref: (path: string) => string): string {
  const figures = records.flatMap((record) =>
    record.videos.map((video) => [
      '<figure>',
      `<video controls preload="metadata" ${srcAttr(mediaHref(video.path))}></video>`,
      `<figcaption>${escapeHtml(video.member)} · ${escapeHtml(VIEWPORT_LABEL[record.viewport] ?? record.viewport)}`,
      video.masked ? '' : ' <span class="tag blocking">not verified masked</span>',
      '</figcaption>',
      '</figure>',
    ].join('')));
  return figures.length === 0 ? '<p>No videos recorded.</p>' : `<div class="grid">${figures.join('')}</div>`;
}

/**
 * One Pathway's page (Req 33.2): title, kind, area, payments mode, simulated
 * mechanisms, known findings and suppressions, then per viewport the ordered steps
 * with member-labelled screenshots and their observations, forced interactions and,
 * when the Pathway failed, its trace link; and every video side by side by member and
 * viewport. `records` are this Pathway's results, at most one per viewport; a viewport
 * with no record is shown as not run.
 */
export function renderPathwayPage(
  declaration: ReportDeclaration,
  records: readonly ReportPathwayRecord[],
  options: RenderPathwayPageOptions = {},
): string {
  const mediaHref = options.mediaHref ?? defaultMediaHref;
  const indexHref = options.indexHref ?? '../index.html';
  const own = records.filter((r) => r.declaration.id === declaration.id);
  const ordered = VIEWPORTS
    .map((v) => own.find((r) => r.viewport === v))
    .filter((r): r is ReportPathwayRecord => r !== undefined);
  const notRun = VIEWPORTS.filter((v) => !ordered.some((r) => r.viewport === v));

  const mechanisms = new Map<string, string>();
  for (const record of ordered) {
    for (const step of record.steps) {
      if (!step.simulated) continue;
      const label = step.simulated.reason
        ? `${step.simulated.mechanism} (${step.simulated.reason})`
        : step.simulated.mechanism;
      mechanisms.set(label, label);
    }
  }
  const modes = ordered
    .map((r) => `${escapeHtml(VIEWPORT_LABEL[r.viewport] ?? r.viewport)}: ${escapeHtml(r.paymentsMode)}`)
    .join(', ');
  const provider = declaration.provider === 'mock' && declaration.mockReason
    ? `${escapeHtml(declaration.provider)} (${escapeHtml(declaration.mockReason)})`
    : escapeHtml(declaration.provider);
  const suppressions = declaration.suppress && declaration.suppress.length > 0
    ? [
      '<table><thead><tr><th>Check</th><th>URL pattern</th><th>Reason</th></tr></thead><tbody>',
      ...declaration.suppress.map((s) =>
        `<tr><td><code>${escapeHtml(s.check)}</code></td><td><code>${escapeHtml(s.url)}</code></td><td>${escapeHtml(s.reason)}</td></tr>`),
      '</tbody></table>',
    ].join('')
    : '<p>None.</p>';
  const findings = declaration.knownFindings && declaration.knownFindings.length > 0
    ? declaration.knownFindings.map(escapeHtml).join(', ')
    : 'None';

  const body = [
    `<p><a ${hrefAttr(indexHref)}>← All pathways</a></p>`,
    '<header>',
    `<h1>${escapeHtml(declaration.title)}</h1>`,
    '<dl>',
    `<dt>Id</dt><dd><code>${escapeHtml(declaration.id)}</code></dd>`,
    `<dt>Kind</dt><dd>${escapeHtml(declaration.kind)}</dd>`,
    `<dt>Area</dt><dd>${escapeHtml(declaration.area)}</dd>`,
    `<dt>Provider</dt><dd>${provider}</dd>`,
    `<dt>Payments mode</dt><dd>${modes || '—'}</dd>`,
    `<dt>Simulated</dt><dd>${mechanisms.size === 0 ? 'No' : [...mechanisms.values()].map(escapeHtml).join('; ')}</dd>`,
    declaration.isolated ? '<dt>Isolated</dt><dd>Runs after everything else</dd>' : '',
    `<dt>Known findings</dt><dd>${findings}</dd>`,
    `<dt>Not run</dt><dd>${notRun.length === 0 ? 'None' : notRun.map((v) => escapeHtml(VIEWPORT_LABEL[v])).join(', ')}</dd>`,
    '</dl>',
    '<h2>Suppressions</h2>',
    suppressions,
    '</header>',
    '<main>',
    ...ordered.map((record) => renderRecord(record, mediaHref)),
    '<section id="videos">',
    '<h2>Videos</h2>',
    renderVideos(ordered, mediaHref),
    '</section>',
    '</main>',
  ].join('\n');

  return page(declaration.title, body);
}
