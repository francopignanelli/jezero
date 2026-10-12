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

test('360° HUD: plain-language intro, mission facts, always-marked unimaged areas, next panorama', async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole('tab', { name: 'Surface' }).click();
  await page.locator('summary', { hasText: 'Three Forks sample depot' }).click();
  await page.getByRole('button', { name: 'Look around (360°, sol 670)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Three Forks sample depot' });
  await expect(dialog).toBeVisible();
  const panel = page.locator('.pano-panel');
  // What and where first, for anyone; then why it matters, the mission moment and samples.
  await expect(panel).toContainText('What you are looking at');
  await expect(panel.locator('.pano-intro')).toContainText('foot of the delta');
  await expect(panel).toContainText('Mission moment');
  await expect(panel).toContainText('Driven since landing');
  await expect(panel).toContainText('Samples collected nearby');
  // Simpler panel: no list of places (they are on the photo and the mini-map), no card link.
  await expect(panel).not.toContainText('Places around you');
  await expect(panel).not.toContainText('Open its science card');
  // The unimaged areas are always marked: no toggle any more.
  await expect(page.getByRole('button', { name: /did not image/ })).toHaveCount(0);

  await page.getByRole('button', { name: /^Next panorama: Belva crater/ }).click();
  await expect(page.getByRole('dialog', { name: 'Belva crater' })).toBeVisible();
  await expect(panel.locator('.pano-intro')).toContainText('Belva');
});

test('auto-tour: looks around, flies straight to the next panorama, and can stop', async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole('tab', { name: 'Surface' }).click();
  await page.getByRole('button', { name: /^Tour all \d+ 360° views along the path$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Octavia E. Butler Landing' })).toBeVisible();
  const tourBar = page.locator('.pano-tour');
  await expect(tourBar).toContainText('1 of');
  // Camera heading on every visible frame of the flight (it must not turn: a straight line).
  await page.evaluate(() => {
    const w = window as unknown as {
      __copernico: {
        widget: {
          camera: { heading: number };
          scene: { postRender: { addEventListener(f: () => void): void } };
        };
      };
      __copernicoStore: { getState(): { tour: { phase: string } | null } };
      __headings: number[];
    };
    w.__headings = [];
    w.__copernico.widget.scene.postRender.addEventListener(() => {
      // Only what is shown: frames under the veil (before take-off, after landing) do not count.
      if (
        w.__copernicoStore.getState().tour?.phase === 'travel' &&
        document.querySelector('.tour-veil:not(.is-on)')
      )
        w.__headings.push(w.__copernico.widget.camera.heading);
    });
  });
  // Skip ahead: the viewer fades, the map flies straight to the next stop with a caption, it opens.
  await page.getByRole('button', { name: 'Go on to the next stop' }).click();
  await expect(page.locator('.tour-caption')).toContainText('Van Zyl Overlook', {
    timeout: 10_000,
  });
  await expect(page.getByRole('dialog', { name: 'Van Zyl Overlook' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(tourBar).toContainText('2 of');
  const headings = await page.evaluate(
    () => (window as unknown as { __headings: number[] }).__headings,
  );
  expect(headings.length).toBeGreaterThan(5); // the test browser renders slowly
  const turnDeg = ((Math.max(...headings) - Math.min(...headings)) * 180) / Math.PI;
  expect(turnDeg).toBeLessThan(0.5);
  await page.getByRole('button', { name: 'Stop the tour' }).click();
  await expect(tourBar).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Van Zyl Overlook' })).toBeVisible();
});
