import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
const b = await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--mute-audio'],executablePath:'/tmp/chromium',headless:true,defaultViewport:{width:640,height:400}});
const p = await b.newPage();
p.on('pageerror', e => console.log('[err]', e.message));
await p.goto('http://localhost:5173/', {waitUntil:'load', timeout:120000});
await p.waitForFunction('window.__game && window.__game.state === "menu"', {timeout:120000});
const out = await p.evaluate(() => {
  const g = window.__game;
  g.engine.fade(0);
  const U = g.engine.signal.uniforms;
  const o = {};
  for (const k in U) {
    if (k === 'tDiffuse') continue;
    const v = U[k].value;
    if (v && v.toArray) o[k] = v.toArray();
    else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') o[k] = v;
  }
  o.near = g.camera.near; o.far = g.camera.far;
  o.exp = g.engine.renderer.toneMappingExposure;
  o.bloom = g.engine.composer.passes[1].enabled;
  o.shader = g.engine.composer.passes[2].enabled;
  o.camPos = g.camera.position.toArray().map(v => +v.toFixed(2));
  o.camRot = [g.camera.rotation.x, g.camera.rotation.y, g.camera.rotation.z].map(v => +v.toFixed(2));
  o.mode = g.mode; o.state = g.state;
  o.pix = g.engine.renderer.getPixelRatio();
  return o;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
