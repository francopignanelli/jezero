#!/usr/bin/env node
/** Build the static app and include the planetary data required by Netlify's publish directory. */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = resolve(import.meta.dirname, '../..');
const dist = join(root, 'apps', 'web', 'dist');
const localData = resolve(root, process.env.JEZERO_DATA_DIR ?? 'data/build');
const dataVersion = process.env.VITE_DATA_VERSION ?? 'data-v1';
const siteUrl = process.env.DEPLOY_PRIME_URL || process.env.URL || process.env.VITE_SITE_URL || '';
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script with npm run build:netlify.');

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status ?? result.signal}).`);
}

function checkData(directory) {
  for (const required of [
    'regions/jezero/grid.json',
    'game/areas.json',
    'tiles/terrain/layer.json',
  ]) {
    if (!existsSync(join(directory, required))) {
      throw new Error(`Missing planetary data: ${join(directory, required)}`);
    }
  }
}

// Running npm's own JS entry point avoids shell quoting and works on Windows as well as Linux.
run(process.execPath, [npmCli, 'run', 'build'], {
  ...process.env,
  VITE_DATA_BASE_URL: './data',
  VITE_DATA_VERSION: dataVersion,
  VITE_SITE_URL: siteUrl.replace(/\/$/, ''),
});

if (existsSync(localData)) {
  checkData(localData);
  cpSync(localData, join(dist, 'data'), { recursive: true });
  console.log(`Included local planetary data from ${localData}.`);
} else {
  const work = join(root, 'data', 'work');
  mkdirSync(work, { recursive: true });
  const temp = mkdtempSync(join(work, 'netlify-data-'));
  // Verify the cleanup target stays directly inside the intended ignored working directory.
  if (dirname(realpathSync(temp)) !== realpathSync(work)) {
    throw new Error('Unexpected temporary data directory.');
  }
  try {
    const archive = join(temp, 'jezero-data.tar.gz');
    const url = `https://github.com/francopignanelli/jezero/releases/download/${encodeURIComponent(dataVersion)}/jezero-data.tar.gz`;
    console.log(`Downloading planetary data from release ${dataVersion}.`);
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) {
      throw new Error(
        `Data download failed (${response.status}); publish ${url} before deploying.`,
      );
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    const extracted = join(temp, 'data');
    mkdirSync(extracted);
    run('tar', ['-xzf', archive, '-C', extracted]);
    checkData(extracted);
    cpSync(extracted, join(dist, 'data'), { recursive: true });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

console.log(`Netlify publish directory is ready: ${dist}`);
