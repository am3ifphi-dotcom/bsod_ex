/**
 * User settings: persisted, clamped, and applied live (sensitivity takes effect on the very
 * next mouse event, so dragging the slider while playing feels immediate).
 */

export type QualityPreset = 'low' | 'medium' | 'high';

export interface SettingsData {
  sensitivity: number;      // 0.2 .. 3.0 (multiplier on a base 0.0022 rad/px)
  volume: number;           // 0 .. 1
  glitch: number;           // 0 .. 1  (post-process glitch intensity scale)
  cameraMotion: number;     // 0 .. 1  (head bob + shake + forced camera sway)
  quality: QualityPreset;
  fov: number;              // 60 .. 95
  showPerf: boolean;
}

const KEY = 'bsod-ex.settings.v1';

export const SETTINGS_DEFAULTS: SettingsData = {
  sensitivity: 1,
  volume: 0.85,
  glitch: 0.85,
  cameraMotion: 1,
  quality: 'medium',
  fov: 74,
  showPerf: false,
};

export function detectDefaultQuality(): QualityPreset {
  try {
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const cores = navigator.hardwareConcurrency ?? 8;
    if (mobile || cores <= 4 || mem <= 4) return 'low';
    if (cores >= 12) return 'high';
    return 'medium';
  } catch {
    return 'medium';
  }
}

export const SETTINGS_RANGES: Record<string, { min: number; max: number; step: number }> = {
  sensitivity: { min: 0.2, max: 3.0, step: 0.05 },
  volume: { min: 0, max: 1, step: 0.01 },
  glitch: { min: 0, max: 1, step: 0.01 },
  cameraMotion: { min: 0, max: 1, step: 0.01 },
  fov: { min: 60, max: 95, step: 1 },
};

export class Settings {
  data: SettingsData;
  private listeners = new Set<(key: keyof SettingsData, value: number | string | boolean) => void>();

  constructor() {
    this.data = { ...SETTINGS_DEFAULTS, quality: detectDefaultQuality() };
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SettingsData>;
      for (const key of Object.keys(SETTINGS_DEFAULTS) as (keyof SettingsData)[]) {
        const value = parsed[key];
        if (value === undefined) continue;
        if (typeof SETTINGS_DEFAULTS[key] === 'number') {
          const range = SETTINGS_RANGES[key as string];
          if (typeof value !== 'number' || !Number.isFinite(value)) continue;
          (this.data[key] as number) = range
            ? Math.min(range.max, Math.max(range.min, value))
            : value;
        } else if (typeof SETTINGS_DEFAULTS[key] === 'boolean') {
          if (typeof value === 'boolean') (this.data[key] as boolean) = value;
        } else if (typeof value === 'string') {
          if (key === 'quality' && ['low', 'medium', 'high'].includes(value as string)) {
            this.data.quality = value as QualityPreset;
          }
        }
      }
    } catch { /* corrupt storage is not fatal */ }
  }

  save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ }
  }

  onChange(fn: (key: keyof SettingsData, value: number | string | boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    const def = SETTINGS_DEFAULTS[key];
    if (typeof def === 'number') {
      const range = SETTINGS_RANGES[key as string];
      let v = Number(value);
      if (!Number.isFinite(v)) v = def as number;
      if (range) v = Math.min(range.max, Math.max(range.min, v));
      this.data[key] = v as SettingsData[K];
    } else if (typeof def === 'boolean') {
      this.data[key] = Boolean(value) as SettingsData[K];
    } else {
      this.data[key] = value;
    }
    this.save();
    for (const fn of this.listeners) fn(key, this.data[key] as number | string | boolean);
  }

  reset(): void {
    const quality = detectDefaultQuality();
    this.data = { ...SETTINGS_DEFAULTS, quality };
    this.save();
    for (const key of Object.keys(this.data) as (keyof SettingsData)[]) {
      for (const fn of this.listeners) fn(key, this.data[key] as number | string | boolean);
    }
  }
}
