import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs'; import path from 'path';
const [,, src, outPrefix, sliceH0] = process.argv;
const sliceH = parseInt(sliceH0 || '1100', 10);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const data = fs.readFileSync(src).toString('base64');
await p.setContent(`<style>html,body{margin:0;background:#000}img{display:block}</style><img id=i src="data:image/png;base64,${data}">`);
const dim = await p.evaluate(() => new Promise(r => { const i = document.getElementById('i'); const go=()=>r({w:i.naturalWidth,h:i.naturalHeight}); i.complete?go():i.onload=go; }));
await p.setViewportSize({ width: Math.min(dim.w, 1920), height: Math.min(sliceH, 2000) });
const n = Math.ceil(dim.h / sliceH);
for (let k = 0; k < n; k++) {
  await p.evaluate(([y]) => window.scrollTo(0, y), [k*sliceH]);
  await p.screenshot({ path: `${outPrefix}-${String(k).padStart(2,'0')}.png` });
}
console.log(JSON.stringify({src, ...dim, slices:n}));
await b.close();
