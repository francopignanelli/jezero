import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('first visit: welcome, then the guided tour drives the app to the end', async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page, '/', { fresh: true });
  const welcome = page.getByRole('dialog', { name: 'Plan a walk on Mars' });
  await expect(welcome).toBeVisible();
  const a11y = await new AxeBuilder({ page })
    .include('.welcome')
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('button', { name: 'Take the 2-minute tour' }).click();
  await expect(welcome).toHaveCount(0);

  const card = page.locator('.tour-card');
  const titles: string[] = [];
  for (let i = 0; i < 30; i++) {
    await expect(card).toBeVisible();
    await expect(page.getByText('Getting this part ready…')).toHaveCount(0, { timeout: 60_000 });
    titles.push((await card.locator('h2').textContent()) ?? '');
    const finish = card.getByRole('button', { name: 'Finish' });
    if (await finish.count()) {
      await finish.click();
      break;
    }
    await card.getByRole('button', { name: 'Next' }).click();
  }
  await expect(card).toHaveCount(0);
  // The tour prepared the app itself: Jezero, the guided route and its results.
  expect(titles).toContain('Read the results');
  expect(titles.at(-1)).toBe('Help is always here');
  await expect(page.locator('.metrics').first()).toContainText('km');

  // The welcome does not come back on the next visit.
  await page.reload();
  await expect(page.locator('.loading-screen')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByRole('dialog', { name: 'Plan a walk on Mars' })).toHaveCount(0);
});

test('help menu opens the glossary at a term', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: 'Glossary of terms' }).click();
  const glossary = page.getByRole('dialog', { name: 'Glossary' });
  await expect(glossary).toBeVisible();
  await glossary.getByPlaceholder('Search a word').fill('walk-back');
  await expect(glossary.locator('.glossary-item')).toHaveCount(1);
  await expect(glossary).toContainText('Walk-back margin');
  await page.keyboard.press('Escape');
  await expect(glossary).toHaveCount(0);
});
