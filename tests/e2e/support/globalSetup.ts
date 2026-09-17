// tests/e2e/support/globalSetup.ts
//
// Runs once before the whole suite (including the `setup` project's
// auth.setup.ts). Two jobs:
//   1. Heal whatever a crashed previous run left behind, by running the same
//      marker-based cleanup that globalTeardown runs after a clean run. This is
//      what makes cleanup self-healing without any "detect a stale run" logic.
//   2. Wipe artifact directories from the previous run so a failure you're
//      looking at is always from *this* run, not a stale one.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

export default async function globalSetup() {
  for (const dir of ['test-results', 'playwright-report']) {
    rmSync(path.join(repoRoot, dir), { recursive: true, force: true });
  }

  // Empty the visual-sweep capture dir once, before any worker starts. It is NOT in
  // the loop above because — unlike those two — its images are meant to survive a run
  // for review; we clear it only at the START of a fresh run. Doing this here rather
  // than in a spec `beforeAll` is deliberate: that hook runs once per worker, and the
  // desktop/mobile projects are separate workers, so an in-spec clear had them wiping
  // each other's PNGs and leaving only half the sweep on disk. `page.screenshot`
  // recreates the directory as it writes, so no mkdir is needed here.
  //
  // ONLY WHEN THIS RUN WILL ACTUALLY PRODUCE CAPTURES. `globalSetup` runs for EVERY
  // invocation, including `playwright test tests/e2e/specs/journeys.spec.ts`, so an
  // unconditional wipe here deleted a completed 106-image sweep the moment a single
  // unrelated spec was run — and the loss is silent, because the next thing anyone
  // does is look at the directory and find it missing rather than stale. A run with
  // no file filter is the whole suite and does include the sweep; a filtered run is
  // only allowed to clear if `screenshots` is one of the things it names.
  // AND ONLY THE PROJECTS THIS RUN WILL RE-CAPTURE. The sweep is normally driven one
  // project at a time (`--project=desktop`, then `--project=mobile`, because the two
  // together against one dev server take twice as long as either). A whole-directory
  // wipe therefore deleted the desktop half the moment the mobile half was started, so
  // the review set was never complete no matter how many times it was run. Capture
  // files are named `<surface>.<project>.{png,json}`, which is what makes this
  // selectable.
  const args = process.argv.slice(2);
  const filters = args.filter((arg) => !arg.startsWith('-'));
  const runsTheSweep =
    filters.length === 0 || filters.some((arg) => arg.includes('screenshots'));
  if (runsTheSweep) {
    const capturesDir = path.join(repoRoot, 'ux-review', 'captures');
    const projects = args
      .map((arg, index) =>
        arg === '--project' ? args[index + 1] : arg.startsWith('--project=') ? arg.slice(10) : null,
      )
      .filter((value): value is string => Boolean(value) && value !== 'setup');
    if (projects.length === 0) {
      rmSync(capturesDir, { recursive: true, force: true });
    } else if (existsSync(capturesDir)) {
      for (const entry of readdirSync(capturesDir, { withFileTypes: true }).filter((e) =>
        e.isFile(),
      )) {
        if (projects.some((project) => entry.name.includes(`.${project}.`))) {
          rmSync(path.join(capturesDir, entry.name), { force: true });
        }
      }
    }
  }

  execFileSync(
    'npx',
    ['tsx', '--env-file=.env.local', 'scripts/e2e/cleanup-test-data.ts'],
    { cwd: repoRoot, stdio: 'inherit', shell: true },
  );
}
