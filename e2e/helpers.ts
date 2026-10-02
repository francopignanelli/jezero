import { expect, type Page } from '@playwright/test';

/** Hosts the app may contact: only the dev server (data, tiles and Cesium assets are local). */
export function trackExternalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) &&
      !url.protocol.startsWith('data') &&
      !url.protocol.startsWith('blob')
    ) {
      external.push(req.url());
    }
  });
  return external;
}

/** Opens the app and waits until the loading screen has revealed the scene. */
export async function openApp(page: Page, path = '/', { fresh = false } = {}): Promise<void> {
  // Returning visitor by default: the first-run welcome would cover the screen in every test.
  if (!fresh) {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('copernico.welcomed', '1');
      } catch {
        /* ignore */
      }
    });
  }
  await page.goto(path);
  await expect(page.locator('.loading-screen')).toHaveCount(0, { timeout: 90_000 });
}

/** Loads the guided Marswalk and computes it. */
export async function computeGuided(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Load guided Marswalk' }).click();
  await expect(page.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Calculate routes' }).click();
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 60_000 });
}
