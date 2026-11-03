import { expect, test, type Page } from '@playwright/test';
import { openApp, trackExternalRequests } from './helpers';

/** Development test hook of the game page (src/game/session.ts). */
interface GameHook {
  state: { odometerM: number; lat: number; lon: number; batteryPct: number };
  teleport(lat: number, lon: number): void;
}
const game = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __copernicoGame: GameHook }).__copernicoGame.state;
    return { odometerM: s.odometerM, batteryPct: s.batteryPct };
  });

test('the planner links to the rover game from the Mars tab and the Perseverance card', async ({
  page,
}) => {
  await openApp(page);
  await expect(page.getByRole('link', { name: /Drive Perseverance/ })).toHaveAttribute(
    'href',
    './play.html',
  );
  await page.getByRole('tab', { name: 'Surface' }).click();
  await expect(page.getByRole('link', { name: 'Drive it (game)' })).toHaveAttribute(
    'href',
    './play.html',
  );
});

test('rover game: drive in the 3D Jezero, core a sample, read its card, pause', async ({
  page,
}) => {
  test.slow(); // software WebGL in headless Chrome renders the 3D world at a few frames per second
  const external = trackExternalRequests(page);
  // Low graphics: the same world, cheaper to draw in software.
  await page.addInitScript(() => localStorage.setItem('copernico.game.quality', 'low'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/play.html');
  await expect(page.getByRole('heading', { name: 'Jezero Sample Run' })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.locator('.game-boot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start' }).first().click();
  await expect(page.locator('.game-objectives')).toContainText('Roubion', { timeout: 60_000 });

  // W drives forward.
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => (await game(page)).odometerM, { timeout: 20_000 })
    .toBeGreaterThan(3);
  await page.keyboard.up('KeyW');

  // Next to the Ha'ahóni + Atsá site (samples 8 & 9), stopped: one press of Space cores it
  // (arm down, drill, arm up).
  await page.evaluate(() =>
    (window as unknown as { __copernicoGame: GameHook }).__copernicoGame.teleport(
      18.443864 - 6 / 59_274,
      77.452422,
    ),
  );
  await expect(page.locator('.game-prompt')).toContainText('Press Space to core', {
    timeout: 30_000,
  });
  await page.keyboard.press('Space');
  await expect(page.locator('.game-prompt')).toContainText('Coring', { timeout: 30_000 });
  const card = page.getByRole('dialog', { name: "Ha'ahóni + Atsá" });
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText('Samples 8 & 9');
  await expect(card).toContainText('Igneous rock');
  await expect(card.locator('img')).toHaveJSProperty('complete', true);
  await card.getByRole('button', { name: 'Continue driving' }).click();
  await expect(page.locator('.game-objectives li.is-done')).toHaveCount(1);

  // Esc pauses; Resume returns to driving.
  await page.keyboard.press('Escape');
  const pause = page.getByRole('dialog', { name: 'Paused' });
  await expect(pause).toBeVisible();
  await pause.getByRole('button', { name: 'Resume' }).click();
  await expect(pause).toHaveCount(0);

  // P opens photo mode (the HUD hides, a camera filter can be picked); Esc returns to driving.
  await page.keyboard.press('KeyP');
  const photo = page.getByRole('dialog', { name: 'Photo mode' });
  await expect(photo).toBeVisible();
  await expect(page.locator('.game-hud')).toHaveCount(0);
  await photo.getByRole('radio', { name: 'Navcam' }).click();
  await expect(photo.getByRole('radio', { name: 'Navcam' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(photo).toHaveCount(0);
  await expect(page.locator('.game-hud')).toBeVisible();

  // The cored site is now in the collection (main menu).
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: 'Paused' })
    .getByRole('button', { name: 'Missions' })
    .click();
  await page.getByRole('tab', { name: 'Collection' }).click({ timeout: 60_000 });
  await expect(page.getByRole('tabpanel')).toContainText("Ha'ahóni + Atsá");

  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
