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
