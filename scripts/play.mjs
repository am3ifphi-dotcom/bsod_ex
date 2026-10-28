import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'fs';

const url = process.argv[2] || 'http://localhost:5173/';
const scenario = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : [];
const b = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--mute-audio','--window-size=1280,800','--autoplay-policy=no-user-gesture-required'],
  executablePath: '/tmp/chromium', headless: true, defaultViewport: { width: +(process.env.VW||1280), height: +(process.env.VH||800) },
});
const p = await b.newPage();
p.on('console', m => { const t = m.text(); if (!t.includes('[vite]')) console.log('[console]', t.slice(0, 400)); });
p.on('pageerror', e => console.log('[pageerror]', e.message));
p.on('requestfailed', r => console.log('[reqfail]', r.url().slice(0, 140)));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await p.goto(url, { waitUntil: 'load', timeout: 120000 });
await p.waitForFunction('window.__game && window.__game.state === "menu"', { timeout: 120000 }).catch(e => console.log('no menu', e.message));
for (const s of scenario) {
  try {
    if (s.do === 'click') { await p.mouse.click(s.x ?? 640, s.y ?? 400); }
    else if (s.do === 'key') { await p.keyboard.press(s.key); }
    else if (s.do === 'down') { await p.keyboard.down(s.key); }
    else if (s.do === 'up') { await p.keyboard.up(s.key); }
    else if (s.do === 'type') { await p.keyboard.type(s.text, { delay: 30 }); }
    else if (s.do === 'move') { await p.mouse.move(s.x, s.y); }
    else if (s.do === 'eval') { const r = await p.evaluate(new Function('return (async()=>{' + s.fn + '})()')); if (r !== undefined) console.log('eval ->', JSON.stringify(r)); }
    else if (s.do === 'shot') { await p.screenshot({ path: `/tmp/shot-${s.name}.png` }); console.log('shot', s.name); }
    if (s.wait) await sleep(s.wait);
  } catch (e) { console.log('step error', s.do, e.message); }
}
const stats = await p.evaluate(() => {
  const g = window.__game;
  const ft = g.engine._frameTimes;
  return { state: g.state, mode: g.mode, paused: g.paused, res: g.engine.resScale,
    fps: ft.length ? +(1 / (ft.reduce((a, b) => a + b, 0) / ft.length)).toFixed(1) : null,
    info: { calls: g.engine.renderer.info.render.calls, tris: g.engine.renderer.info.render.triangles },
    player: g.player.pos.toArray().map(v => +v.toFixed(2)) };
});
console.log('STATS', JSON.stringify(stats));
await b.close();
