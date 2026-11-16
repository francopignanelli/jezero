// Renders docs/dossier/dossier.html to docs/dossier/Jezero-Dossier.pdf (A4) with the installed
// Chrome. With --preview it also writes a PNG of every page to docs/dossier/preview/ for checking
// the layout. Screenshots come from scripts/docs/capture-dossier-shots.mjs.
//
//   node scripts/docs/build-dossier.mjs [--preview]
/* global document */
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = resolve(import.meta.dirname, '../../docs/dossier');
const HTML = resolve(DIR, 'dossier.html');
const PDF = resolve(DIR, 'Jezero-Dossier.pdf');
const PREVIEW = resolve(DIR, 'preview');
const preview = process.argv.includes('--preview');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
await page.goto(pathToFileURL(HTML).href, { waitUntil: 'load' });
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
});

// Layout check: content that runs past a page's bottom edge (into the footer) is reported.
const overflow = await page.evaluate(() =>
  [...document.querySelectorAll('.page')].flatMap((p, i) => {
    const limit = p.getBoundingClientRect().bottom - (p.querySelector('.ftr')?.offsetHeight ?? 0);
    const worst = Math.max(
      ...[...p.children]
        .filter((c) => !c.matches('.hdr, .ftr, .bg'))
        .map((c) => c.getBoundingClientRect().bottom),
    );
    return worst > limit - 2 ? [`page ${i + 1}: ${Math.round(worst - limit)} px over`] : [];
  }),
);
console.log(overflow.length ? `Overflow:\n  ${overflow.join('\n  ')}` : 'No page overflows.');

await page.pdf({ path: PDF, printBackground: true, preferCSSPageSize: true });
console.log(`PDF: ${PDF} (${(statSync(PDF).size / 1e6).toFixed(1)} MB)`);

if (preview) {
  rmSync(PREVIEW, { recursive: true, force: true });
  mkdirSync(PREVIEW, { recursive: true });
  const pages = await page.locator('.page').all();
  for (let i = 0; i < pages.length; i++) {
    await pages[i].screenshot({ path: resolve(PREVIEW, `p${String(i + 1).padStart(2, '0')}.png`) });
  }
  console.log(`Previews: ${pages.length} pages in ${PREVIEW}`);
}
await browser.close();
