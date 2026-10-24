// User settings + graphics quality presets. Persisted in localStorage.

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number;   // 0.2 .. 3.0
  volume: number;        // 0 .. 1
  glitch: number;        // 0 .. 1  (glitch effect intensity)
  shake: number;         // 0 .. 1  (camera shake / head bob)
  quality: Quality;
  resScale: number;      // manual render scale 0.5 .. 1.5
  dynamicRes: boolean;
}

export const defaultSettings: Settings = {
  sensitivity: 1,
  volume: 0.8,
  glitch: 0.75,
  shake: 0.8,
  quality: 'high',
  resScale: 1,
  dynamicRes: true,
};

export interface QualityPreset {
  shadowSize: number;
  gtao: boolean;
  gtaoSamples: number;
  bloom: boolean;
  bloomStrength: number;
  bloomRes: number;
  dof: boolean;
  anisotropy: number;
  pixelRatioCap: number;
  grain: number;
  lights: number;
  samples: number;
  shadowDistance: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: {
    shadowSize: 512, gtao: false, gtaoSamples: 8, bloom: true, bloomStrength: 0.42, bloomRes: 0.35,
    dof: false, anisotropy: 2, pixelRatioCap: 1, grain: 1, lights: 6, shadowDistance: 26, samples: 0,
  },
  medium: {
    shadowSize: 1024, gtao: true, gtaoSamples: 12, bloom: true, bloomStrength: 0.55, bloomRes: 0.5,
    dof: true, anisotropy: 4, pixelRatioCap: 1.25, grain: 1, lights: 9, shadowDistance: 38, samples: 2,
  },
  high: {
    shadowSize: 2048, gtao: true, gtaoSamples: 16, bloom: true, bloomStrength: 0.62, bloomRes: 0.5,
    dof: true, anisotropy: 8, pixelRatioCap: 1.5, grain: 1, lights: 12, shadowDistance: 52, samples: 4,
  },
};

const KEY = 'bsod_ex.settings.v1';

export class SettingsStore {
  value: Settings;
  private listeners = new Set<(s: Settings, changed: (keyof Settings)[]) => void>();

  constructor() {
    this.value = { ...defaultSettings };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        this.value = { ...this.value, ...parsed };
        // guard against hand-edited / corrupt storage
        this.value.sensitivity = clampNum(this.value.sensitivity, 0.2, 3);
        this.value.volume = clampNum(this.value.volume, 0, 1);
        this.value.glitch = clampNum(this.value.glitch, 0, 1);
        this.value.shake = clampNum(this.value.shake, 0, 1);
        this.value.resScale = clampNum(this.value.resScale, 0.5, 1.5);
        if (!QUALITY[this.value.quality]) this.value.quality = 'high';
      }
    } catch { /* ignore */ }
  }

  get preset(): QualityPreset { return QUALITY[this.value.quality]; }

  set(patch: Partial<Settings>) {
    const changed: (keyof Settings)[] = [];
    for (const k of Object.keys(patch) as (keyof Settings)[]) {
      if (patch[k] !== undefined && this.value[k] !== patch[k]) {
        (this.value as any)[k] = patch[k];
        changed.push(k);
      }
    }
    if (!changed.length) return;
    try { localStorage.setItem(KEY, JSON.stringify(this.value)); } catch { /* quota */ }
    this.listeners.forEach((l) => l(this.value, changed));
  }

  onChange(fn: (s: Settings, changed: (keyof Settings)[]) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

function clampNum(v: number, a: number, b: number) {
  return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a;
}

export const settings = new SettingsStore();
