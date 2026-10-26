/**
 * BSOD:EX — automated playthrough verification (headless Chromium, software GL).
 *
 *   npm run build && npm run verify            # full run on the production build
 *   npm run verify -- --url http://localhost:5173 --keep   # use a running dev server
 *   npm run verify -- --bench                  # also run the ?bench=1 FPS sampler
 *
 * The harness drives the real game through window.__BSOD__ (the debug hooks are
 * always compiled in, but F9 phase jumping only responds when the page URL has
 * ?debug=1). It never fakes gameplay results: every check is a state read after a
 * real simulated action.
 *
 * Software rendering (SwiftShader) is 50–300× slower than a GPU, so the numbers
 * printed by --bench measure logic/CPU cost, NOT the frame rates quoted in the
 * README. See "Perf" in README.md.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';

const args = process.argv.slice(2);
const argVal = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const PORT = Number(argVal('port', '4173'));
let server = null;

async function startPreview() {
  if (argVal('url')) return argVal('url');
  if (!existsSync('dist/index.html')) {
    console.error('dist/index.html not found — run `npm run build` first.');
    process.exit(2);
  }
  server = spawn('npx', ['vite', 'preview', '--host', '0.0.0.0', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = `http://127.0.0.1:${PORT}/`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return url;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

const results = [];
let pageErrors = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra: String(extra) });
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra ? `  — ${extra}` : ''}`);
}

async function main() {
  const base = await startPreview();
  const browser = await pw.launch({
    executablePath: process.env.CHROME_PATH || (await chromium.executablePath()),
    args: [
      ...chromium.args,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
    ],
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text().slice(0, 200));
  });

  const st = () => page.evaluate(() => window.__BSOD__.state());
  // advance(seconds) steps the game loop at a fixed 1/60 s without waiting for the
  // renderer, so software GL cannot distort gameplay timing.
  const adv = (s) => page.evaluate((sec) => window.__BSOD__.advance(sec), s);
  const log = () => page.evaluate(() => document.getElementById('console-log').innerText);
  const shot = async (name) => {
    if (!flag('shots')) return;
    await page.screenshot({ path: `verify-${name}.png`, timeout: 240000 });
  };

  console.log(`\nBSOD:EX verification — ${base}`);
  await page.goto(`${base}?debug=1&manual=1&quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__BSOD__ && window.__BSOD__.state, { timeout: 240000 });

  /* ---------------------------------------------------------------- boot */
  await page.waitForFunction(() => document.getElementById('loading-veil').classList.contains('done'), { timeout: 240000 });
  check('loading veil clears after assets resolve', true);
  check('title screen is visible before start', !(await page.evaluate(() => document.getElementById('title-screen').classList.contains('hidden'))));
  const assets = await page.evaluate(() => ({
    loaded: window.__BSOD__.game.assets.loaded,
    total: window.__BSOD__.game.assets.total,
    missing: window.__BSOD__.game.assets.missing ?? [],
  }));
  check('all declared assets loaded', assets.loaded === assets.total && assets.missing.length === 0, `${assets.loaded}/${assets.total} missing=${assets.missing.length}`);
  check('start warns about flashing / photosensitivity', (await page.evaluate(() => document.querySelector('.warn').innerText)).length > 30);

  await page.click('#start-btn');
  await adv(0.6);
  check('starts in the bedroom phase', (await st()).phase === 'room');

  /* ------------------------------------------------------------ movement */
  await page.evaluate(() => window.__BSOD__.forceLock(true));
  await page.evaluate(() => window.__BSOD__.teleport(0, 1.0, 0));
  await page.evaluate(() => window.__BSOD__.key('KeyW', true));
  await adv(2.0);
  await page.evaluate(() => window.__BSOD__.key('KeyW', false));
  let s = await st();
  check('W walks the camera forward', s.player[2] < 0.6, JSON.stringify(s.player));
  await page.evaluate(() => { window.__BSOD__.teleport(2.8, 2.0, -Math.PI / 2); window.__BSOD__.key('KeyW', true); });
  await adv(2.0);
  await page.evaluate(() => window.__BSOD__.key('KeyW', false));
  s = await st();
  check('bedroom walls hold the player inside', s.player[0] <= 3.0, JSON.stringify(s.player));
  await page.evaluate(() => { window.__BSOD__.teleport(0, 0, 0); window.__BSOD__.key('ShiftLeft', true); window.__BSOD__.key('KeyW', true); });
  await adv(2.0);
  await page.evaluate(() => { window.__BSOD__.key('ShiftLeft', false); window.__BSOD__.key('KeyW', false); });
  s = await st();
  check('dash does not clip through the desk/wall', s.player[2] > -2.75, JSON.stringify(s.player));

  /* --------------------------------------------------------------- menu */
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })));
  await page.waitForTimeout(250);
  check('Esc opens the pause menu', (await st()).menuOpen === true);
  const sens = await page.evaluate(() => {
    const el = document.getElementById('sens');
    el.value = '2.2';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return window.__BSOD__.game.settings.sensitivity;
  });
  check('sensitivity slider applies instantly (0.2–3.0)', Math.abs(sens - 2.2) < 1e-9, String(sens));
  const range = await page.evaluate(() => {
    const el = document.getElementById('sens');
    return { min: el.min, max: el.max, step: el.step };
  });
  check('sensitivity range is 0.2–3.0', range.min === '0.2' && range.max === '3' && range.step === '0.05', JSON.stringify(range));
  const controls = await page.evaluate(() => {
    const ids = ['sens', 'vol', 'glitch', 'shake', 'quality', 'dynamic'];
    const present = ids.every((id) => document.getElementById(id));
    document.querySelector('.tab[data-tab="credits"]').click();
    return { present, credits: document.getElementById('credits-list').innerText };
  });
  check('menu exposes every required setting', controls.present);
  check('credits list asset licences (incl. non-commercial)', /CC0/.test(controls.credits) && /CC BY-NC/.test(controls.credits) && /MIT/.test(controls.credits));
  await page.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
  await page.click('#resume-btn');
  await page.waitForTimeout(200);
  check('resume closes the menu', (await st()).menuOpen === false);
  await page.evaluate(() => { const el = document.getElementById('sens'); el.value = '1'; el.dispatchEvent(new Event('input', { bubbles: true })); });

  /* ---------------------------------------------------- zoom + BSOD panel */
  await page.evaluate(() => { const g = window.__BSOD__.game; g.lastInteractable = g.room.interactables.find((i) => i.id === 'pc'); g.useInteractable(); });
  await adv(0.4);
  check('interacting with the PC starts the lean-in', (await st()).phase === 'zoom');
  await adv(2.2);
  s = await st();
  check('lean-in hands over to the BSOD screen', s.phase === 'bsod' && s.sequence === null, s.phase);
  await shot('bsod');
  const clicks = [];
  for (let i = 0; i < 7; i++) {
    const pt = await page.evaluate(() => window.__BSOD__.faceScreenPoint());
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    await adv(0.12);
    clicks.push((await st()).bsodStage);
  }
  check('each click on the face advances one glitch stage', clicks.join(',') === '1,2,3,4,5,6,7', clicks.join(','));
  await adv(0.4);
  check('stage 7 opens the portal sequence', (await st()).phase === 'absorb');
  await shot('absorb');
  // the absorb sequence runs ~4 s: portal, swap, descent, epilogue of the fall
  for (let i = 0; i < 14 && (await st()).phase !== 'world'; i++) await adv(0.5);
  s = await st();
  check('portal pulls the camera into the world without a loading cut', s.phase === 'world' && s.sequence === null, s.phase);
  check('world arrival spawn matches the designed point', Math.abs(s.player[2] - 250) < 4, JSON.stringify(s.player));
  await page.evaluate(() => window.__BSOD__.forceLock(true));
  await adv(0.3);
  await shot('world');

  /* ------------------------------------------------------------- console */
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' })));
  await page.waitForTimeout(300);
  check('C opens the recovery console', (await st()).consoleOpen === true);
  check('console input is focused', await page.evaluate(() => document.activeElement === document.getElementById('console-input')));
  const before = await st();
  await page.evaluate(() => window.__BSOD__.key('KeyW', true));
  await adv(1.0);
  await page.evaluate(() => window.__BSOD__.key('KeyW', false));
  const after = await st();
  check('console freezes player movement', Math.abs(before.player[2] - after.player[2]) < 0.02, `${before.player[2]} → ${after.player[2]}`);
  await page.focus('#console-input');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  check('Enter with an empty line reports an error, no crash', /ERR_EMPTY_INPUT/.test(await log()));
  await page.fill('#console-input', '   heLP   ');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  check('HELP lists the commands', /KNOWN NODES/.test(await log()));
  await page.fill('#console-input', 'sudo rm -rf /');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  check('SUDO is refused in-world (no shell)', /NOT AVAILABLE|ERR_/.test(await log()));
  await page.fill('#console-input', 'qwertyuiop');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  check('unknown command returns an in-world error code', /ERR_0x/.test(await log()));
  check('unknown command does not start the collapse', (await st()).phase === 'world');
  await page.fill('#console-input', 'status');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  check('STATUS answers in-world', /MEMORY INTEGRITY/.test(await log()));
  await page.evaluate(() => window.__BSOD__.game.ui.consoleClear());
  const repeat = await page.evaluate(async () => {
    const input = document.getElementById('console-input');
    input.focus();
    input.value = 'status';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const once = document.getElementById('console-log').innerText;
    input.value = 'status';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }));
    const twice = document.getElementById('console-log').innerText;
    return { once: (once.match(/> status/g) || []).length, afterRepeat: (twice.match(/> status/g) || []).length };
  });
  check('held Enter cannot double-submit a command', repeat.once === 1 && repeat.afterRepeat === 1, JSON.stringify(repeat));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check('Esc closes the console', (await st()).consoleOpen === false);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' })));
  await page.waitForTimeout(250);
  check('C opens the console again', (await st()).consoleOpen === true);
  // while the console is open the keyboard belongs to the terminal: game keys are
  // captured so that typing "c"/"f"/"e" never leaks into the world
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' })));
  await page.waitForTimeout(200);
  check('console swallows gameplay keys while open', (await st()).consoleOpen === true && (await st()).flashlight === false);
  await page.evaluate(() => window.__BSOD__.key('KeyF', true));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__BSOD__.key('KeyF', false));
  check('Esc restores play mode from the console', (await st()).consoleOpen === false && (await st()).menuOpen === false);
  await page.evaluate(() => window.__BSOD__.forceLock(true));
  await page.evaluate(() => { window.__BSOD__.game.player.enabled = true; window.__BSOD__.key('KeyW', true); });
  await adv(0.8);
  await page.evaluate(() => window.__BSOD__.key('KeyW', false));
  const diag = await page.evaluate(() => {
    const g = window.__BSOD__.game;
    return { phase: g.phase, mode: g.input.mode, locked: g.input.locked, enabled: g.player.enabled, console: g.ui.consoleVisible, menu: g.ui.menuVisible, seq: !!g.sequence };
  });
  check('movement is restored after closing the console', (await st()).player[2] < 249, `${JSON.stringify((await st()).player)} ${JSON.stringify(diag)}`);

  /* -------------------------------------------------------- world traversal */
  const traversal = await page.evaluate(() => {
    const g = window.__BSOD__.game;
    const p = g.world.physics;
    const walk = (x, y, z, yaw, frames) => {
      g.player.enabled = true;
      g.player.reset(g.player.pos.clone().set(x, y, z), yaw, 0);
      let minY = 99;
      for (let i = 0; i < frames; i++) {
        g.player.update(1 / 60, { forward: 1, strafe: 0, run: false }, p);
        minY = Math.min(minY, g.player.pos.y);
      }
      return { x: +g.player.pos.x.toFixed(1), y: +g.player.pos.y.toFixed(2), z: +g.player.pos.z.toFixed(1), minY: +minY.toFixed(2) };
    };
    return {
      ruinStairs: walk(-107.6, 0.4, 139, 0, 360),
      cityStairs: walk(127, 0.4, 145, 0, 460),
      cityInterior: walk(117, 0.3, 100, Math.PI, 460),
      bunkerDoor: walk(40, 0.3, 40, 0, 760),
      monolith: walk(0, 0.4, 30, 0, 720),
    };
  });
  check('ruin stairs climb to the 6.15 m mezzanine', traversal.ruinStairs.y > 6.0 && traversal.ruinStairs.minY > 0.2, JSON.stringify(traversal.ruinStairs));
  check('city rooftop stairs climb to the roof deck', traversal.cityStairs.y > 6.4, JSON.stringify(traversal.cityStairs));
  check('collapsed tower interior is enterable', traversal.cityInterior.z > 125, JSON.stringify(traversal.cityInterior));
  check('bunker doorway is enterable', traversal.bunkerDoor.z < -2, JSON.stringify(traversal.bunkerDoor));
  check('central monolith blocks the player', traversal.monolith.z < 1 && traversal.monolith.z > -12, JSON.stringify(traversal.monolith));

  /* -------------------------------------------------------------- flashlight */
  await page.evaluate(() => { window.__BSOD__.forceLock(true); window.__BSOD__.game.player.enabled = true; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' })); });
  await page.waitForTimeout(150);
  check('F toggles the flashlight on', (await st()).flashlight === true);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' })));
  await page.waitForTimeout(150);
  check('F toggles the flashlight off', (await st()).flashlight === false);

  /* -------------------------------------------------------------- perf HUD */
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F3' })));
  await page.waitForTimeout(500);
  const hud = await page.evaluate(() => {
    const el = document.getElementById('fps');
    return { visible: !el.classList.contains('hidden'), text: el.innerText };
  });
  check('F3 shows the performance overlay (opt-in)', hud.visible && /FPS/.test(hud.text), hud.text.replace(/\s+/g, ' ').slice(0, 60));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F3' })));

  /* ------------------------------------------------------------------ WAKE_UP */
  await page.evaluate(() => window.__BSOD__.useConsole());
  await page.waitForTimeout(200);
  await page.fill('#console-input', 'wake_up');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  s = await st();
  check('WAKE_UP closes the console and starts the collapse', s.consoleOpen === false && s.phase === 'collapse' && s.sequence === 'collapse');
  const lockedFrom = (await st()).player;
  await page.evaluate(() => window.__BSOD__.key('KeyW', true));
  await adv(1.5);
  await page.evaluate(() => window.__BSOD__.key('KeyW', false));
  const lockedTo = (await st()).player;
  check('cinematic locks the player', Math.hypot(lockedFrom[0] - lockedTo[0], lockedFrom[2] - lockedTo[2]) < 0.02);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })));
  await page.waitForTimeout(150);
  check('Esc cannot interrupt the cinematic', (await st()).menuOpen === false);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' })));
  await page.waitForTimeout(150);
  check('C cannot open the console mid-cinematic', (await st()).consoleOpen === false);
  await adv(3.0);
  await shot('fall');
  for (let i = 0; i < 40 && (await st()).phase !== 'epilogue'; i++) await adv(0.5);
  s = await st();
  check('collapse lands back in the bedroom (epilogue)', s.phase === 'epilogue' && s.epilogue === true, s.phase);
  check('player stands in the room after landing', Math.abs(s.player[2] - 1.45) < 1.2, JSON.stringify(s.player));
  await adv(0.5);
  await page.evaluate(() => window.__BSOD__.forceLock(true));
  await page.evaluate(() => window.__BSOD__.key('KeyW', true));
  await adv(1.0);
  await page.evaluate(() => window.__BSOD__.key('KeyW', false));
  s = await st();
  check('controls are restored in the epilogue', Math.abs(s.player[2] - 1.45) > 0.05, JSON.stringify(s.player));
  check('an anomaly remains after the fall', await page.evaluate(() => window.__BSOD__.game.room.epilogueGroup.children.length > 0));

  /* ---------------------------------------------------------------- restart */
  await page.evaluate(() => window.__BSOD__.game.restart());
  await adv(0.5);
  s = await st();
  check('restart returns to the first bedroom frame', s.phase === 'room' && s.bsodStage === 0 && s.epilogue === false);
  check('restart resets the player position', Math.abs(s.player[2] - 1.95) < 0.25, JSON.stringify(s.player));
  check('restart clears collapse debris from the world', await page.evaluate(() => window.__BSOD__.game.world.dynamicGroup.children.length === 0));

  /* ------------------------------------------------------------- flash safety */
  const flash = await page.evaluate(() => {
    const fx = window.__BSOD__.game.fx;
    let accepted = 0;
    for (let i = 0; i < 20; i++) {
      const before = fx.grade.uniforms.flash.value;
      fx.flash(1.2);
      if (fx.grade.uniforms.flash.value > before) accepted++;
    }
    return { accepted, peak: fx.grade.uniforms.flash.value };
  });
  check('flash budget caps bursts at 3 per second', flash.accepted <= 3, JSON.stringify(flash));
  check('flash peak is capped below full white', flash.peak <= 0.62, String(flash.peak));

  /* ------------------------------------------------------------ debug gating */
  const phaseBeforeF9 = (await st()).phase;
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F9' })));
  await page.waitForTimeout(200);
  check('F9 phase jump works behind ?debug=1', (await st()).phase !== phaseBeforeF9, `${phaseBeforeF9} → ${(await st()).phase}`);

  await page.goto(`${base}?manual=1&quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__BSOD__ && window.__BSOD__.state, { timeout: 240000 });
  await page.click('#start-btn');
  await adv(0.5);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F9' })));
  await adv(0.5);
  check('F9 does nothing without ?debug=1', (await st()).phase === 'room');
  check('debug API is namespaced and does not leak into UI', await page.evaluate(() => !!window.__BSOD__ && !document.body.innerText.includes('__BSOD__')));

  /* -------------------------------------------------------------- benchmark */
  if (flag('bench')) {
    console.log('\nbench: visiting every phase via ?phase= …');
    const rows = [];
    for (const phase of ['room', 'bsod', 'world', 'collapse', 'epilogue']) {
      await page.goto(`${base}?phase=${phase}&manual=1&quality=medium`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__BSOD__ && window.__BSOD__.state, { timeout: 240000 });
      await page.waitForTimeout(2500);
      const row = await page.evaluate(async () => {
        const g = window.__BSOD__.game;
        const times = [];
        for (let i = 0; i < 90; i++) {
          const t0 = performance.now();
          g.update(1 / 60);
          g.fx.render();
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        return {
          phase: g.phase,
          calls: g.renderer.info.render.calls,
          tris: g.renderer.info.render.triangles,
          medianMs: +times[Math.floor(times.length / 2)].toFixed(1),
          p99Ms: +times[Math.floor(times.length * 0.99)].toFixed(1),
          scale: g.fx.renderScale,
        };
      });
      rows.push(row);
      console.log(`  ${row.phase.padEnd(9)} calls ${String(row.calls).padStart(4)}  tris ${String(row.tris).padStart(7)}  median ${row.medianMs} ms  p99 ${row.p99Ms} ms  renderScale ${row.scale}`);
    }
    check('every phase renders without throwing', rows.length === 5);
  }

  const uniqueErrors = [...new Set(pageErrors)].filter((e) => !/AudioContext|autoplay|WebGL: INVALID|GPU stall|deprecated/i.test(e));
  check('no uncaught runtime errors', uniqueErrors.length === 0, uniqueErrors.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('failed:');
    for (const f of failed) console.log(` - ${f.name} ${f.extra}`);
  }
  await browser.close();
  if (server) server.kill('SIGTERM');
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  if (server) server.kill('SIGTERM');
  process.exit(1);
});
