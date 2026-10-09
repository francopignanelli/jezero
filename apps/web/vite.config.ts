import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Cesium's prebuilt Workers/Assets/ThirdParty/Widgets, wherever npm workspaces hoisted the package. */
const CESIUM_BUILD = join(
  dirname(createRequire(import.meta.url).resolve('cesium/package.json')),
  'Build',
  'Cesium',
);
const CESIUM_DIRS = ['Workers', 'ThirdParty', 'Assets', 'Widgets'];
const CESIUM_BASE = 'cesium';
const DATA_DIR = resolve(import.meta.dirname, '../../data/build');

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.bin': 'application/octet-stream',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.terrain': 'application/vnd.quantized-mesh',
};

function serveDirectory(mount: string, root: string, cache: (file: string) => string): Plugin {
  return {
    name: `copernico-serve-${mount}`,
    configureServer(server) {
      server.middlewares.use(`/${mount}`, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        const file = normalize(join(root, rel));
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', cache(file));
        createReadStream(file).on('error', next).pipe(res);
      });
    },
  };
}

/** Copies Cesium's static runtime files next to the production bundle. */
function copyCesium(): Plugin {
  let outDir = 'dist';
  return {
    name: 'copernico-copy-cesium',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const dir of CESIUM_DIRS) {
        cpSync(join(CESIUM_BUILD, dir), join(outDir, CESIUM_BASE, dir), { recursive: true });
      }
    },
  };
}

// index.html's first-paint loader reads %VITE_DATA_BASE_URL%; default it so the placeholder is
// always defined (same default as src/config.ts).
process.env.VITE_DATA_BASE_URL ??= './data';

export default defineConfig({
  base: './',
  define: {
    CESIUM_BASE_URL: JSON.stringify(`./${CESIUM_BASE}`),
  },
  plugins: [
    react(),
    // Development only: pipeline output (data/build, gitignored) at /data; in production CloudFront
    // serves the same paths from S3 (VITE_DATA_BASE_URL). Tiles are immutable per build.
    serveDirectory('data', DATA_DIR, () => 'no-store'),
    serveDirectory(CESIUM_BASE, CESIUM_BUILD, () => 'max-age=86400'),
    copyCesium(),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
  server: { port: Number(process.env.PORT) || 5180 },
});
