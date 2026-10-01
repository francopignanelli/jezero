import { expect, test } from '@playwright/test';
import { computeGuided, openApp } from './helpers';

/**
 * Performance probe (run with `npm run test:perf`): cold reveal time per loading step, frame cost on
 * the globe and in Jezero, and route compute time. Prints a JSON line for docs/performance.md.
 * Uses the machine's GPU (not SwiftShader) so numbers reflect real rendering.
 */
test.use({
  launchOptions: {
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  },
});

test('@perf probe', async ({ page }) => {
  test.skip(!process.env.PERF, 'set PERF=1 to run');
  await page.addInitScript(() => {
    const w = window as unknown as { __marks: Record<string, number> };
    w.__marks = {};
    const poll = () => {
      const S = (
        window as unknown as {
          __copernicoStore?: {
            getState(): { loading: Record<string, string>; sceneReady: boolean };
          };
        }
      ).__copernicoStore;
      if (S) {
        const st = S.getState();
        for (const [k, v] of Object.entries(st.loading))
          if (v !== 'pending') w.__marks[`${k}:${v}`] ??= Math.round(performance.now());
        if (st.sceneReady) w.__marks.ready ??= Math.round(performance.now());
      }
      if (!w.__marks.ready || !w.__marks['sky:hd']) setTimeout(poll, 50);
    };
    poll();
  });
  await openApp(page);
  await page.waitForTimeout(5000);
  const load = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const gl = document.createElement('canvas').getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      marks: (window as unknown as { __marks: Record<string, number> }).__marks,
      requests: res.length,
      transferMB: +(
        res.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0) / 1e6
      ).toFixed(1),
      renderer: dbg && gl ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      viewport: [innerWidth, innerHeight, devicePixelRatio],
    };
  });

  // Frame cost: synchronous render + gl.finish while the camera moves (upper bound on frame rate).
  const frameCost = (rotate: number) =>
    page.evaluate(async (step) => {
      const sc = (
        window as unknown as {
          __copernico: {
            widget: {
              render(): void;
              camera: { rotateRight(a: number): void };
              scene: { context: { _gl: WebGL2RenderingContext } };
            };
          };
        }
      ).__copernico;
      const gl = sc.widget.scene.context._gl;
      const t: number[] = [];
      for (let i = 0; i < 120; i++) {
        sc.widget.camera.rotateRight(step);
        const a = performance.now();
        sc.widget.render();
        gl.finish();
        t.push(performance.now() - a);
        if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      t.sort((x, y) => x - y);
      const mean = t.reduce((x, y) => x + y, 0) / t.length;
      return { meanMs: +mean.toFixed(1), p95Ms: +t[Math.floor(t.length * 0.95)]!.toFixed(1) };
    }, rotate);
  const globe = await frameCost(0.01);

  await computeGuided(page);
  await page.waitForTimeout(4000);
  const terrain = await frameCost(0.0005);
  const computeMs: number[] = [];
  for (let i = 0; i < 10; i++) {
    computeMs.push(
      await page.evaluate(async () => {
        const S = (
          window as unknown as {
            __copernicoStore: {
              getState(): { setResult(r: null): void; result: unknown; computeMs: number };
            };
          }
        ).__copernicoStore;
        S.getState().setResult(null);
        [...document.querySelectorAll('button')]
          .find((b) => b.textContent?.trim() === 'Calculate routes')!
          .click();
        for (let n = 0; n < 200 && !S.getState().result; n++)
          await new Promise((r) => setTimeout(r, 25));
        return Math.round(S.getState().computeMs);
      }),
    );
  }
  computeMs.sort((a, b) => a - b);
  const report = {
    ...load,
    globe,
    terrain,
    routeComputeMs: { median: computeMs[5], p95: computeMs[9], all: computeMs },
  };
  // eslint-disable-next-line no-console -- the probe's output is this report line
  console.log(`PERF ${JSON.stringify(report)}`);
  expect(load.marks.ready).toBeLessThan(30_000);
});
