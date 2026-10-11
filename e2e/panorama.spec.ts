import { expect, test } from '@playwright/test';
import { openApp, trackExternalRequests } from './helpers';

test('360° panorama: opens from the gallery, loads the local image, closes with Esc', async ({
  page,
}) => {
  const external = trackExternalRequests(page);
  await openApp(page);
  await page.getByRole('tab', { name: 'Surface' }).click();
  const image = page.waitForResponse((r) => r.url().includes('_8k.webp') && r.ok());
  await page.locator('.pano-card', { hasText: 'Crocodile Bridge' }).click(); // 360° gallery, Surface tab

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
  await page.getByRole('tab', { name: 'Surface' }).click();
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
  await page.getByRole('tab', { name: 'Surface' }).click();
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

test('360° HUD: mission facts, look at a place, unimaged areas and the next panorama', async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole('tab', { name: 'Surface' }).click();
  await page.locator('summary', { hasText: 'Three Forks sample depot' }).click();
  await page.getByRole('button', { name: 'Look around (360°, sol 670)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Three Forks sample depot' });
  await expect(dialog).toBeVisible();
  const panel = page.locator('.pano-panel');
  await expect(panel).toContainText('Mission moment');
  await expect(panel).toContainText('Driven since landing');
  await expect(panel).toContainText('Samples collected nearby');

  // "Look" turns the view to the place; the heading readout names what is straight ahead.
  await page.locator('.pano-row', { hasText: 'Hawksbill Gap' }).click();
  await expect(page.locator('.pano-facing')).toHaveText(/Hawksbill Gap/, { timeout: 5_000 });

  const unimaged = page.getByRole('button', { name: 'Show the areas the camera did not image' });
  await unimaged.click();
  await expect(unimaged).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /^Next panorama: Belva crater/ }).click();
  await expect(page.getByRole('dialog', { name: 'Belva crater' })).toBeVisible();
  await expect(page.locator('.pano-facing')).not.toHaveText(/Hawksbill Gap/);
});

test('auto-tour: looks around, flies along the traverse to the next panorama, and can stop', async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole('tab', { name: 'Surface' }).click();
  await page.getByRole('button', { name: /^Tour all \d+ 360° views along the path$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Octavia E. Butler Landing' })).toBeVisible();
  const tourBar = page.locator('.pano-tour');
  await expect(tourBar).toContainText('1 of');
  // Skip ahead: the viewer fades, the map flies the drive with a caption, the next stop opens.
  await page.getByRole('button', { name: 'Go on to the next stop' }).click();
  await expect(page.locator('.tour-caption')).toContainText('Van Zyl Overlook', {
    timeout: 10_000,
  });
  await expect(page.getByRole('dialog', { name: 'Van Zyl Overlook' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(tourBar).toContainText('2 of');
  await page.getByRole('button', { name: 'Stop the tour' }).click();
  await expect(tourBar).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Van Zyl Overlook' })).toBeVisible();
});
