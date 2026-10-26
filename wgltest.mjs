import chromium from '@sparticuz/chromium';
import { chromium as pwChromium } from 'playwright-core';
const exe = await chromium.executablePath();
console.log('exe', exe);
const browser = await pwChromium.launch({
  executablePath: exe,
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => console.log('console:', m.type(), m.text().slice(0,300)));
page.on('pageerror', e => console.log('pageerror:', e.message.slice(0,500)));
await page.setContent(`<canvas id=c width=640 height=360></canvas><script>
const gl=document.getElementById('c').getContext('webgl2',{antialias:true});
window.__info = gl ? {ver: gl.getParameter(gl.VERSION), rend: gl.getParameter(gl.RENDERER), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE)} : null;
</script>`);
console.log(await page.evaluate(() => window.__info));
await page.screenshot({path:'/tmp/shot.png'});
await browser.close();
