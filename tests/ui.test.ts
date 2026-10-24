// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../src/core/Settings';
import { Ui, type UiCallbacks } from '../src/ui/Ui';

function loadMarkup(): void {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
}

function makeUi() {
  const settings = new Settings();
  const ui = new Ui(settings);
  const cbs: UiCallbacks = {
    onStart: vi.fn(),
    onResume: vi.fn(),
    onRestart: vi.fn(),
    onQuitToTitle: vi.fn(),
    onSettingsChange: vi.fn(),
    onConsoleCommand: vi.fn(),
    onConsoleClose: vi.fn(),
    onBsodClick: vi.fn(),
    onRequestLock: vi.fn(),
  };
  ui.setCallbacks(cbs);
  return { ui, settings, cbs };
}

function key(el: HTMLElement, k: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  el.dispatchEvent(ev);
  return ev;
}

describe('UI overlays', () => {
  beforeAll(() => { loadMarkup(); });
  beforeEach(() => {
    loadMarkup();
    localStorage.clear();
  });

  it('renders the title screen with the accessibility warning and start button', () => {
    const { ui, cbs } = makeUi();
    ui.showTitle();
    expect(ui.titleVisible).toBe(true);
    const title = document.querySelector('#title-screen') as HTMLElement;
    expect(title.textContent).toContain('ちらつき');
    expect(title.textContent).toContain('WASD');
    (document.querySelector('#btn-start') as HTMLButtonElement).click();
    expect(cbs.onStart).toHaveBeenCalledTimes(1);
    (document.querySelector('#btn-title-credits') as HTMLButtonElement).click();
    expect(ui.isCreditsOpen).toBe(true);
    ui.hideTitle();
    expect(ui.titleVisible).toBe(false);
  });

  it('grows the BSOD overlay through six stages and reports clicks', () => {
    const { ui, cbs } = makeUi();
    ui.showBsod(true);
    expect(ui.bsodVisible).toBe(true);
    for (const stage of [1, 2, 3, 4, 5, 6]) {
      ui.setBsodStage(stage);
      const el = document.querySelector('#bsod') as HTMLElement;
      expect(el.className).toContain(`glitch-${Math.min(5, stage)}`);
      if (stage >= 4) expect(el.textContent).toContain('LOOK AT ME');
    }
    const shardCount = document.querySelectorAll('#bsod .shard').length;
    expect(shardCount).toBeGreaterThan(10);
    (document.querySelector('#bsod-face') as HTMLElement).click();
    expect(cbs.onBsodClick).toHaveBeenCalled();
    ui.showBsod(false);
    expect(ui.bsodVisible).toBe(false);
  });

  it('positions the BSOD overlay over the projected screen rect', () => {
    const { ui } = makeUi();
    ui.showBsod(true);
    ui.setBsodRect(100, 50, 320, 180);
    const el = document.querySelector('#bsod') as HTMLElement;
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('50px');
    expect(el.style.width).toBe('320px');
    expect(el.style.height).toBe('180px');
  });

  it('handles console input: IME guard, history, and closing rules', () => {
    const { ui, cbs } = makeUi();
    ui.openConsole();
    expect(ui.isConsoleOpen).toBe(true);
    const input = document.querySelector('#console-input') as HTMLInputElement;

    // IME composition: Enter must not submit
    input.value = 'めざめ';
    const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(composing, 'isComposing', { value: true });
    input.dispatchEvent(composing);
    expect(cbs.onConsoleCommand).not.toHaveBeenCalled();

    // normal Enter submits and clears
    input.value = 'wake_up';
    key(input, 'Enter');
    expect(cbs.onConsoleCommand).toHaveBeenCalledWith('wake_up');
    expect(input.value).toBe('');

    // history
    input.value = 'help';
    key(input, 'Enter');
    key(input, 'ArrowUp');
    expect(input.value).toBe('help');
    key(input, 'ArrowUp');
    expect(input.value).toBe('wake_up');
    key(input, 'ArrowDown');
    expect(input.value).toBe('help');

    // a plain "c" must stay typeable ("cat", "clear"), only Esc / Ctrl+C close
    input.value = '';
    key(input, 'c');
    expect(ui.isConsoleOpen).toBe(true);
    input.value = 'cat notes.txt';
    key(input, 'c');
    expect(ui.isConsoleOpen).toBe(true);

    const ctrlC = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(ctrlC);
    expect(ui.isConsoleOpen).toBe(false);
    expect(cbs.onConsoleClose).toHaveBeenCalledTimes(1);

    // Esc also closes
    ui.openConsole();
    key(input, 'Escape');
    expect(ui.isConsoleOpen).toBe(false);
  });

  it('prints console lines with classes and scrolls', () => {
    const { ui } = makeUi();
    ui.openConsole();
    ui.consoleClear();
    ui.consolePrint('> run', 'cmd');
    ui.consolePrint('0x000000EF', 'err');
    const log = document.querySelector('#console-log') as HTMLElement;
    expect(log.children.length).toBe(2);
    expect(log.querySelector('.err')?.textContent).toBe('0x000000EF');
    ui.consoleSetEnabled(false);
    expect((document.querySelector('#console-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('applies menu settings live and exposes every required control', () => {
    const { ui, settings, cbs } = makeUi();
    ui.openMenu(false);
    expect(ui.isMenuOpen).toBe(true);
    const sens = document.querySelector('#set-sens') as HTMLInputElement;
    expect(sens.min).toBe('0.2');
    expect(sens.max).toBe('3');
    sens.value = '2.4';
    sens.dispatchEvent(new Event('input'));
    expect(settings.data.sensitivity).toBeCloseTo(2.4, 5);
    expect(cbs.onSettingsChange).toHaveBeenCalledWith('sensitivity', 2.4);
    expect(document.querySelector('#val-sens')?.textContent).toBe('2.40');

    const glitch = document.querySelector('#set-glitch') as HTMLInputElement;
    glitch.value = '0';
    glitch.dispatchEvent(new Event('input'));
    expect(settings.data.glitch).toBe(0);

    const quality = document.querySelector('#set-quality') as HTMLSelectElement;
    quality.value = 'high';
    quality.dispatchEvent(new Event('change'));
    expect(settings.data.quality).toBe('high');
    expect(cbs.onSettingsChange).toHaveBeenCalledWith('quality', 'high');

    const perf = document.querySelector('#set-f3') as HTMLSelectElement;
    perf.value = 'on';
    perf.dispatchEvent(new Event('change'));
    expect(settings.data.showPerf).toBe(true);

    (document.querySelector('#btn-resume') as HTMLButtonElement).click();
    expect(ui.isMenuOpen).toBe(false);
    expect(cbs.onResume).toHaveBeenCalled();
  });

  it('offers restart, quit and credits from the menu', () => {
    const { ui, cbs } = makeUi();
    ui.openMenu(false);
    (document.querySelector('#btn-credits') as HTMLButtonElement).click();
    expect(ui.isCreditsOpen).toBe(true);
    (document.querySelector('#btn-credits-back') as HTMLButtonElement).click();
    expect(ui.isCreditsOpen).toBe(false);

    ui.openMenu(false);
    (document.querySelector('#btn-restart') as HTMLButtonElement).click();
    expect(cbs.onRestart).toHaveBeenCalledTimes(1);

    ui.openMenu(false);
    (document.querySelector('#btn-quit') as HTMLButtonElement).click();
    expect(cbs.onQuitToTitle).toHaveBeenCalledTimes(1);
  });

  it('shows a minimal HUD: reticle + prompt only', () => {
    const { ui } = makeUi();
    ui.setHudVisible(true);
    ui.setPrompt('PCを調べる');
    const prompt = document.querySelector('#prompt') as HTMLElement;
    expect(prompt.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('#prompt-text')?.textContent).toBe('PCを調べる');
    ui.setPrompt(null);
    expect(prompt.classList.contains('hidden')).toBe(true);
    ui.setHudVisible(false);
    expect(document.querySelector('#hud')?.classList.contains('hidden')).toBe(true);
  });

  it('keeps the perf monitor hidden by default and formats stats', () => {
    const { ui } = makeUi();
    expect(ui.isPerfVisible).toBe(false);
    expect(document.querySelector('#perf')?.classList.contains('hidden')).toBe(true);
    ui.setPerfVisible(true);
    ui.setPerf(
      { fps: 59.4, avgFps: 58.2, low1: 44.1, frameMs: 16.9, drawCalls: 812, triangles: 1_240_000, scale: 0.9 },
      { phase: 'world', pos: '0 120 20', quality: 'high' },
    );
    const text = document.querySelector('#perf')?.textContent ?? '';
    expect(text).toContain('59');
    expect(text).toContain('44');
    expect(text).toContain('world');
  });

  it('fades to black and back, and resolves its promise', async () => {
    const { ui } = makeUi();
    ui.setFadeInstant(true);
    const el = document.querySelector('#fade') as HTMLElement;
    expect(el.style.opacity).toBe('1');
    ui.setFadeInstant(false);
    expect(el.style.opacity).toBe('0');
    const t0 = Date.now();
    await ui.fade(true, 60);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
    expect(el.style.opacity).toBe('1');
  });

  it('shows the crash screen with an error', () => {
    const { ui } = makeUi();
    ui.showCrashScreen();
    expect(document.querySelector('#crash-screen')?.textContent).toContain('The room has stopped responding');
    ui.hideCrashScreen();
    expect(document.querySelector('#crash-screen')?.classList.contains('hidden')).toBe(true);
  });
});
