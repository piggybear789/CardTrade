// design/compare/build.mjs
//
// Builds design/compare/index.html: every surface, the REAL page beside the MOCKUP
// frame it was drawn for, with what the browser reported while rendering it and what
// the comparison actually showed.
//
//   node design/compare/shoot-board.mjs
//   node design/compare/shoot-app.mjs
//   node design/compare/build.mjs
//
// WHY THIS REPLACES THE BOARD AS THE THING TO REVIEW. The board is hand-written markup
// that re-states what the components do; it drifts from the app the moment either side
// changes, and it did. The left column here is the app itself, so it cannot drift —
// re-run the shooter and it is current by construction. The board stays on the right as
// the PROPOSAL, which is the only thing it was ever able to be.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { SURFACES, VIEWPORTS } from './surfaces.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, '_shots');

const app = JSON.parse(readFileSync(join(shots, 'app.json'), 'utf8'));
const board = existsSync(join(shots, 'board.json'))
  ? JSON.parse(readFileSync(join(shots, 'board.json'), 'utf8'))
  : [];

const appBy = new Map(app.map((r) => [`${r.id}:${r.viewport}`, r]));
const boardBy = new Map(board.map((r) => [`${r.surface}:${r.viewport}`, r]));

/**
 * What the comparison showed, per surface. Written by reading the screenshots, not
 * generated — a diff of pixels cannot tell you that a column header is pointing at the
 * wrong number.
 *
 * `fixed` is a defect found in this pass and repaired in it. `open` is a real difference
 * that has NOT been changed, either because it needs a decision or because it is the
 * board that is wrong. `intent` is a deliberate divergence from the board with the
 * reasoning recorded in the code.
 */
const NOTES = {
  catalog: {
    fixed: [
      'Prices rendered in violet (`text-iris-ink`). The pastel retune moved money to ink and the change reached the board but never `ItemCard.tsx`, so the app and the board disagreed about the most repeated element in the product.',
      'The price histogram overhung the slider by 8px at each end. Radix positions a thumb by its CENTRE, so the value range is inset half a thumb from the control edge; the histogram was inset 4px against a 24px thumb. Measured on the live page, now inset to match.',
    ],
    open: [
      'Every seeded tile shares one photo, so the grid reads more uniform than a real catalog would. That is the demo data, not the app.',
    ],
  },
  listing: { intent: ['Filmstrip under the desktop frame and a scroll-snap carousel on the phone, replacing the stacked cards. The inline map is gone in favour of the meta line, and the fee line sits under the price.'] },
  mine: {
    fixed: [
      'HYDRATION FAILURE. `Badge` renders a `<div>` and it was inside a `<p>`, which is invalid HTML — the parser closed the paragraph early, the server and client trees disagreed and React re-rendered the whole table on the client. Invisible in a screenshot; only the console said so.',
      'Columns did not line up across rows, which is the one thing this table exists to do. The actions track was `auto`, and since every row is its own grid it sized to that row\'s own content — "Edit" on a live listing, "View" on a sold one — so price, watching and status each landed at a different x depending on which button the row carried. The header, whose actions cell is empty, aligned with neither. Now a fixed 4.5rem.',
    ],
  },
  seller: {
    fixed: [
      'The trust band\'s two groups used `auto-fit`, so the provider group became three columns and the record group two: "Completed sales" sat under "Verified name" and "Trades in" aligned with nothing. Both groups now declare the same three tracks.',
    ],
    open: [
      'Watch hearts are absent here because Alice is viewing her OWN profile, which is correct. The catalog shot confirms they appear on other members\' items.',
    ],
  },
  sales: {
    fixed: [
      'On the phone the status badge sat in an `auto` track on the title row, so a long label ("Funds confirmed") stole more width than a short one ("Inspection") and titles truncated at different points down the list. The badge now sits in the content block below `md` and the title gets the full width.',
    ],
    intent: [
      'The next-step column states the move, not the state, in the derivation\'s own words from `domain/contract`. No second status-to-copy table exists. Whose move it is survives as tone only — an amber marker and full contrast when it is yours — because the sentences already name their actor.',
      'Four filter chips with counts. Active stays the default: landing on "Needs you" would show an empty page to someone whose contracts are all with the other party.',
    ],
  },
  purchases: { intent: ['Same component as Sales, viewed from the buyer\'s side, so the step sentences change voice and the counterparty reads "from" rather than "to".'] },
  trades: { intent: ['Trade rows carry the two sides, the counterparty and the cash-to-even, on the same grid as the cash lists so the three surfaces align with each other as well as with themselves.'] },
  offers: {
    fixed: [
      '"Accepting this declines the other 2 offers" printed on every acceptable row, so one listing with three live offers said the same sentence three times about the same three offers. It is a property of the group and is now stated once in the group header.',
      'Rows within a listing were ordered by recency, so $760, $695 and $720 appeared in that order and a seller had to read all three to find the top bid. Live offers now sort highest-first, with decided ones below whatever the amount.',
      'The counter chain put the actor after the amount — "$700.00 them → $800.00 you" — where each label sits between two numbers and belongs to neither. Actor first.',
    ],
    intent: ['Grouped by listing, with the chain walked from `parent_offer_id` and superseded amounts struck through.'],
  },
  payouts: {
    fixed: [
      'The gross/fee/net table labelled its first column "PRICE" while showing `amount_cents` — the agreed price plus fee plus shipping. A $56.00 card read as a $58.80 price and the seller\'s own agreed figure appeared nowhere. Now "Buyer paid".',
      'The "Owed to you" figure turned violet when a release was blocked, putting a third colour on one fact: violet figure, grey caption saying part of it is held up, red banner below saying the same thing with the amount. The banner carries it; the figure is ink.',
    ],
    open: [
      'A `SELLER_PAYOUT_QUEUED` entry stays under Active even after the matching `SELLER_PAYOUT_SETTLED` exists, so a payout sent 19 days ago still reads "is queued for release". Pre-existing in `payoutReadModel`; not changed here because it is money logic covered by property tests this environment cannot run.',
    ],
    intent: ['Four balances rather than the board\'s KPI tile row — the existing file records why tiles were rejected (three cards were ~700px on a phone and pushed the dashboard below the fold). The fourth state, "Paid out", was the genuinely missing one.'],
  },
  notifications: {
    intent: [
      'Grouped by AGE, not calendar day: a calendar boundary needs a timezone the server does not have, so "Today" would be struck in UTC and wrong for a third of every day in Australia.',
      'No needs-action block. A notification row carries `{type,title,body,link}` — no actionable flag, no deadline — so the block could only be built by guessing from title text. The question is answered where it is derived: the contract action card and the next-step column.',
    ],
  },
  inbox: { intent: ['A contract badge per row, rendered through the shared `CashSaleStatusBadge` so a thread cannot describe a sale differently from the contract room. Mobile rows are centred: the three-line text column is taller than the avatar and thumbnail beside it, and top-aligning left both squares riding high.'] },
  queue: { intent: ['The ordering rule is published on the queue itself, and each row says which of the four escalations put it there. `priorityOf` now derives from that reason, so a CRITICAL badge beside "waiting its turn" is impossible.'] },
  verification: {
    fixed: [
      'The completed state put the bare string "Alice Nguyen" in the slot where a STATUS belongs, and "Active" beside Payouts — so the two facts worth having, what was checked and when, appeared nowhere. Each row now carries a `Verified` / `Active` badge and the evidence underneath: "Alice Nguyen · photo ID and selfie checked 10 Sept 2026". `getIdentitySummary` had been returning `verifiedAt` all along and this page was discarding it.',
      'The payout row said "Active", which answers a question nobody asks. It now states the thing members actually hesitate over — "Stripe collects your bank details directly. NoDitto never sees them."',
      'The intro read "Both checks are complete. There is nothing else to do here", leaving someone who had just passed two different checks with no idea why there were two. It now names the split and the provider.',
      'MAPPING BUG IN THIS CANVAS, not in the app: this route was paired against the board\'s `#identity` DESKTOP frame, which draws the onboarding wizard\'s seller step rather than the settings tab. Two different surfaces were being compared as if they should match. Now pinned to the phone frame, which is the one labelled "verification tab, as built".',
    ],
    open: [
      'The INCOMPLETE state is `UnifiedOnboardingSurface`, the spine shared with the signup wizard, and it is not shot here because every seeded member is already verified and payable. Its copy still states a rationale ("We verify your identity to block known fraudsters") where the board states evidence, and an instruction ("Add your payout details to receive your funds") where the board states the privacy fact. Left alone deliberately: it is a shared spine and changing it blind — with no way to see the state it renders — is how the stylesheet got broken earlier in this session.',
    ],
  },
  create: { intent: ['Unchanged.'] },
  signin: { intent: ['Unchanged.'] },
  signup: { intent: ['Unchanged.'] },
  recover: { intent: ['Unchanged.'] },
  profile: { intent: ['Unchanged apart from the tab strip, which now comes from the shared `TabbedPanels`.'] },
  admin: { intent: ['Custody reconciliation already led the payouts tab and the resolution actions already stated per-outcome consequences, so both board asks were verified rather than redone.'] },
  cashroom: {
    fixed: [
      'The deadline banner named the actual deadline instant to the party who must ACT and withheld it from the one who is waiting — who got "You have already acted." and no date at all. "When does this resolve?" is exactly the waiting party\'s question, and a heading reading "4 days left" rounds the answer rather than giving it. Both branches now name it: "Nothing is needed from you until Fri, 18 Sept, 7:27 am."',
      '"You have already acted" was also untrue for a cash-sale SELLER. Inspection is the buyer\'s step; the seller never had an action in it to have already taken.',
      'The room passed no status badge to `ContractHeader`, even though the slot has always existed and `TradeContract` has always filled it. So a cash contract\'s own state — what thirteen statuses exist to express — was missing from the strip whose job is to say what the contract is, and the two rooms disagreed. Now `CashSaleStatusBadge`, the same map the Sales list and the inbox use.',
    ],
    intent: [
      'The board also puts a live countdown inside the action dock ("You have 2 days 6 hours"). Not copied: the banner directly above it now carries the deadline, and repeating it two inches lower is the duplication the dock was trimmed to remove.',
      'The board shows an always-on "Live" chip. `ContractHeader` deliberately renders the connection indicator only when the socket is degraded — a healthy socket is not news — which is the better rule, so the board is what is wrong here.',
    ],
  },
  dispute: { intent: ['Layout kept. Inherits the banner and header-badge fixes above.'] },
  traderoom: { intent: ['Layout kept. Already passed both a `StateBadge` and the connection status — it was the cash room that was missing them.'] },
  thread: { intent: ['Layout kept.'] },
  help: { intent: ['Unchanged.'] },
  terms: { intent: ['Unchanged.'] },
  saved: { intent: ['Unchanged.'] },
};

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Inline `code` spans in a note, so column names read as column names. */
const md = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

function flagList(record) {
  if (!record) return '<span class="flag miss">not shot</span>';
  const flags = [];
  if (!record.ok) flags.push('<span class="flag bad">load failed</span>');
  if (record.redirected)
    flags.push(`<span class="flag bad">redirected → ${esc(record.landedOn)}</span>`);
  if (record.pageErrors?.length)
    flags.push(`<span class="flag bad">${record.pageErrors.length} page error</span>`);
  if (record.consoleErrors?.length)
    flags.push(`<span class="flag warn">${record.consoleErrors.length} console error</span>`);
  if (record.overflowX > 1)
    flags.push(`<span class="flag warn">overflow-x ${record.overflowX}px</span>`);
  if (!flags.length) flags.push('<span class="flag ok">clean</span>');
  return flags.join(' ');
}

function noteBlock(id) {
  const n = NOTES[id];
  if (!n) return '';
  const section = (kind, label, items) =>
    items?.length
      ? `<div class="notes ${kind}"><b>${label}</b><ul>${items
          .map((t) => `<li>${md(t)}</li>`)
          .join('')}</ul></div>`
      : '';
  return (
    section('fixed', 'Found and fixed in this pass', n.fixed) +
    section('open', 'Still open', n.open) +
    section('intent', 'Deliberate divergence from the board', n.intent)
  );
}

const rows = [];
for (const surface of SURFACES) {
  for (const vp of VIEWPORTS) {
    const a = appBy.get(`${surface.id}:${vp.key}`);
    const b = boardBy.get(`${surface.id}:${vp.key}`);
    if (!a && !b) continue;
    rows.push({ surface, vp, a, b });
  }
}

const totals = {
  shots: app.length,
  pageErrors: app.reduce((n, r) => n + (r.pageErrors?.length ?? 0), 0),
  redirects: app.filter((r) => r.redirected).length,
  failed: app.filter((r) => !r.ok).length,
  fixed: Object.values(NOTES).reduce((n, v) => n + (v.fixed?.length ?? 0), 0),
  open: Object.values(NOTES).reduce((n, v) => n + (v.open?.length ?? 0), 0),
  noBoard: SURFACES.filter((s) => !s.board).length,
};

const body = rows
  .map(({ surface, vp, a, b }) => {
    const appImg = a?.file
      ? `<a href="_shots/app/${a.file}" target="_blank"><img src="_shots/app/${a.file}" alt="${esc(surface.label)} in the app"></a>`
      : '<div class="none">no app shot</div>';
    const boardImg = b?.file
      ? `<a href="_shots/board/${b.file}" target="_blank"><img src="_shots/board/${b.file}" alt="${esc(surface.label)} on the board"></a>`
      : `<div class="none">the board never drew this${surface.board ? ' frame' : ''}</div>`;
    return `
  <section class="pair" id="${esc(surface.id)}-${vp.key}">
    <header>
      <h2>${esc(surface.label)} <span class="vp">${vp.key} · ${vp.width}px</span></h2>
      <p class="meta">
        <code>${esc(surface.url)}</code>
        <span class="as">as ${esc(a?.as ?? surface.as ?? 'signed out')}</span>
        ${flagList(a)}
      </p>
    </header>
    <div class="cols">
      <figure><figcaption>App — real components, real data</figcaption>${appImg}</figure>
      <figure><figcaption>Board — the proposal${b?.label ? ` · ${esc(b.label)}` : ''}</figcaption>${boardImg}</figure>
    </div>
    ${
      a?.pageErrors?.length || a?.consoleErrors?.length
        ? `<pre class="errs">${esc([...(a.pageErrors ?? []), ...(a.consoleErrors ?? [])].join('\n').slice(0, 1400))}</pre>`
        : ''
    }
    ${noteBlock(surface.id)}
  </section>`;
  })
  .join('\n');

const nav = SURFACES.map(
  (s) => `<a href="#${esc(s.id)}-desktop">${esc(s.label)}</a>`,
).join('');

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>App vs board — NoDitto</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="../mockups/board.css">
<style>
  /* The board's tokens, its own layout ignored: this page is a comparison sheet, not
     another mockup, so it borrows the palette and nothing else. */
  body { margin:0; padding:2rem clamp(1rem,3vw,3rem) 6rem; background:hsl(var(--background));
         color:hsl(var(--foreground)); font-family:var(--font-sans,system-ui,sans-serif); }
  h1 { font-size:1.6rem; margin:0 0 .35rem; letter-spacing:-.02em; }
  .lede { max-width:70ch; color:hsl(var(--muted-foreground)); line-height:1.55; margin:0 0 1.5rem; }
  .lede + .lede { margin-top:-1rem; }
  .summary { display:flex; flex-wrap:wrap; gap:.5rem; margin:0 0 2rem; }
  .summary div { border:1px solid hsl(var(--border)); background:hsl(var(--card));
                 border-radius:.5rem; padding:.5rem .75rem; min-width:7.5rem; }
  .summary dt { font-size:.7rem; text-transform:uppercase; letter-spacing:.05em;
                color:hsl(var(--muted-foreground)); }
  .summary dd { margin:.15rem 0 0; font-size:1.25rem; font-weight:700; font-variant-numeric:tabular-nums; }
  nav { display:flex; flex-wrap:wrap; gap:.3rem; margin:0 0 2.5rem; }
  nav a { font-size:.75rem; padding:.25rem .5rem; border:1px solid hsl(var(--border));
          border-radius:999px; text-decoration:none; color:hsl(var(--muted-foreground));
          background:hsl(var(--card)); }
  nav a:hover { color:hsl(var(--foreground)); border-color:hsl(var(--iris)); }
  .pair { border-top:1px solid hsl(var(--border)); padding:1.75rem 0 0; margin:0 0 2.25rem; }
  .pair h2 { font-size:1.05rem; margin:0 0 .3rem; letter-spacing:-.01em; }
  .vp { font-weight:400; font-size:.8rem; color:hsl(var(--muted-foreground)); }
  .meta { margin:0 0 1rem; font-size:.75rem; display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; }
  .meta code { background:hsl(var(--muted)); padding:.1rem .35rem; border-radius:.25rem; }
  .as { color:hsl(var(--muted-foreground)); }
  .flag { padding:.1rem .4rem; border-radius:999px; font-size:.7rem; font-weight:600; }
  .flag.ok { background:hsl(var(--trust)/.12); color:hsl(var(--trust)); }
  .flag.warn { background:hsl(var(--action)); color:hsl(var(--action-foreground)); }
  .flag.bad { background:hsl(var(--destructive)/.12); color:hsl(var(--destructive)); }
  .flag.miss { background:hsl(var(--muted)); color:hsl(var(--muted-foreground)); }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:1rem; align-items:start; }
  @media (max-width:900px){ .cols { grid-template-columns:1fr; } }
  figure { margin:0; }
  figcaption { font-size:.7rem; text-transform:uppercase; letter-spacing:.05em;
               color:hsl(var(--muted-foreground)); margin:0 0 .4rem; }
  figure img { width:100%; height:auto; display:block; border:1px solid hsl(var(--border));
               border-radius:.5rem; background:hsl(var(--card)); }
  .none { border:1px dashed hsl(var(--border)); border-radius:.5rem; padding:2rem 1rem;
          text-align:center; font-size:.8rem; color:hsl(var(--muted-foreground)); }
  .errs { margin:1rem 0 0; padding:.75rem; border-radius:.5rem; overflow-x:auto;
          background:hsl(var(--destructive)/.07); border:1px solid hsl(var(--destructive)/.3);
          color:hsl(var(--destructive)); font-size:.72rem; line-height:1.5; white-space:pre-wrap; }
  .notes { margin:1rem 0 0; padding:.75rem .9rem; border-radius:.5rem; font-size:.82rem; line-height:1.55;
           border:1px solid hsl(var(--border)); background:hsl(var(--card)); }
  .notes b { display:block; font-size:.7rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.35rem; }
  .notes ul { margin:0; padding-left:1.1rem; }
  .notes li + li { margin-top:.35rem; }
  .notes code { background:hsl(var(--muted)); padding:.05rem .3rem; border-radius:.25rem; font-size:.95em; }
  .notes.fixed { border-left:3px solid hsl(var(--trust)); }
  .notes.fixed b { color:hsl(var(--trust)); }
  .notes.open { border-left:3px solid hsl(var(--action-border)); }
  .notes.open b { color:hsl(var(--action-border)); }
  .notes.intent { border-left:3px solid hsl(var(--iris)); }
  .notes.intent b { color:hsl(var(--iris-ink)); }
</style>

<h1>App vs board</h1>
<p class="lede">The left column is the running app, screenshotted through Playwright against a
seeded demo world — real components, real palette, real data, at 1440px and 390px. The right
column is the hand-drawn board, which is the <em>proposal</em> and nothing more: it re-states
what the components do in separate markup, so it drifts the moment either side changes.
Where they disagree, the note under the pair says which one is wrong.</p>
<p class="lede">Every seeded row is tagged <code>[E2E]</code>. <code>npm run test:e2e:clean</code>
removes the whole demo world.</p>

<div class="summary">
  <div><dt>App shots</dt><dd>${totals.shots}</dd></div>
  <div><dt>Load failures</dt><dd>${totals.failed}</dd></div>
  <div><dt>Page errors</dt><dd>${totals.pageErrors}</dd></div>
  <div><dt>Gate redirects</dt><dd>${totals.redirects}</dd></div>
  <div><dt>Defects fixed</dt><dd>${totals.fixed}</dd></div>
  <div><dt>Still open</dt><dd>${totals.open}</dd></div>
  <div><dt>Not on the board</dt><dd>${totals.noBoard}</dd></div>
</div>

<nav>${nav}</nav>

${body}
</html>
`;

writeFileSync(join(here, 'index.html'), html);
console.log(
  `design/compare/index.html — ${rows.length} pairs, ${totals.fixed} fixed, ${totals.open} open`,
);
