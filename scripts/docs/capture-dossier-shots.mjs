// Screenshots of the planner and the rover game for the dossier (docs/dossier/img).
// Needs the dev server (`npm run dev`, port 5180) and the built data. Headless Chrome on the real
// GPU (ANGLE/D3D11), so the 3D scenes render as they do in a desktop browser.
//
//   node scripts/docs/capture-dossier-shots.mjs [only-these-names…]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:5180';
const OUT = resolve(import.meta.dirname, '../../docs/dossier/img');
mkdirSync(OUT, { recursive: true });
const only = new Set(process.argv.slice(2));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1.25,
  locale: 'en-US',
  reducedMotion: 'no-preference',
});
await context.addInitScript(() => {
  try {
    localStorage.setItem('copernico.welcomed', '1');
    localStorage.setItem('copernico.lang', 'en');
    localStorage.setItem('copernico.game.quality', 'high');
  } catch {
    /* ignore */
  }
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

async function shot(page, name, opts = {}) {
  const path = resolve(OUT, `${name}.jpg`);
  await page.screenshot({ path, type: 'jpeg', quality: 86, ...opts });
  console.log('  ✓', name);
}

async function step(name, fn) {
  if (only.size && !only.has(name)) return;
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  pageerror', name, String(e).slice(0, 200)));
  console.log('→', name);
  try {
    await fn(page);
  } catch (e) {
    failures++;
    console.log('  ✗', name, String(e).split('\n')[0]);
    await page
      .screenshot({ path: resolve(OUT, `_fail-${name}.jpg`), type: 'jpeg', quality: 60 })
      .catch(() => {});
  } finally {
    await page.close();
  }
}

async function openPlanner(page) {
  await page.goto(`${BASE}/planner.html`);
  await page.locator('.loading-screen').waitFor({ state: 'detached', timeout: 120_000 });
  await wait(2500);
}

async function enterJezero(page) {
  await page.getByRole('button', { name: 'Explore Jezero' }).click();
  await wait(9000);
}

async function guidedRoute(page) {
  await page.getByRole('tab', { name: 'Marswalk' }).click();
  await page.getByRole('button', { name: 'Load guided Marswalk' }).click();
  await page.getByRole('button', { name: 'Calculate routes' }).click();
  await page.locator('.metrics').first().waitFor({ timeout: 90_000 });
  await wait(7000);
}

async function toggleLayer(page, label) {
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await wait(500);
  await page.getByText(label, { exact: true }).first().click();
  await wait(400);
  await page
    .getByRole('button', { name: 'Close layers' })
    .click()
    .catch(() => page.keyboard.press('Escape'));
  await wait(4000);
}

// ---------------------------------------------------------------- home
await step('home', async (page) => {
  await page.goto(`${BASE}/`);
  await wait(2500);
  await shot(page, 'home');
});

// ---------------------------------------------------------------- planner
await step('planner-globe', async (page) => {
  await openPlanner(page);
  await wait(3000);
  await shot(page, 'planner-globe');
});

await step('planner-surface', async (page) => {
  await openPlanner(page);
  await enterJezero(page);
  await shot(page, 'planner-surface');
});

await step('planner-route', async (page) => {
  await openPlanner(page);
  await enterJezero(page);
  await guidedRoute(page);
  await shot(page, 'planner-route');
  // The plan review further down the panel: profile, EVA timeline, science stops.
  await page.getByRole('heading', { name: 'EVA timeline' }).scrollIntoViewIfNeeded();
  await wait(1500);
  await shot(page, 'planner-timeline');
  await toggleLayer(page, 'Slope classes');
  await shot(page, 'planner-slope');
});

await step('planner-crism', async (page) => {
  await openPlanner(page);
  await enterJezero(page);
  await toggleLayer(page, 'Mineral indicators (CRISM)');
  await shot(page, 'planner-crism');
});

await step('planner-panorama', async (page) => {
  await openPlanner(page);
  await page.getByRole('tab', { name: '360° views' }).click();
  await wait(800);
  await page.locator('.pano-card', { hasText: 'Three Forks' }).click();
  await page.locator('.pano-status').waitFor({ state: 'detached', timeout: 60_000 });
  await wait(2500);
  await shot(page, 'planner-panorama');
});

await step('planner-conditions', async (page) => {
  await openPlanner(page);
  await enterJezero(page);
  await page.getByRole('tab', { name: 'Conditions' }).click();
  await wait(2000);
  await shot(page, 'planner-conditions');
});

// ---------------------------------------------------------------- game
async function openGame(page) {
  await page.goto(`${BASE}/play.html`);
  await page.getByRole('heading', { name: 'Perseverance missions' }).waitFor({ timeout: 120_000 });
  await page.locator('.game-boot').waitFor({ state: 'detached', timeout: 120_000 });
  await wait(1500);
}

async function startMission(page, title, chapterName) {
  await page.getByRole('button', { name: `Start: ${title}` }).click();
  const chapter = page.getByRole('dialog', { name: chapterName });
  await chapter.waitFor({ timeout: 120_000 });
  await wait(1500);
  return chapter;
}

await step('game-menu', async (page) => {
  await openGame(page);
  await shot(page, 'game-menu');
});

await step('game-delta', async (page) => {
  await openGame(page);
  const chapter = await startMission(page, 'The delta front', 'Arrival at the delta front');
  await shot(page, 'game-chapter');
  await chapter.getByRole('button', { name: 'Start driving' }).click();
  await wait(6000);
  await shot(page, 'game-drive');
  await page.keyboard.press('KeyI');
  await wait(1500);
  await shot(page, 'game-inventory');
});

await step('game-rim', async (page) => {
  await openGame(page);
  const chapter = await startMission(page, 'The rim', /The climb|Witch Hazel/);
  await chapter.getByRole('button', { name: 'Start driving' }).click();
  await wait(7000);
  await shot(page, 'game-rim');
  // A rock is in the crosshair at the start: SuperCam's laser reads it.
  await page.keyboard.press('KeyF');
  await wait(6000);
  await shot(page, 'game-supercam');
});

await step('game-chute', async (page) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Start: Back to the chute' }).click();
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 120_000 });
  await wait(1500);
  await shot(page, 'game-chute-card');
  await dialog.getByRole('button').last().click();
  await wait(7000);
  await shot(page, 'game-chute');
});

await browser.close();
console.log(failures ? `${failures} step(s) failed` : 'all shots done');
process.exitCode = failures ? 1 : 0;
