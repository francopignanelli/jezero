import { expect, test } from '@playwright/test';
import { computeGuided, openApp, trackExternalRequests } from './helpers';

test('guided Marswalk: route, timeline, science stops, no external requests', async ({ page }) => {
  const external = trackExternalRequests(page);
  await openApp(page);
  await computeGuided(page);

  // Metrics of the validated guided route (docs/datasets.md): 5.64 km, max slope 15°.
  const metrics = page.locator('.metrics').first();
  await expect(metrics).toContainText('5.64 km');
  await expect(metrics).toContainText('15°');
  await expect(page.getByRole('heading', { name: 'EVA timeline' })).toBeVisible();
  await expect(page.locator('.tl-check')).toContainText('before the Sun drops below 10°');

  await page.getByRole('tab', { name: 'Science' }).click();
  await expect(page.getByRole('region', { name: /Science stops near your route/ })).toBeVisible();
  await expect(page.locator('.stop').first()).toContainText('+', { timeout: 60_000 });

  // Everything (tiles, data, Cesium assets) is served locally: no Cesium ion, no Earth services.
  expect(external).toEqual([]);
});

test('keyboard only: a route by coordinates', async ({ page }) => {
  await openApp(page);
  await page.getByRole('tab', { name: 'Plan' }).focus();
  await page.keyboard.press('Enter');
  const details = page.getByText('Add by coordinates');
  await details.focus();
  await page.keyboard.press('Enter');
  const add = async (lat: string, lon: string) => {
    await page.getByLabel(/^Latitude/).focus();
    await page.keyboard.type(lat);
    await page.keyboard.press('Tab');
    await page.keyboard.type(lon);
    await page.keyboard.press('Enter');
  };
  await add('18.44457', '77.45091'); // landing site
  await add('18.45296', '77.40821'); // Three Forks
  await expect(page.locator('.waypoint')).toHaveCount(2);
  await page.getByRole('button', { name: 'Calculate routes' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.metrics').first()).toContainText('km');
});

test('Spanish interface', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'ES' }).click();
  await expect(page.getByRole('tab', { name: 'Planificar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Explorar Marte' })).toBeVisible();
  await page.getByRole('button', { name: 'EN' }).click();
});

test('share link reopens the same route', async ({ page, context }) => {
  await openApp(page);
  await computeGuided(page);
  const distance = (await page.locator('.metrics .metric dd').first().textContent()) ?? '';
  expect(distance).toContain('km');
  await page.evaluate(() => {
    (window as unknown as { __copied?: string }).__copied = '';
    navigator.clipboard.writeText = async (text: string) => {
      (window as unknown as { __copied?: string }).__copied = text;
    };
  });
  await page.getByRole('button', { name: 'Copy share link' }).click();
  const url = await page.evaluate(
    () => (window as unknown as { __copied?: string }).__copied ?? '',
  );
  expect(url).toMatch(/#m=[A-Za-z0-9_-]+$/);

  const other = await context.newPage();
  await openApp(other, new URL(url).pathname + new URL(url).hash);
  await expect(other.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 60_000 });
  await expect(other.locator('.metrics .metric dd').first()).toHaveText(distance);
  await expect(other.locator('.toast')).toContainText('Opened the shared mission');
});

test('an invalid share link loads nothing and says so', async ({ page }) => {
  await openApp(page, '/#m=not-a-mission');
  await expect(page.locator('.toast')).toContainText('not a valid Copernico mission');
  await expect(page.locator('.waypoint')).toHaveCount(0);
});
