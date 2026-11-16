#!/usr/bin/env node
/** Package the already-built planetary data for the versioned deployment release asset. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const data = join(root, 'data', 'build');
const output = join(root, 'data', 'work', 'jezero-data.tar.gz');

for (const required of [
  'regions/jezero/grid.json',
  'game/areas.json',
  'tiles/terrain/layer.json',
]) {
  if (!existsSync(join(data, required))) {
    throw new Error(
      `Missing data/build/${required}; build the planetary data before packaging it.`,
    );
  }
}

mkdirSync(join(root, 'data', 'work'), { recursive: true });
// Windows includes bsdtar; Linux and macOS provide tar. Archive paths are relative to data/build.
const result = spawnSync('tar', ['-czf', output, '-C', data, '.'], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`${output} (${(statSync(output).size / 1e6).toFixed(1)} MB)`);
