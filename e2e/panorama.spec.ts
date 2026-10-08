import { expect, test } from '@playwright/test';
import { openApp, trackExternalRequests } from './helpers';

test('360° panorama: opens from the rover card, loads the local image, closes with Esc', async ({
  page,
}) => {
  const external = trackExternalRequests(page);
  await openApp(page);
  await page.getByRole('tab', { name: 'Science' }).click();
  const image = page.waitForResponse((r) => r.url().includes('/panoramas/') && r.ok());
  await page.getByRole('button', { name: /Look around \(360°, sol 1717\)/ }).click();

  const dialog = page.getByRole('dialog', { name: /Crocodile Bridge/ });
  await expect(dialog).toBeVisible();
  await image;
  await expect(dialog).toContainText('PIA26699');
  await expect(dialog).toContainText('NASA/JPL-Caltech/ASU/MSSS');
  await expect(page.locator('.pano-status')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(external).toEqual([]);
});

test('a point of interest opens the real panorama taken there, with a measured compass', async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole('tab', { name: 'Science' }).click();
  await page.locator('summary', { hasText: 'Three Forks sample depot' }).click();
  await page.getByRole('button', { name: 'Look around (360°, sol 670)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Three Forks sample depot' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('ASU Mastcam-Z 360° #23');
  await expect(dialog).toContainText('Compass and horizon measured');
  await expect(page.locator('.pano-tick-major').first()).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('walking from one panorama to another loads the next view (no black screen)', async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole('tab', { name: 'Science' }).click();
  await page.locator('summary', { hasText: 'Three Forks sample depot' }).click();
  await page.getByRole('button', { name: 'Look around (360°, sol 670)' }).click();
  await expect(page.getByRole('dialog', { name: 'Three Forks sample depot' })).toBeVisible();
  await expect(page.locator('.pano-status')).toHaveCount(0, { timeout: 20_000 });
  // The Wildcat Ridge label carries a "360°" chip that walks to the panorama taken there.
  const chip = page
    .locator('.pano-label', { hasText: 'Wildcat Ridge' })
    .locator('.annotation-chip');
  await expect(chip).toBeAttached({ timeout: 20_000 });
  await chip.evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByRole('dialog', { name: 'Wildcat Ridge' })).toBeVisible();
  await expect(page.locator('.pano-status')).toHaveCount(0, { timeout: 20_000 });
  const lost = await page
    .locator('.pano-canvas')
    .evaluate((c) => (c as HTMLCanvasElement).getContext('webgl2')?.isContextLost() ?? true);
  expect(lost).toBe(false);
});
