import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const b = await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--mute-audio'],executablePath:'/tmp/chromium',headless:true,defaultViewport:{width:640,height:400}});
const p = await b.newPage();
await p.goto('http://localhost:5173/', {waitUntil:'load', timeout:120000});
await p.waitForFunction('window.__game && window.__game.state === "menu"', {timeout:120000});
const out = await p.evaluate(async () => {
  const g = window.__game;
  const t0 = performance.now(), g0 = g.time;
  let frames = 0;
  const count = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(count); };
  requestAnimationFrame(count);
  await new Promise(r => setTimeout(r, 3000));
  return { wall: (performance.now() - t0) / 1000, game: g.time - g0, frames, ft: g.engine._frameTimes.slice(-10) };
});
console.log(JSON.stringify(out));
await b.close();
