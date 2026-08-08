// scripts/e2e/kill-dev-server.mjs
//
// Playwright's `webServer` option owns starting/stopping the e2e dev server
// (port 3100) for a normal run. This script covers the crash case — Ctrl+C
// twice, an OOM kill, a forced process kill — where that teardown never gets
// to run and something is left bound to the port.
//
// Usage: npm run test:e2e:killserver

import { execSync } from 'node:child_process';

const PORT = 3100;

function killWindows() {
  const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8' }).trim();
  if (!out) return 0;

  const pids = new Set(
    out
      .split('\n')
      .map((line) => line.trim().split(/\s+/).pop())
      .filter(Boolean),
  );

  for (const pid of pids) {
    execSync(`taskkill /F /PID ${pid}`, { stdio: 'inherit' });
  }
  return pids.size;
}

function killPosix() {
  const out = execSync(`lsof -ti:${PORT} || true`, { encoding: 'utf8' }).trim();
  if (!out) return 0;

  const pids = out.split('\n').filter(Boolean);
  execSync(`kill -9 ${pids.join(' ')}`, { stdio: 'inherit' });
  return pids.length;
}

try {
  const killed = process.platform === 'win32' ? killWindows() : killPosix();
  console.log(killed > 0 ? `Killed ${killed} process(es) on port ${PORT}.` : `Nothing bound to port ${PORT}.`);
} catch (err) {
  // findstr/lsof exit non-zero when nothing matches — that's success, not failure.
  console.log(`Nothing bound to port ${PORT}.`);
}
