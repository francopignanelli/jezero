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
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt',
};

function serveDirectory(mount: string, root: string, cache: (file: string) => string): Plugin {
  return {
    name: `copernico-serve-${mount}`,
    configureServer(server) {
      server.middlewares.use(`/${mount}`, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        const file = normalize(join(root, rel));
        const stat = file.startsWith(root) && existsSync(file) ? statSync(file) : null;
        if (!stat?.isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        // Revalidated on every use, answered 304 while unchanged: reloads reuse the browser cache,
        // and a rebuilt file (new size or time) is fetched again.
        const etag = `W/"${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', cache(file));
        if (req.headers['if-none-match'] === etag) {
          res.statusCode = 304;
          res.end();
          return;
        }
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        // Byte ranges (as S3/CloudFront serve them in production): a video can only be sought, and
        // starts playing before it has all downloaded, when the server answers them.
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (range && (range[1] || range[2])) {
          const end = range[2] && range[1] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
          const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
          if (start > end || start >= stat.size) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${stat.size}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', String(end - start + 1));
          createReadStream(file, { start, end }).on('error', next).pipe(res);
          return;
        }
        res.setHeader('Content-Length', String(stat.size));
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
    serveDirectory('data', DATA_DIR, () => 'no-cache'),
    serveDirectory(CESIUM_BASE, CESIUM_BUILD, () => 'max-age=86400'),
    copyCesium(),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    // Two pages: the planner and the rover game. Shared code (Cesium, the scene, data loaders) lands
    // in shared chunks, so each page downloads only its own code and the browser caches the rest once.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        play: resolve(import.meta.dirname, 'play.html'),
      },
    },
  },
  server: { port: Number(process.env.PORT) || 5180 },
});
