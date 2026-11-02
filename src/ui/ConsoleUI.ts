import { AudioManager } from '../audio/AudioManager';

export class ConsoleUI {
  private readonly modalEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly formEl: HTMLFormElement;
  private readonly inputEl: HTMLInputElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly telemetryEl: HTMLElement | null;

  public isOpen = false;
  public locked = false;
  private wrongAttemptCount = 0;
  private coreUnlocked = false;
  private coreDistanceM = 88;
  private playerCoords = { x: 0, y: 0, z: 32 };
  private hijackTimeout: number | null = null;
  private successTimeouts: number[] = [];
  private readonly cmdHistory: string[] = [];
  private historyIdx = -1;

  public onCloseRequest?: () => void;
  public onWrongCommand?: (cmd: string) => void;
  public onWakeUpCommand?: () => void;
  public onScanCommand?: () => void;
  public onGlitchCommand?: () => void;

  private static readonly KNOWN_COMMANDS = [
    'HELP',
    'SCAN',
    'DUMP',
    'TRACE',
    'GLITCH',
    'STATUS',
    'PS',
    'CLEAR',
    'WAKE_UP',
  ];

  constructor(private readonly audio: AudioManager) {
    this.modalEl = document.getElementById('console-modal')!;
    this.logEl = document.getElementById('console-log')!;
    this.formEl = document.getElementById('console-form') as HTMLFormElement;
    this.inputEl = document.getElementById('console-input') as HTMLInputElement;
    this.closeBtn = document.getElementById('console-close-btn') as HTMLButtonElement;
    this.telemetryEl = document.getElementById('console-telemetry');

    const chipsContainer = document.getElementById('console-quick-chips') as HTMLElement | null;
    if (chipsContainer && typeof chipsContainer.querySelectorAll === 'function') {
      const buttons = chipsContainer.querySelectorAll('button[data-cmd]');
      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          if (this.locked) return;
          const cmd = btn.getAttribute('data-cmd') ?? '';
          if (!cmd) return;
          this.audio.playKeystroke();
          this.inputEl.value = '';
          this.handleCommand(cmd);
          this.inputEl.focus();
        });
      });
    }

    this.printBootBanner();

    this.closeBtn.addEventListener('click', () => {
      if (!this.locked) this.close(true);
    });

    this.modalEl.addEventListener('mousedown', (e) => {
      if (e.target === this.modalEl && !this.locked) {
        this.close(true);
      }
    });

    this.inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!this.locked) this.close(true);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const cur = this.inputEl.value.trim().toUpperCase().replace(/[\s-]+/g, '_');
        if (cur.length > 0) {
          const match = ConsoleUI.KNOWN_COMMANDS.find((c) => c.startsWith(cur));
          if (match) {
            this.inputEl.value = match;
            this.audio.playKeystroke();
          }
        } else {
          this.inputEl.value = 'WAKE_UP';
          this.audio.playKeystroke();
        }
        return;
      }
      if (e.key === 'ArrowUp' && this.cmdHistory.length > 0) {
        e.preventDefault();
        this.historyIdx = Math.max(0, this.historyIdx - 1);
        this.inputEl.value = this.cmdHistory[this.historyIdx] ?? '';
        this.audio.playKeystroke();
        return;
      }
      if (e.key === 'ArrowDown' && this.cmdHistory.length > 0) {
        e.preventDefault();
        this.historyIdx = Math.min(this.cmdHistory.length, this.historyIdx + 1);
        this.inputEl.value = this.cmdHistory[this.historyIdx] ?? '';
        this.audio.playKeystroke();
        return;
      }
      if (e.key.length === 1 || e.key === 'Backspace') {
        this.audio.playKeystroke();
      }
    });

    this.formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.locked) return;
      const raw = this.inputEl.value.trim();
      this.inputEl.value = '';
      this.handleCommand(raw);
    });
  }

  public setWorldState(
    coreRevealed: boolean,
    distToCore: number,
    coords?: { x: number; y: number; z: number }
  ): void {
    this.coreUnlocked = coreRevealed;
    this.coreDistanceM = distToCore;
    if (coords) {
      this.playerCoords.x = coords.x;
      this.playerCoords.y = coords.y;
      this.playerCoords.z = coords.z;
    }
    this.refreshTelemetryBar();
  }

  private refreshTelemetryBar(): void {
    if (!this.telemetryEl) return;
    const x = this.playerCoords.x.toFixed(1);
    const y = this.playerCoords.y.toFixed(1);
    const z = this.playerCoords.z.toFixed(1);
    const dist = Math.max(0, this.coreDistanceM).toFixed(1);
    const mode = this.coreUnlocked ? 'SINGULARITY_RESONANCE' : 'RING0_UNRESTRICTED';
    this.telemetryEl.textContent =
      `ACCESS: ${mode}  |  POS: (${x}, ${y}, ${z})  |  SINGULARITY: ${dist}m  |  NMI: ARMED`;
  }

  public reset(): void {
    this.locked = false;
    this.isOpen = false;
    this.wrongAttemptCount = 0;
    this.coreUnlocked = false;
    this.cmdHistory.length = 0;
    this.historyIdx = -1;
    this.successTimeouts.forEach((id) => window.clearTimeout(id));
    this.successTimeouts = [];
    if (this.hijackTimeout !== null) {
      window.clearTimeout(this.hijackTimeout);
      this.hijackTimeout = null;
    }
    this.modalEl.classList.add('hidden');
    this.modalEl.setAttribute('aria-hidden', 'true');
    this.logEl.innerHTML = '';
    this.inputEl.value = '';
    this.inputEl.disabled = false;
    this.printBootBanner();
  }

  private printBootBanner(): void {
    this.appendLine('Microsoft(R) Ring-0 Crash Dump Debugger [MEMORY_0247.DMP // DIRECT ACCESS]', 'dim');
    this.appendLine('PRIVILEGE     : RING-0 UNRESTRICTED — 座標制限なし（現在位置から全命令を即時実行可能）', 'ok');
    this.appendLine('COMMANDS      : HELP / SCAN / DUMP / TRACE / GLITCH / WAKE_UP', 'dim');
  }

  private appendLine(text: string, cls: '' | 'dim' | 'err' | 'warn' | 'ok' = ''): void {
    const div = document.createElement('div');
    div.className = `console-line ${cls}`.trim();
    div.textContent = text;
    this.logEl.appendChild(div);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  public open(coreRevealed?: boolean, distToCore?: number): void {
    if (this.isOpen || this.locked) return;
    if (typeof coreRevealed === 'boolean') this.coreUnlocked = coreRevealed;
    if (typeof distToCore === 'number') this.coreDistanceM = distToCore;

    this.isOpen = true;
    this.modalEl.classList.remove('hidden');
    this.modalEl.setAttribute('aria-hidden', 'false');
    this.inputEl.disabled = false;
    this.inputEl.value = '';
    this.refreshTelemetryBar();

    if (document.pointerLockElement && typeof document.exitPointerLock === 'function') {
      document.exitPointerLock();
    }

    this.appendLine(
      `[RING0_READY] 現在座標 (${this.playerCoords.x.toFixed(1)}, ${this.playerCoords.z.toFixed(1)}) / 特異点距離 ${Math.max(0, Math.round(this.coreDistanceM))}m — SCAN / GLITCH / WAKE_UP 等を即時実行できます。`,
      'dim'
    );

    this.audio.playOneShot('glitch_slice', { volume: 0.26, rate: 0.88, reverb: 0.45 });
    this.audio.playOneShot('monitor_glitch', {
      volume: 0.16,
      rate: 0.7,
      duration: 0.7,
      releaseSec: 0.3,
    });

    requestAnimationFrame(() => {
      this.inputEl.focus();
    });
  }

  public close(notifyController: boolean): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.inputEl.blur();
    this.audio.playOneShot('ui_hover', { volume: 0.22, rate: 0.8 });
    this.modalEl.classList.add('hidden');
    this.modalEl.setAttribute('aria-hidden', 'true');
    if (notifyController) {
      this.onCloseRequest?.();
    }
  }

  private scheduleParasyteHijack(msg: string): void {
    if (this.hijackTimeout !== null) window.clearTimeout(this.hijackTimeout);
    this.hijackTimeout = window.setTimeout(() => {
      if (this.locked) return;
      this.audio.playKeystroke();
      this.appendLine(msg, 'err');
    }, 260);
  }

  public handleCommand(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.appendLine('DUMP:\\RING0> _', 'dim');
      this.appendLine('[INFO] HELP でコマンド一覧を表示、または WAKE_UP で現在地の床面を破砕して帰還できます。', 'warn');
      return;
    }

    this.cmdHistory.push(trimmed);
    this.historyIdx = this.cmdHistory.length;

    this.appendLine(`DUMP:\\RING0> ${trimmed}`);
    const normalized = trimmed.toUpperCase().replace(/[\s-]+/g, '_');

    // Unrestricted WAKE_UP execution from ANY coordinate in the 3D BSOD world!
    if (
      normalized === 'WAKE_UP' ||
      normalized === 'WAKEUP' ||
      normalized === 'UNMOUNT' ||
      normalized === '0X0078D7'
    ) {
      this.locked = true;
      this.inputEl.disabled = true;
      this.appendLine(
        `[NMI INTERRUPT ACCEPTED] DIRECTIVE "WAKE_UP" DISPATCHED AT (${this.playerCoords.x.toFixed(1)}, ${this.playerCoords.z.toFixed(1)})!`,
        'ok'
      );
      this.audio.playOneShot('reality_rift', { volume: 0.75, reverb: 0.45 });

      this.successTimeouts.push(
        window.setTimeout(() => {
          this.appendLine('[DISPLAY_OBSERVER.DRV]: 逃ガサナイ……マダ描画中ダ！！', 'err');
          this.audio.playKeystroke();
        }, 150)
      );

      this.successTimeouts.push(
        window.setTimeout(() => {
          this.appendLine('[0x0078D7 -> 0x000000] UNMOUNTING OPTIC_CHIASM_STREAM ... FORCE_SEVERED', 'ok');
          this.appendLine('[WARNING] SHATTERING LOCAL FLOOR SECTOR — EXECUTING FREEFALL UNMOUNT!', 'warn');
        }, 320)
      );

      this.successTimeouts.push(
        window.setTimeout(() => {
          this.close(false);
          this.onWakeUpCommand?.();
        }, 540)
      );
      return;
    }

    if (normalized === 'CLEAR' || normalized === 'CLS') {
      this.logEl.innerHTML = '';
      this.printBootBanner();
      return;
    }

    if (normalized === 'HELP' || normalized === '?') {
      this.audio.playKeystroke();
      this.appendLine('=== RING-0 RECOVERY COMMANDS (現在位置から制限なく実行可能) ===', 'ok');
      this.appendLine('  SCAN     : 周囲の破損残骸ジオメトリへ 3D LIDAR 位相パルスを放射', 'dim');
      this.appendLine('  DUMP     : MEMORY_0247.DMP のクラッシュレジスタと停止要因を解析', 'dim');
      this.appendLine('  TRACE    : 拘束中の意識スレッド (PID 0x0247) と天球監視ドライバを追跡', 'dim');
      this.appendLine('  GLITCH   : 空間セクタへ強制グリッチ・サージ（負荷パルス）を注入', 'dim');
      this.appendLine('  WAKE_UP  : 直下の床面セクタを強制破砕し、現実の自室へ緊急帰還', 'warn');
      return;
    }

    if (normalized === 'SCAN' || normalized === 'PING' || normalized === 'LIDAR') {
      this.audio.playKeystroke();
      this.appendLine(
        `[LIDAR_PULSE] 座標 (${this.playerCoords.x.toFixed(1)}, ${this.playerCoords.z.toFixed(1)}) から全域へ3Dスキャン波を送信しました。`,
        'ok'
      );
      this.appendLine(
        `  -> 検出: SHEARED_SINGULARITY_SPIRE (${Math.round(this.coreDistanceM)}m) / CORRODED_VRAM_MONOLITHS / CRASHED_ROOM_RELICS`,
        'dim'
      );
      this.onScanCommand?.();
      return;
    }

    if (normalized === 'GLITCH' || normalized === 'SURGE' || normalized === 'OVERCLOCK' || normalized === 'FAULT') {
      this.audio.playKeystroke();
      this.appendLine('[OVERCLOCK_FAULT] 表示セクタへ強制異常パルスを注入 —— 空間ジオメトリが軋んでいます。', 'err');
      this.onGlitchCommand?.();
      return;
    }

    if (normalized === 'PS' || normalized === 'TASKLIST' || normalized === 'TRACE') {
      this.appendLine('PID 0x0004  NTOSKRNL_ABYSS.EXE       VRAM: 48.2 GB [CORRODED]', 'dim');
      this.appendLine('PID 0x0247  HOST_CONSCIOUSNESS.SYS   STATE: MOUNTED_TO_0x0078D7', 'warn');
      this.appendLine('PID 0x078D  SKY_APERTURE_GAZE.DRV    STATE: LOCKED_ON_OBSERVER', 'err');
      this.appendLine('RECOVERY    NMI_INTERRUPT_VECTOR  -> "WAKE_UP" [ARMED / ANYWHERE]', 'ok');
      return;
    }

    if (normalized === 'DUMP' || normalized === 'MEM' || normalized === 'CAT') {
      this.appendLine('0xFFFFF803_0078D700 : 4D 45 4D 4F 52 59 5F 30 32 34 37  ["MEMORY_0247.DMP"]', 'warn');
      this.appendLine('0xFFFFF803_0078D710 : FAULTING_MODULE = DISPLAY_BOUNDARY_COLLAPSE (02:47:59)', 'dim');
      this.appendLine('0xFFFFF803_0078D720 : NMI_ESCAPE_OPCODE = "WAKE_UP" (塔への移動不要・現在地で実行可)', 'ok');
      return;
    }

    if (normalized === 'STATUS' || normalized === 'INFO') {
      this.appendLine('HOST_BODY     : 自室のデスク前で午前 02:47 に時間凍結中', 'warn');
      this.appendLine(
        `SECTOR_COORDS : (${this.playerCoords.x.toFixed(1)}, ${this.playerCoords.y.toFixed(1)}, ${this.playerCoords.z.toFixed(1)})  |  SINGULARITY: ${Math.round(this.coreDistanceM)}m`,
        'dim'
      );
      this.appendLine('NMI_OVERRIDE  : UNLOCKED — いつでも WAKE_UP で床面を破砕して帰還可能です。', 'ok');
      return;
    }

    if (normalized === 'WHOAMI') {
      this.appendLine('nt authority\\mounted_observer (PID: 0x0247)', 'warn');
      this.scheduleParasyteHijack('[SKY_APERTURE_GAZE.DRV]: 画面ノ中カラ見上ゲル気分ハドウダ？');
      return;
    }

    if (normalized === 'DIR' || normalized === 'LS') {
      this.appendLine('02/47/2026  <DIR>  SHATTERED_BEDROOM.RELIC', 'dim');
      this.appendLine('02/47/2026  <SYS>  SKY_APERTURE_GAZE.DRV [WATCHING]', 'err');
      this.appendLine('02/47/2026  <CMD>  WAKE_UP.NMI [EXECUTABLE_ANYWHERE]', 'ok');
      return;
    }

    if (
      normalized === 'EXIT' ||
      normalized === 'QUIT' ||
      normalized === 'REBOOT' ||
      normalized === 'RESTART' ||
      normalized === 'SHUTDOWN'
    ) {
      this.wrongAttemptCount++;
      this.audio.playOneShot('console_error', { volume: 0.6 });
      this.appendLine(
        `[STOP 0x000000F4] 標準電源命令 '${trimmed}' はフックされています。強制帰還には WAKE_UP を実行してください。`,
        'err'
      );
      this.onWrongCommand?.(trimmed);
      return;
    }

    if (trimmed === ':(' || trimmed === ':)') {
      this.audio.playOneShot('pain_glitch', { volume: 0.55, reverb: 0.4 });
      this.appendLine(':)  :)  :)  0x0078D7 IS LOOKING BACK AT YOU  :)  :)  :)', 'err');
      this.onWrongCommand?.(trimmed);
      return;
    }

    this.wrongAttemptCount++;
    this.audio.playOneShot('console_error', { volume: 0.58 });
    this.appendLine(
      `[OPCODE_FAULT] '${trimmed}' は未定義です。HELP で命令一覧を確認するか、WAKE_UP を入力してください。`,
      'err'
    );
    this.scheduleParasyteHijack('[SKY_APERTURE_GAZE.DRV]: ソノ文字列ハ既ニ破損セクタニ沈ンダ。');
    this.onWrongCommand?.(trimmed);
  }
}
