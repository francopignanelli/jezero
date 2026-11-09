import { expect, test, type Page } from '@playwright/test';
import { openApp, trackExternalRequests } from './helpers';

/** Development test hook of the game page (src/game/session.ts). */
interface GameHook {
  state: { odometerM: number; lat: number; lon: number; batteryPct: number };
  exp: { chapter: number };
  refreshTargets(): void;
  teleport(lat: number, lon: number): void;
}
const hook = (page: Page) =>
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

test('rover game: the delta-front expedition, a core, the inventory, AutoNav, saving', async ({
  page,
}) => {
  test.setTimeout(600_000); // software WebGL in headless Chrome renders the 3D world at a few frames per second
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

  // A new expedition opens on chapter 1's page.
  await page.getByRole('button', { name: 'Start: The delta front' }).click();
  const chapter = page.getByRole('dialog', { name: 'Arrival at the delta front' });
  await expect(chapter).toBeVisible({ timeout: 60_000 });
  await chapter.getByRole('button', { name: 'Start driving' }).click();
  await expect(page.locator('.game-objectives')).toContainText('Reach Enchanted Lake');

  // W drives forward.
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => (await hook(page)).odometerM, { timeout: 20_000 })
    .toBeGreaterThan(3);
  await page.keyboard.up('KeyW');

  // Chapter 2 (as if chapter 1 were done), next to Skinner Ridge (samples 10 & 11), stopped:
  // one press of Space cores it (arm down, drill, arm up).
  await page.evaluate(() => {
    const g = (window as unknown as { __copernicoGame: GameHook }).__copernicoGame;
    g.exp = { ...g.exp, chapter: 1 };
    g.refreshTargets();
    g.teleport(18.458931 - 6 / 59_274, 77.406175);
  });
  await expect(page.locator('.game-prompt')).toContainText('Press Space to core', {
    timeout: 30_000,
  });
  await page.keyboard.press('Space');
  await expect(page.locator('.game-prompt')).toContainText('Coring', { timeout: 30_000 });
  const card = page.getByRole('dialog', { name: 'Swift Run + Skyland' });
  // Coring is 6 s of mission time; software WebGL runs the arm close-up at about 1 frame a second.
  await expect(card).toBeVisible({ timeout: 240_000 });
  await expect(card).toContainText('Samples 10 & 11');
  await expect(card).toContainText('Sedimentary rock');
  await expect(card.locator('img')).toHaveJSProperty('complete', true);
  await card.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.game-objectives li.is-done')).toHaveCount(1);

  // I opens the inventory: the two new tubes are in the rack.
  await page.keyboard.press('KeyI');
  const inventory = page.getByRole('dialog', { name: 'Inventory' });
  await expect(inventory).toBeVisible();
  await expect(inventory).toContainText('11 of the 38 sample tubes are filled');
  await inventory.getByRole('tab', { name: 'Samples' }).click();
  await expect(inventory.getByRole('tabpanel')).toContainText('Swift Run + Skyland');
  await page.keyboard.press('KeyI');
  await expect(inventory).toHaveCount(0);

  // N: AutoNav plans a path to the next objective and drives; any drive key takes over.
  await page.keyboard.press('KeyN');
  await expect(page.locator('.game-autonav')).toContainText('AutoNav', { timeout: 60_000 });
  await page.keyboard.down('KeyS');
  await expect(page.locator('.game-autonav')).toHaveCount(0, { timeout: 20_000 });
  await page.keyboard.up('KeyS');

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

  // Esc pauses; the main menu offers to continue the saved expedition; the core is collected.
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: 'Paused' })
    .getByRole('button', { name: 'Main menu' })
    .click();
  await expect(page.getByRole('button', { name: 'Continue · chapter 2: The delta front' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('.game-mc').filter({ hasText: 'The delta front' })).toContainText(
    'Chapter 2 of 4',
  );

  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
