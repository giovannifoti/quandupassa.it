// Genera le immagini derivate dal logo (anteprima social e icone) con Chrome headless.
// Uso: node scripts/images.mjs  (richiede Google Chrome installato)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const mark = (await readFile(`${root}public/img/favicon.svg`, 'utf8')).replace('<svg ', '<svg class="mark" ');
const font = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

const pages = [
  {
    file: 'public/img/og-image.png', width: 1200, height: 630,
    html: `<div style="width:1200px;height:630px;display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box;background:#faf8f5;font-family:${font};color:#1b2f36">
      <div style="width:210px;flex:none">${mark}</div>
      <div><div style="font-size:84px;font-weight:800;letter-spacing:-3px;line-height:1">quandupassa<span style="color:#536a71;font-weight:700">.it</span></div>
      <div style="margin-top:22px;font-size:40px;font-weight:600;color:#536a71;line-height:1.25">Fermate autobus ATM Messina:<br>mappa, fermate vicine e orari</div></div></div>`
  },
  {
    file: 'public/img/apple-touch-icon.png', width: 180, height: 180,
    html: `<div style="width:180px;height:180px;display:grid;place-items:center;background:#faf8f5"><div style="width:104px">${mark}</div></div>`
  },
  {
    file: 'public/img/icon-maskable-512.png', width: 512, height: 512,
    html: `<div style="width:512px;height:512px;display:grid;place-items:center;background:#e8553a"><div style="width:230px">${mark.replace('fill="#e8553a" d=', 'fill="#ffffff" d=').replace('<g fill="#fff">', '<g fill="#e8553a">').replace('<g fill="#e8553a"><rect x="20.5"', '<g fill="#ffffff"><rect x="20.5"')}</div></div>`
  }
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const { file, width, height, html } of pages) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<style>body{margin:0}.mark{display:block;width:100%;height:auto}</style>${html}`);
  await page.screenshot({ path: `${root}${file}`, omitBackground: false });
  await page.close();
  console.log(`creato ${file}`);
}
await browser.close();
