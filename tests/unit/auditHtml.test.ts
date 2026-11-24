// Unit tests for tests/e2e/audit/core/html.ts (Req 33.1, 33.2, 33.4, 33.7).
import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  renderIndex,
  renderPathwayPage,
  safeHref,
  type ReportDeclaration,
  type ReportPathwayRecord,
  type ReportRun,
} from '../e2e/audit/core/html';

const EVIL = '<img src=x onerror="alert(1)">\'';

const declaration: ReportDeclaration = {
  id: 'cash-sale.pay',
  title: `Pay ${EVIL}`,
  area: 'cash-sale',
  kind: 'happy',
  provider: 'stripe',
  suppress: [{ check: 'cls', url: '/sales/.*', reason: 'known F21' }],
  knownFindings: ['F21'],
};

const record: ReportPathwayRecord = {
  declaration,
  viewport: 'desktop',
  runId: '2026-12-01T09-30-00Z-a1b2c3d',
  status: 'failed',
  retries: 0,
  steps: [
    {
      index: 2,
      name: 'Buyer pays',
      kind: 'action',
      members: ['buyer'],
      status: 'failed',
      durationMs: 1200,
      screenshots: [{ member: 'buyer', path: 'audit-artifacts/cash-sale.pay/desktop/r/step-02.buyer.png' }],
      observations: [{
        check: 'console', severity: 'blocking', member: 'buyer', url: '/sales/1',
        message: EVIL, source: 'automated',
      }],
      error: EVIL,
    },
    {
      index: 1,
      name: 'Webhook',
      kind: 'simulated',
      simulated: { mechanism: 'signed-fixture', reason: 'no carrier' },
      members: ['seller'],
      status: 'passed',
      durationMs: 10,
      screenshots: [],
      observations: [],
    },
  ],
  videos: [{ member: 'buyer', path: 'audit-artifacts/cash-sale.pay/desktop/r/video.buyer.0.webm', masked: true }],
  forced: [{ step: 2, locator: 'button', reason: 'overlay' }],
  tracePath: 'audit-artifacts/cash-sale.pay/desktop/r/trace.zip',
  paymentsMode: 'stripe-test',
  simulated: true,
};

const run: ReportRun = {
  manifest: {
    runId: '2026-12-01T09-30-00Z-a1b2c3d',
    startedAt: '2026-12-01T09:30:00Z',
    durationMs: 125_000,
    commit: 'abc123',
    schema: 'cardtrade_dev',
    servers: [{ name: 'main', port: 3100, paymentsMode: 'test' }],
  },
  totals: { passed: 0, failed: 1, flaky: 0, skipped: 0, 'not-run': 3 },
  pathways: [
    { id: 'cash-sale.pay', area: 'cash-sale', byViewport: { desktop: 'failed', phone: 'not-run' }, simulated: true, observationCount: 1 },
    { id: 'auth.sign-in', area: 'auth', byViewport: { desktop: 'not-run', phone: 'not-run' }, simulated: false, observationCount: 0 },
  ],
  coverage: [
    {
      entry: { id: 'cash-sale.pay', area: 'cash-sale', function: 'Pay', productSection: 'Cash sales', kind: 'automated', happy: ['cash-sale.pay'], refusal: [] },
      byViewport: { desktop: 'failing', phone: 'not-run' },
    },
    {
      entry: { id: 'auth.google', area: 'auth', function: 'Google OAuth', productSection: 'Auth', kind: 'out-of-scope', reason: 'Google blocks bots' },
      byViewport: { desktop: 'out-of-scope', phone: 'out-of-scope' },
    },
    {
      entry: { id: 'catalog.email', area: 'catalog', function: 'Email', productSection: 'Notifications and email', kind: 'manual', reason: 'SES', manualCheck: 'Read the inbox' },
      byViewport: { desktop: 'manual', phone: 'manual' },
    },
  ],
};

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(3)).toBe('3');
  });
});

describe('safeHref', () => {
  it('keeps relative paths and refuses schemes', () => {
    expect(safeHref('../media/a.png')).toBe('../media/a.png');
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref('java\tscript:alert(1)')).toBe('#');
    expect(safeHref('//evil.example/x')).toBe('#');
    expect(safeHref('https://example.com')).toBe('#');
  });
});

describe('renderIndex', () => {
  const html = renderIndex(run, { details: { 'cash-sale.pay': { title: EVIL, kind: 'happy', paymentsMode: { desktop: 'stripe-test' } } } });

  it('groups pathways by area with per-viewport status and filter attributes', () => {
    expect(html).toContain('data-area-group="cash-sale"');
    expect(html).toContain('data-area-group="auth"');
    expect(html).toContain('data-status-desktop="failed"');
    expect(html).toContain('data-status-phone="not-run"');
    expect(html).toContain('data-observations="yes"');
    expect(html).toContain('<form id="filters"');
    expect(html).toContain('<script src="data.js"></script>');
  });

  it('links only pathways that ran', () => {
    expect(html).toContain('href="pathways/cash-sale.pay.html"');
    expect(html).not.toContain('pathways/auth.sign-in.html');
  });

  it('shows the coverage map, manual checks and out-of-scope entries', () => {
    expect(html).toContain('data-coverage="cash-sale.pay"');
    expect(html).toContain('Read the inbox');
    expect(html).toContain('Google blocks bots');
    expect(html).toContain('2m 05s');
  });

  it('never emits an interpolated value raw', () => {
    expect(html).not.toContain(EVIL);
    expect(html).toContain(escapeHtml(EVIL));
  });
});

describe('renderPathwayPage', () => {
  const html = renderPathwayPage(declaration, [record]);

  it('shows steps in index order with screenshots, observations, forced interactions and trace', () => {
    expect(html.indexOf('1. Webhook')).toBeLessThan(html.indexOf('2. Buyer pays'));
    expect(html).toContain('src="../media/audit-artifacts/cash-sale.pay/desktop/r/step-02.buyer.png"');
    expect(html).toContain('data-check="console"');
    expect(html).toContain('overlay');
    expect(html).toContain('trace.zip');
    expect(html).toContain('signed-fixture (no carrier)');
    expect(html).toContain('<video controls');
    expect(html).toContain('known F21');
    expect(html).toMatch(/Not run<\/dt><dd>Phone/);
  });

  it('omits the trace link unless the pathway failed', () => {
    const passed = renderPathwayPage(declaration, [{ ...record, status: 'passed' }]);
    expect(passed).not.toContain('trace.zip');
  });

  it('never emits an interpolated value raw', () => {
    expect(html).not.toContain(EVIL);
  });
});
