// tests/e2e/audit/core/findings.ts
//
// FINDINGS NUMBERING AND THE FINDINGS DRAFT for the e2e UX audit suite. Pure: no I/O,
// no Playwright, no `node:fs`, no network. The report generator reads
// `tests/e2e/FINDINGS.md` and the run's Pathway records, hands both in, and writes the
// returned markdown to `audit-report/findings-draft.md`.
//
// Requirements:
//   3.5  a defect the suite discovers is recorded in `tests/e2e/FINDINGS.md` using that
//        file's existing numbering and severity scale. The generator never edits
//        `FINDINGS.md` itself: it drafts entries numbered to continue the file, and a
//        maintainer moves the real defects across.
//
// The format copied from `FINDINGS.md`:
//
//   ## F<n> — <title> (severity <0–4>, <STATUS>)
//   **Symptom.** ...
//   **Cause.** ...
//   ---
//
// Severity is the file's 0–4 scale: 4 = the member cannot complete the task,
// 1 = cosmetic, 0 = a testing note. Drafted severities are PROPOSALS for the reviewer.

/** The file's severity scale. 4 = the member cannot complete the task, 1 = cosmetic, 0 = testing note. */
export type FindingSeverity = 0 | 1 | 2 | 3 | 4;

/** Status every drafted finding starts with. A reviewer changes it once triaged. */
export const DRAFT_STATUS = 'OPEN';

/**
 * A finding heading: exactly two `#`, then `F<n>`. `### F70 UPDATE` is a sub-heading of
 * an existing finding and does not claim a number, so three or more `#` never match.
 */
const FINDING_HEADING = /^##[ \t]+F(\d+)\b/gm;

/**
 * The number the next finding in `findingsMd` should take: one more than the largest
 * `## F<n>` heading present, in whatever order the headings appear, and 1 when the file
 * has none. Numbers are never reused, so a gap in the sequence is not filled.
 *
 * @param findingsMd the full text of `tests/e2e/FINDINGS.md` (LF or CRLF)
 */
export function nextFindingNumber(findingsMd: string): number {
  let largest = 0;
  for (const match of findingsMd.matchAll(FINDING_HEADING)) {
    const n = Number(match[1]);
    if (Number.isSafeInteger(n) && n > largest) largest = n;
  }
  return largest + 1;
}

/** The subset of a UX observation (design: `Observation`) a draft entry needs. */
export interface FindingObservation {
  check: string;
  severity: 'blocking' | 'advisory';
  member: string;
  /** Already scrubbed by the collector. */
  url: string;
  /** Already scrubbed by the collector. */
  message: string;
  /** Present when a declared suppression matched; suppressed observations are not drafted. */
  suppressedBy?: string;
}

/** The subset of a step record (design: `StepRecord`) a draft entry needs. */
export interface FindingStep {
  index: number;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  observations: FindingObservation[];
  /** Already scrubbed by the collector. */
  error?: string;
}

/**
 * The subset of a Pathway record (design: `PathwayRecord`) a draft entry needs. A full
 * `PathwayRecord` satisfies it structurally, so the generator can pass its results in
 * unchanged.
 */
export interface FindingPathway {
  declaration: {
    id: string;
    title: string;
    kind: 'happy' | 'refusal';
    knownFindings?: string[];
  };
  viewport: string;
  runId: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped';
  steps: FindingStep[];
  tracePath?: string;
}

/** One drafted entry before it is rendered, exposed so callers and tests can inspect it. */
export interface FindingEntry {
  number: number;
  title: string;
  severity: FindingSeverity;
  symptom: string;
  where: string[];
  knownFindings: string[];
}

/**
 * Proposed severity for a failed Pathway. A happy Pathway that fails means a member
 * could not complete the task (4); a refusal Pathway that fails means a refusal was
 * missing or wrong, which is serious but leaves the task itself intact (3).
 */
function pathwaySeverity(kind: 'happy' | 'refusal'): FindingSeverity {
  return kind === 'happy' ? 4 : 3;
}

/**
 * Proposed severity for a blocking observation. Overflow, skeletons, uncaught errors
 * and resized dialogs degrade the task without stopping it (2); copy problems mislead
 * the member about money or holds (3).
 */
function observationSeverity(check: string): FindingSeverity {
  return check.startsWith('copy-') || check === 'unmasked' ? 3 : 2;
}

/** Collapses whitespace and newlines so member-supplied text cannot break a heading. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Wraps a value as inline code, widening the fence when the value itself has backticks. */
function code(value: string): string {
  const text = oneLine(value);
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function locationLines(record: FindingPathway, step?: FindingStep): string[] {
  const lines = [
    `Pathway ${code(record.declaration.id)} (${record.declaration.kind}), viewport ${code(record.viewport)}, run ${code(record.runId)}.`,
  ];
  if (step) lines.push(`Step ${step.index}: ${oneLine(step.name)}.`);
  if (record.tracePath) lines.push(`Trace: ${code(record.tracePath)}.`);
  return lines;
}

/**
 * Builds the draft entries for a run: one per failed Pathway and one per distinct
 * unsuppressed blocking observation, numbered consecutively from
 * `nextFindingNumber(findingsMd)` in input order. Passed, flaky and skipped Pathways
 * contribute only their blocking observations. Advisory and suppressed observations are
 * never drafted.
 *
 * @param findingsMd the current text of `tests/e2e/FINDINGS.md`
 * @param records the run's Pathway records, in report order
 */
export function findingEntries(findingsMd: string, records: readonly FindingPathway[]): FindingEntry[] {
  const entries: FindingEntry[] = [];
  let number = nextFindingNumber(findingsMd);

  for (const record of records) {
    const known = [...(record.declaration.knownFindings ?? [])];

    if (record.status === 'failed') {
      const failedStep = record.steps.find((s) => s.status === 'failed');
      entries.push({
        number: number++,
        title: `${oneLine(record.declaration.title)} fails on ${oneLine(record.viewport)}`,
        severity: pathwaySeverity(record.declaration.kind),
        symptom: failedStep
          ? `The Pathway failed at step ${failedStep.index}, "${oneLine(failedStep.name)}"${
            failedStep.error ? `: ${oneLine(failedStep.error)}` : '.'
          }`
          : 'The Pathway failed before any step recorded a failure.',
        where: locationLines(record, failedStep),
        knownFindings: known,
      });
    }

    const seen = new Set<string>();
    for (const step of record.steps) {
      for (const obs of step.observations) {
        if (obs.severity !== 'blocking' || obs.suppressedBy !== undefined) continue;
        const key = [obs.check, obs.member, obs.url, obs.message].join('\u0000');
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          number: number++,
          title: `${oneLine(obs.check)} on ${oneLine(record.declaration.title)} (${oneLine(record.viewport)})`,
          severity: observationSeverity(obs.check),
          symptom: `${oneLine(obs.message)} Seen by ${code(obs.member)} at ${code(obs.url)}.`,
          where: locationLines(record, step),
          knownFindings: known,
        });
      }
    }
  }
  return entries;
}

function renderEntry(entry: FindingEntry): string {
  const lines = [
    `## F${entry.number} — ${entry.title} (severity ${entry.severity}, ${DRAFT_STATUS})`,
    `**Symptom.** ${entry.symptom}`,
    '**Cause.** Not yet investigated.',
    `**Where.** ${entry.where.join(' ')}`,
  ];
  if (entry.knownFindings.length > 0) {
    lines.push(`**Known findings on this Pathway.** ${entry.knownFindings.map(oneLine).join(', ')}. Check whether this is one of them before filing it.`);
  }
  return lines.join('\n');
}

/**
 * Renders `audit-report/findings-draft.md`: the drafted entries in `FINDINGS.md`'s own
 * heading, body and `---` separator format, numbered to continue that file. Returns a
 * draft with a "nothing to draft" note when the run produced no entries.
 *
 * @param findingsMd the current text of `tests/e2e/FINDINGS.md`
 * @param records the run's Pathway records, in report order
 */
export function findingDraft(findingsMd: string, records: readonly FindingPathway[]): string {
  const entries = findingEntries(findingsMd, records);
  const header = [
    '# E2E findings draft',
    'Drafted by the audit report from failed Pathways and blocking observations. Review',
    'each entry, move real defects into `tests/e2e/FINDINGS.md` with a cause, fix and',
    'guard, and renumber if that file gained entries since this run. Severities are',
    'proposals on the file\'s 0–4 scale: 4 = the user cannot complete the task, 1 = cosmetic.',
    '---',
  ].join('\n');
  if (entries.length === 0) return `${header}\nNothing to draft: no Pathway failed and no blocking observation was recorded.\n`;
  return `${header}\n${entries.map(renderEntry).join('\n---\n')}\n`;
}
