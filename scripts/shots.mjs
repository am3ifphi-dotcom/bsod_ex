import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';
const url = process.argv[2];
const plan = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const b = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--mute-audio'],
  executablePath: '/tmp/chromium', headless: true, defaultViewport: { width: 1280, height: 800 },
});
const p = await b.newPage();
p.on('console', m => { const t=m.text(); if(!t.includes('[vite]')) console.log('[console]', t.slice(0,300)); });
p.on('pageerror', e => console.log('[pageerror]', e.message));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
await p.goto(url, { waitUntil:'load', timeout: 120000 });
await p.waitForFunction('window.__ready === true', { timeout: 120000 }).catch(e=>console.log('timeout', e.message));
for (const s of plan) {
  if (s.eval) { const r = await p.evaluate(s.eval).catch(e=>{console.log('evalerr', e.message); return null;}); if (r !== undefined && r !== null) console.log('eval ->', typeof r === 'string' ? r : JSON.stringify(r)); }
  await sleep(s.wait ?? 700);
  if (s.shot) { await p.screenshot({ path: `/tmp/lab-${s.shot}.png` }); console.log('shot', s.shot); }
}
await b.close();
