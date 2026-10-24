/**
 * ベンチマーク(?benchmark=1): 全フェーズを自動で通し、平均fps / 1% low を計測する。
 * 通常プレイでは使用しない。
 */
import * as THREE from 'three';
import type { Game } from './game';
import { VOID_Y, wastelandHeight } from '../world/voidWorld';

export interface BenchmarkResult {
  seconds: number;
  avgFps: number;
  onePercentLowFps: number;
  minFps: number;
  samples: number;
  notes: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class BenchmarkRunner {
  constructor(private game: Game) {}

  async run(): Promise<BenchmarkResult> {
    const g = this.game;
    g.hud.resetStats();
    const t0 = performance.now();

    // --- 部屋: 見回して机へ ---
    await this.drive([
      { t: 2, look: [0.2, -0.05], walk: [0, 0, 0] },
      { t: 3, look: [1.2, -0.1], walk: [0, 0, -1] },
      { t: 3, look: [-1.0, 0.05], walk: [0, 0, -1] },
      { t: 2, look: [0.06, -0.04], walk: [0, 0, 0] },
    ]);

    // --- BSOD: のぞき込み → 連打 ---
    g.benchBeginLean();
    await sleep(1800);
    for (let i = 0; i < 8; i++) {
      g.handleScreenClick(window.innerWidth * 0.25, window.innerHeight * 0.45);
      await sleep(420);
    }
    // swallow 中は運転しない(演出がカメラを動かす) ~7s
    await sleep(8200);
    await sleep(2600); // voidIntro

    // --- 異世界: 各エリアを実歩行で測定 ---
    const areas: [number, number][] = [
      [0, -6],       // 到着
      [6, -120],     // 道中
      [34, -220],    // 崩壊建築(立体ホール)
      [110, -220],   // 橋・都市入口
      [140, -250],   // 都市
      [-120, -230],  // 深層
      [0, -380],     // 中心構造物手前
    ];
    for (const [x, z] of areas) {
      const y = wastelandHeight(x, z) + VOID_Y;
      g.benchTeleport(x, y + 1.62, z);
      // 360度見回しつつ前進
      await this.drive([
        { t: 1.2, look: [0, -0.05], walk: [0, 0, 0] },
        { t: 1.6, look: [1.4, -0.05], walk: [0, 0, -1] },
        { t: 1.6, look: [-1.4, 0.1], walk: [0, 0, -1] },
        { t: 1.2, look: [0, -0.3], walk: [0, 0, 0] },
      ]);
    }

    // --- コンソール → WAKE_UP ---
    g.benchOpenConsole();
    await sleep(600);
    g.benchExec('wake_up');
    await sleep(1400);
    // collapse + fall + landing (~22s)
    await sleep(24000);

    // --- 帰還後 ---
    await this.drive([
      { t: 2, look: [0.1, -0.05], walk: [0, 0, 0] },
      { t: 2.5, look: [-1.2, 0], walk: [0, 0, -1] },
      { t: 2.5, look: [1.2, -0.1], walk: [0, 0, -1] },
      { t: 1.5, look: [0.1, -0.05], walk: [0, 0, 0] },
    ]);

    const seconds = (performance.now() - t0) / 1000;
    const stats = g.stats;
    return {
      seconds,
      avgFps: stats.avgFps,
      onePercentLowFps: stats.onePercentLowFps,
      minFps: stats.minFps,
      samples: stats.samples,
      notes: '自動通しプレイ(room→bsod→swallow→void全エリア→console→collapse→fall→return)の実測。描画負荷の参考値。',
    };
  }

  /** 指定時間、ルックと移動を連続適用 */
  private async drive(segments: { t: number; look: [number, number]; walk: [number, number, number] }[]): Promise<void> {
    for (const seg of segments) {
      this.game.benchSetLook(seg.look[0], seg.look[1]);
      this.game.benchSetWalk(seg.walk[0], seg.walk[1], seg.walk[2]);
      await sleep(seg.t * 1000);
    }
    this.game.benchSetWalk(0, 0, 0);
  }
}
