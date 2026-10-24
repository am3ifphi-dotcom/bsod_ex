/** 設定値と永続化 */

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  sensitivity: number; // 0.2 .. 3.0
  masterVolume: number; // 0 .. 1
  glitchIntensity: number; // 0 .. 1 (安全配慮: 下げられる)
  shake: number; // 0 .. 1 カメラ揺れ/ヘッドボブ
  quality: QualityPreset;
}

const STORAGE_KEY = 'bsod_ex_settings_v1';

export const defaultSettings: Settings = {
  sensitivity: 1.0,
  masterVolume: 0.8,
  glitchIntensity: 0.7,
  shake: 0.7,
  quality: 'high',
};

export type SettingsListener = (s: Settings, changed: keyof Settings | 'all') => void;

export class SettingsStore {
  readonly data: Settings;
  private listeners: SettingsListener[] = [];

  constructor() {
    let loaded: Partial<Settings> = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    this.data = { ...defaultSettings, ...loaded };
    // 範囲の正規化
    this.data.sensitivity = clampN(this.data.sensitivity, 0.2, 3.0);
    this.data.masterVolume = clampN(this.data.masterVolume, 0, 1);
    this.data.glitchIntensity = clampN(this.data.glitchIntensity, 0, 1);
    this.data.shake = clampN(this.data.shake, 0, 1);
    if (!['low', 'medium', 'high', 'ultra'].includes(this.data.quality)) this.data.quality = 'high';
  }

  set<K extends keyof Settings>(key: K, value: Settings[K], persist = true): void {
    if (this.data[key] === value) return;
    (this.data as unknown as Record<string, unknown>)[key] = value;
    if (persist) this.save();
    for (const l of this.listeners) l(this.data, key);
  }

  onChange(l: SettingsListener): void {
    this.listeners.push(l);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }
}

function clampN(v: number, a: number, b: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return a;
  return n < a ? a : n > b ? b : n;
}

export interface QualityParams {
  shadowMapSize: number;
  shadows: boolean;
  ssao: boolean;
  bloom: boolean;
  dof: boolean;
  pixelRatioCap: number;
  terrainSegments: number;
  debrisCount: number;
  glyphCount: number;
  fogDensity: number;
  antialias: boolean;
}

export function qualityParams(q: QualityPreset): QualityParams {
  switch (q) {
    case 'low':
      return {
        shadowMapSize: 512, shadows: true, ssao: false, bloom: true, dof: false,
        pixelRatioCap: 0.85, terrainSegments: 96, debrisCount: 120, glyphCount: 160,
        fogDensity: 0.012, antialias: false,
      };
    case 'medium':
      return {
        shadowMapSize: 1024, shadows: true, ssao: false, bloom: true, dof: true,
        pixelRatioCap: 1.0, terrainSegments: 128, debrisCount: 220, glyphCount: 320,
        fogDensity: 0.011, antialias: false,
      };
    case 'high':
      return {
        shadowMapSize: 2048, shadows: true, ssao: true, bloom: true, dof: true,
        pixelRatioCap: 1.25, terrainSegments: 160, debrisCount: 320, glyphCount: 480,
        fogDensity: 0.01, antialias: true,
      };
    case 'ultra':
      return {
        shadowMapSize: 2048, shadows: true, ssao: true, bloom: true, dof: true,
        pixelRatioCap: 1.5, terrainSegments: 200, debrisCount: 460, glyphCount: 640,
        fogDensity: 0.0095, antialias: true,
      };
  }
}
