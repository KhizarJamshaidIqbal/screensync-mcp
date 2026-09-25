// Runs every extension test (extension/test/*.test.js, then verify_unpacked.js), each in its own node process
// from the repo root as the tests expect, and exits non-zero if any fails. `npm run test:ext` in mcp-server
// calls it so the extension suite can gate a release instead of being run by hand.
//
//   node extension/test/run_all.js            # everything
//   node extension/test/run_all.js sse_ web_  # only tests whose file name contains one of the filters

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const filters = process.argv.slice(2);
const TIMEOUT_MS = 180_000;

const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !filters.length || filters.some((p) => f.includes(p)))
  .sort();
if (!filters.length) files.push('verify_unpacked.js');

const failed = [];
for (const f of files) {
  const file = relative(root, join(here, f));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS });
  const ms = Date.now() - t0;
  if (r.status === 0) {
    console.log(`ok   ${f} (${ms}ms)`);
    continue;
  }
  failed.push(f);
  console.log(`FAIL ${f} (${r.error ? r.error.message : `exit ${r.status}`}, ${ms}ms)`);
  process.stdout.write(`${r.stdout || ''}${r.stderr || ''}\n`);
}

console.log(`\n${files.length - failed.length}/${files.length} extension test files passed`);
if (failed.length) {
  console.log(`failed: ${failed.join(', ')}`);
  process.exit(1);
}
