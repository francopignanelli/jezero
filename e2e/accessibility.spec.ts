import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { computeGuided, openApp } from './helpers';

/** WCAG 2.2 A/AA rules on the UI chrome; the WebGL canvas itself has panel text equivalents. */
async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('.cesium-widget')
    .exclude('.sky-layer')
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes[0]?.target.join(' ')}`,
  );
  expect(summary, `${label}: axe violations`).toEqual([]);
}

test('panels meet WCAG 2.2 AA (automated rules)', async ({ page }) => {
  await openApp(page);
  await audit(page, 'Explore');

  await page.getByRole('button', { name: 'Layers' }).click();
  await audit(page, 'Layers popover');
  await page.keyboard.press('Escape');

  await computeGuided(page);
  await audit(page, 'Plan with results');

  await page.getByRole('tab', { name: 'Science' }).click();
  await audit(page, 'Science');

  await page.getByRole('tab', { name: 'Conditions' }).click();
  await audit(page, 'Conditions');
});
