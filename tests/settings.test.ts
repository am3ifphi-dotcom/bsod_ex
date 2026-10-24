// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Settings, SETTINGS_DEFAULTS } from '../src/core/Settings';

const KEY = 'bsod-ex.settings.v1';

describe('settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts from the defaults', () => {
    const s = new Settings();
    expect(s.data.sensitivity).toBe(SETTINGS_DEFAULTS.sensitivity);
    expect(s.data.fov).toBe(SETTINGS_DEFAULTS.fov);
    expect(s.data.showPerf).toBe(false);
  });

  it('clamps mouse sensitivity to the documented 0.2–3.0 range', () => {
    const s = new Settings();
    s.set('sensitivity', 12);
    expect(s.data.sensitivity).toBe(3);
    s.set('sensitivity', -4);
    expect(s.data.sensitivity).toBe(0.2);
    s.set('sensitivity', 1.75);
    expect(s.data.sensitivity).toBeCloseTo(1.75, 5);
  });

  it('clamps volume, glitch and FOV', () => {
    const s = new Settings();
    s.set('volume', 2);
    expect(s.data.volume).toBe(1);
    s.set('glitch', -1);
    expect(s.data.glitch).toBe(0);
    s.set('fov', 120);
    expect(s.data.fov).toBe(95);
    s.set('fov', 10);
    expect(s.data.fov).toBe(60);
  });

  it('persists to localStorage and reloads', () => {
    const a = new Settings();
    a.set('sensitivity', 2.25);
    a.set('quality', 'high');
    a.set('showPerf', true);
    const raw = JSON.parse(localStorage.getItem(KEY) as string);
    expect(raw.sensitivity).toBeCloseTo(2.25, 5);
    expect(raw.quality).toBe('high');

    const b = new Settings();
    expect(b.data.sensitivity).toBeCloseTo(2.25, 5);
    expect(b.data.quality).toBe('high');
    expect(b.data.showPerf).toBe(true);
  });

  it('ignores corrupt stored data instead of throwing', () => {
    localStorage.setItem(KEY, '{not json');
    const s = new Settings();
    expect(s.data.sensitivity).toBe(1);
    localStorage.setItem(KEY, JSON.stringify({ quality: 'ultra', fov: 'wide', volume: 99 }));
    const t = new Settings();
    expect(['low', 'medium', 'high']).toContain(t.data.quality);
    expect(t.data.fov).toBe(74);
    expect(t.data.volume).toBe(1);
  });

  it('notifies subscribers on change', () => {
    const s = new Settings();
    const seen: string[] = [];
    const off = s.onChange((k) => seen.push(String(k)));
    s.set('sensitivity', 2);
    off();
    s.set('volume', 0.5);
    expect(seen).toEqual(['sensitivity']);
  });
});
