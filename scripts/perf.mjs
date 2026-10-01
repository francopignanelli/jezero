// Runs the Playwright performance probe (e2e/perf.spec.ts) with PERF=1, cross-platform.
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['playwright', 'test', 'e2e/perf.spec.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PERF: '1' },
});
process.exit(r.status ?? 1);
