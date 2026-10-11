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

  // Science stops near the route are part of the plan review (Marswalk, step 3).
  await expect(page.getByRole('region', { name: /Science stops near your route/ })).toBeVisible();
  await expect(page.locator('.stop').first()).toContainText('+', { timeout: 60_000 });

  // Everything (tiles, data, Cesium assets) is served locally: no Cesium ion, no Earth services.
  expect(external).toEqual([]);
});

test('keyboard only: a route by coordinates', async ({ page }) => {
  await openApp(page);
  await page.getByRole('tab', { name: 'Marswalk' }).focus();
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
  await expect(page.locator('.metrics').first()).toContainText('km', { timeout: 60_000 });
});

test('Spanish interface', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'ES', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Caminata' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Explorar Marte' })).toBeVisible();
  await page.getByRole('button', { name: 'EN', exact: true }).click();
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
  const metrics = other.locator('[data-tour="metrics"]');
  await expect(metrics).toBeVisible({ timeout: 60_000 });
  await expect(metrics.locator('.metric dd').first()).toHaveText(distance);
  await expect(other.locator('.toast')).toContainText('Opened the shared mission');
});

test('an invalid share link loads nothing and says so', async ({ page }) => {
  await openApp(page, '/#m=not-a-mission');
  await expect(page.locator('.toast')).toContainText('not a valid Copernico mission');
  await expect(page.locator('.waypoint')).toHaveCount(0);
});

test('Play mission flies along the route and returns control', async ({ page }) => {
  await openApp(page);
  await computeGuided(page);
  await page.getByRole('button', { name: '▶ Simulate the walk' }).click();
  await page.waitForTimeout(6000);
  const mid = await page.evaluate(() => {
    const w = window as unknown as {
      __copernicoStore: { getState(): { playing: boolean; routeCursorM: number | null } };
      __copernico: { widget: { camera: { positionCartographic: { height: number } } } };
    };
    return {
      playing: w.__copernicoStore.getState().playing,
      cursor: w.__copernicoStore.getState().routeCursorM,
      height: w.__copernico.widget.camera.positionCartographic.height,
    };
  });
  expect(mid.playing).toBe(true);
  expect(mid.cursor).toBeGreaterThan(0);
  // Follow-cam a few hundred metres above the crater floor (~2.5 km below the reference sphere).
  expect(mid.height).toBeLessThan(-1500);
  // Walk HUD: EVA clock running, distance walked, next stop.
  const hud = page.getByRole('status').filter({ hasText: 'Simulated Marswalk' });
  await expect(hud).toContainText('EVA clock');
  await expect(hud).toContainText(/Next: .+ in /);
  await page.getByRole('button', { name: '■ Stop' }).click();
  await expect(page.getByRole('button', { name: '▶ Simulate the walk' })).toBeVisible();
  await expect(hud).toHaveCount(0);
});

test('zooming out of the oblique Jezero view straightens it; 2D / 3D toggles the tilt', async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Explore Jezero' }).click();
  const scene = () =>
    page.evaluate(() => {
      const s = (window as unknown as { __copernico: { viewState(): { tiltDeg: number } } })
        .__copernico;
      return s.viewState().tiltDeg;
    });
  await expect.poll(scene, { timeout: 20_000 }).toBeGreaterThan(30); // oblique operational view
  await page.mouse.move(900, 450);
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(60);
  }
  await expect.poll(scene, { timeout: 10_000 }).toBeLessThan(2); // straight down from orbit

  // Back near the surface, the 3D button tilts the view and 2D returns to straight down.
  await page.evaluate(() =>
    (
      window as unknown as { __copernico: { flyTo(...a: number[]): Promise<void> } }
    ).__copernico.flyTo(18.45, 77.4, 15_000, 0, -90, 0),
  );
  const toggle = page.locator('.view-tilt');
  await expect(toggle).toHaveText('3D');
  await toggle.click();
  await expect.poll(scene, { timeout: 10_000 }).toBeGreaterThan(40);
  await expect(toggle).toHaveText('2D');
  await toggle.click();
  await expect.poll(scene, { timeout: 10_000 }).toBeLessThan(2);
});

test('flying to a nearby place glides from the current view (no climb toward orbit)', async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Explore Jezero' }).click();
  await page.waitForTimeout(6000);
  // Explore Jezero opens the Surface tab (clicking it again would hide the panel).
  await expect(page.getByRole('tab', { name: 'Surface' })).toHaveAttribute('aria-selected', 'true');
  const show = async (i: number) => {
    const card = page.locator('[id^="poi-card-"]').nth(i);
    if (!(await card.evaluate((e) => (e as HTMLDetailsElement).open)))
      await card.locator('summary').click();
    await card.getByRole('button', { name: 'Show on map' }).click();
  };
  // Highest camera height (m above the reference sphere) over the next few seconds.
  const highest = async (action: () => Promise<void>) => {
    await page.evaluate(() => {
      const w = window as unknown as {
        __copernico: {
          widget: {
            camera: { positionCartographic: { height: number } };
            scene: { postRender: { addEventListener(f: () => void): void } };
          };
        };
        __max: number;
      };
      w.__max = -Infinity;
      const cam = w.__copernico.widget.camera;
      w.__copernico.widget.scene.postRender.addEventListener(() => {
        w.__max = Math.max(w.__max, cam.positionCartographic.height);
      });
    });
    await action();
    await page.waitForTimeout(4000);
    return page.evaluate(() => (window as unknown as { __max: number }).__max);
  };
  // From the operational view (~10 km up) down to a place: a descent, never above the start.
  expect(await highest(() => show(0))).toBeLessThan(15_000);
  // Between two places on the crater floor (~2.5 km below the sphere): a short hop at most.
  expect(await highest(() => show(1))).toBeLessThan(2_000);
});
