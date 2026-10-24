/**
 * レンダリングエンジン: WebGL2 / ACES / HDR リニア / 動的解像度
 */
import * as THREE from 'three';
import { SettingsStore, qualityParams, QualityParams } from './settings';
import { PostChain } from '../fx/post';
import { clamp } from './utils';

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly clock = new THREE.Clock();
  post: PostChain;
  quality: QualityParams;

  /** 動的解像度スケール */
  renderScale = 1.0;
  private fpsSamples: number[] = [];
  private elapsed = 0;

  constructor(container: HTMLElement, public settings: SettingsStore) {
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // composer経由で処理
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    if (!renderer.capabilities.isWebGL2) {
      throw new Error('WEBGL2_REQUIRED');
    }
    this.renderer = renderer;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 1400);
    this.camera.position.set(0, 1.62, 0);

    this.quality = qualityParams(settings.data.quality);
    this.applyQuality();

    this.post = new PostChain(this);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  applyQuality(): void {
    const q = qualityParams(this.settings.data.quality);
    this.quality = q;
    this.renderer.shadowMap.enabled = q.shadows;
    // シャドウマップ解像度の変更を即時反映
    this.scene.traverse((o) => {
      const light = o as THREE.Light & { shadow?: THREE.LightShadow & { mapSize: THREE.Vector2; map: THREE.WebGLRenderTarget | null } };
      if (light.isLight && light.shadow) {
        light.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        if (light.shadow.map) {
          light.shadow.map.dispose();
          light.shadow.map = null;
        }
      }
    });
    this.post?.applyQuality(q);
    this.onResize();
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap) * this.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h, dpr);
  };

  /** 動的解像度: フレーム時間を見てスケール調整 */
  tickDynamicResolution(dt: number): void {
    this.elapsed += dt;
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length > 90) this.fpsSamples.shift();
    if (this.elapsed < 0.8) return;
    this.elapsed = 0;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, this.fpsSamples.length);
    const fps = 1 / Math.max(0.0001, avg);
    if (fps < 52 && this.renderScale > 0.55) {
      this.renderScale = clamp(this.renderScale - 0.07, 0.55, 1);
      this.onResize();
    } else if (fps > 59 && this.renderScale < 1) {
      this.renderScale = clamp(this.renderScale + 0.035, 0.55, 1);
      this.onResize();
    }
  }

  render(dt: number): void {
    this.post.render(dt);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.post.dispose();
    this.renderer.dispose();
  }
}
