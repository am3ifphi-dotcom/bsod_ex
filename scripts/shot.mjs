import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const url = process.argv[2];
const out = process.argv[3] || '/tmp/shot.png';
const waitMs = +(process.argv[4]||0);
const b = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--window-size=1280,800'],
  executablePath: '/tmp/chromium', headless: true, defaultViewport:{width:1280,height:800}
});
const p = await b.newPage();
p.on('console', m => console.log('[console]', m.text()));
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto(url, {waitUntil:'load', timeout:60000});
try { await p.waitForFunction('window.__ready === true', {timeout: 60000}); } catch(e){ console.log('not ready', e.message); }
await new Promise(r=>setTimeout(r, waitMs));
await p.screenshot({path: out});
console.log('shot saved', out);
await b.close();
