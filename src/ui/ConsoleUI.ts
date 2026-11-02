import { AudioManager } from '../audio/AudioManager';

/**
 * The kernel recovery shell.
 *
 * Design rules that this rewrite follows:
 *
 *  - It is ALWAYS available. There is no location gate, no unlock flag, no fetch quest. Pressing
 *    [C] anywhere in the dump opens it, because a panic shell that refuses to open is not scary,
 *    it is annoying.
 *  - It behaves like a real terminal: a prompt that echoes what you typed, terse replies, an error
 *    that names the failure instead of describing the vibe. The horror is in the *content* of the
 *    replies, never in the shell refusing to answer.
 *  - WAKE_UP is always accepted. The world tells you the word through the panel, the dump and the
 *    sanctuary; the shell does not withhold it.
 */

type LineClass = '' | 'dim' | 'err' | 'warn' | 'ok' | 'echo';

const BOOT_LINES: Array<[string, LineClass]> = [
  ['KERNEL RECOVERY CONSOLE  [Version 10.0.19045.78D7]', 'dim'],
  ['(c) Microsoft Corporation. All rights reserved.', 'dim'],
  ['', ''],
  ['DUMP     C:\\Windows\\MEMORY_0247.DMP', 'dim'],
  ['HOST     DISPLAY_BUFFER  //  02:47:19  //  NO CARRIER', 'warn'],
  ['SHELL    attached to dead process 0x0247', 'err'],
  ['', ''],
  ['HELP で利用可能なコマンドを表示します。', 'dim'],
];

export class ConsoleUI {
  private readonly modalEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly formEl: HTMLFormElement;
  private readonly inputEl: HTMLInputElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly statusEl: HTMLElement | null;

  public isOpen = false;
  private locked = false;
  private wrongAttemptCount = 0;
  private coreDistanceM = 76;
  private hijackTimeout: number | null = null;
  private successTimeouts: number[] = [];
  private readonly cmdHistory: string[] = [];
  private historyIdx = -1;

  public onCloseRequest?: () => void;
  public onWrongCommand?: (cmd: string) => void;
  public onWakeUpCommand?: () => void;

  constructor(private readonly audio: AudioManager) {
    this.modalEl = document.getElementById('console-modal')!;
    this.logEl = document.getElementById('console-log')!;
    this.formEl = document.getElementById('console-form') as HTMLFormElement;
    this.inputEl = document.getElementById('console-input') as HTMLInputElement;
    this.closeBtn = document.getElementById('console-close-btn') as HTMLButtonElement;
    this.statusEl = document.getElementById('console-status');

    this.printBootBanner();

    this.closeBtn.addEventListener('click', () => {
      if (!this.locked) this.close(true);
    });

    this.modalEl.addEventListener('mousedown', (e) => {
      if (e.target === this.modalEl && !this.locked) this.close(true);
    });

    this.inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!this.locked) this.close(true);
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
      if (e.key.length === 1 || e.key === 'Backspace') this.audio.playKeystroke();
    });

    this.formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.locked) return;
      const raw = this.inputEl.value.trim();
      this.inputEl.value = '';
      this.handleCommand(raw);
    });
  }

  /** Distance is flavour text only — it never gates anything. */
  public setWorldState(_coreRevealed: boolean, distToCore: number): void {
    this.coreDistanceM = distToCore;
    if (this.statusEl) {
      this.statusEl.textContent = `SESSION 0x0247  //  HOST: SEATED  //  CORE ${Math.max(1, Math.round(distToCore))}m`;
    }
  }

  public reset(): void {
    this.locked = false;
    this.isOpen = false;
    this.wrongAttemptCount = 0;
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
    for (const [text, cls] of BOOT_LINES) {
      if (!text) {
        this.appendLine('', '');
      } else {
        this.appendLine(text, cls);
      }
    }
  }

  private appendLine(text: string, cls: LineClass = ''): void {
    const div = document.createElement('div');
    div.className = `console-line ${cls}`.trim();
    div.textContent = text;
    this.logEl.appendChild(div);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  public open(_coreRevealed?: boolean, distToCore?: number): void {
    if (this.isOpen || this.locked) return;
    if (typeof distToCore === 'number') this.setWorldState(true, distToCore);

    this.isOpen = true;
    this.modalEl.classList.remove('hidden');
    this.modalEl.setAttribute('aria-hidden', 'false');
    this.inputEl.disabled = false;
    this.inputEl.value = '';
    if (document.pointerLockElement) document.exitPointerLock();

    this.appendLine('[SHELL] 割り込み受理。このプロセスはまだ応答しています。', 'dim');
    this.audio.playOneShot('glitch_slice', { volume: 0.22, rate: 0.9, reverb: 0.4 });
    this.audio.playOneShot('monitor_glitch', { volume: 0.14, rate: 0.72, duration: 0.6, releaseSec: 0.3 });

    requestAnimationFrame(() => this.inputEl.focus());
  }

  public close(notifyController: boolean): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.inputEl.blur();
    this.audio.playOneShot('ui_hover', { volume: 0.2, rate: 0.82 });
    this.modalEl.classList.add('hidden');
    this.modalEl.setAttribute('aria-hidden', 'true');
    if (notifyController) this.onCloseRequest?.();
  }

  private scheduleParasyteHijack(msg: string): void {
    if (this.hijackTimeout !== null) window.clearTimeout(this.hijackTimeout);
    this.hijackTimeout = window.setTimeout(() => {
      if (this.locked) return;
      this.audio.playKeystroke();
      this.appendLine(msg, 'err');
    }, 320);
  }

  private handleCommand(raw: string): void {
    if (!raw) {
      this.appendLine('[shell] 空行。何も起きません。', 'dim');
      return;
    }

    this.cmdHistory.push(raw);
    this.historyIdx = this.cmdHistory.length;
    this.appendLine(`DUMP:\\CORE> ${raw}`, 'echo');

    const normalized = raw.toUpperCase().replace(/\s+/g, '_');
    const compact = normalized.replace(/_/g, '');

    // ------------------------------------------------------------------ WAKE_UP
    if (compact === 'WAKEUP') {
      this.locked = true;
      this.inputEl.disabled = true;
      this.audio.playOneShot('reality_rift', { volume: 0.7, reverb: 0.42 });
      this.appendLine('[INTERRUPT] 0x000000F4 -> RING0 DIRECTIVE "WAKE_UP" ACCEPTED', 'ok');

      this.successTimeouts.push(
        window.setTimeout(() => {
          this.appendLine('[SMILE_ENTITY.SYS] 待テ。ソノ光ハ出口ジャナイ。', 'err');
          this.audio.playKeystroke();
        }, 160)
      );
      this.successTimeouts.push(
        window.setTimeout(() => {
          this.appendLine('[unhook] OPTIC_CHIASM_HOOK severed  ...  PARTIAL', 'ok');
          this.appendLine('[WARN] virtual cortex integrity 0%  —  DUMP SECTOR SHATTERING', 'warn');
        }, 340)
      );
      this.successTimeouts.push(
        window.setTimeout(() => {
          this.close(false);
          this.onWakeUpCommand?.();
        }, 580)
      );
      return;
    }

    if (normalized === 'CLEAR' || normalized === 'CLS') {
      this.logEl.innerHTML = '';
      this.printBootBanner();
      return;
    }

    // ------------------------------------------------------------------ HELP
    if (normalized === 'HELP' || normalized === '?') {
      this.appendLine('STATUS    ホストとダンプの状態', 'dim');
      this.appendLine('TRACE     停止コードの走査とメモリ領域の読み出し', 'dim');
      this.appendLine('PS        実行中のプロセス一覧', 'dim');
      this.appendLine('DIR       ダンプ内のファイル', 'dim');
      this.appendLine('WHOAMI    現在の資格情報', 'dim');
      this.appendLine('WAKE_UP   緊急割り込み（強制覚醒）', 'warn');
      this.appendLine('CLEAR     画面消去   /   ESC で閉じる', 'dim');
      return;
    }

    // ------------------------------------------------------------------ STATUS
    if (normalized === 'STATUS') {
      this.appendLine('HOST_BODY     : 自室のデスクチェアで硬直中（02:47 停止）', 'warn');
      this.appendLine('DIGESTION     : 99.4%  — 意識データが深淵に溶けかけています', 'err');
      this.appendLine('VISUAL_CORTEX : 表示バッファから直接読み取り中', 'err');
      this.appendLine(`RANGE_TO_CORE : ${Math.max(1, Math.round(this.coreDistanceM))}m（参照情報のみ）`, 'dim');
      return;
    }

    // ------------------------------------------------------------------ TRACE
    if (normalized === 'TRACE' || normalized === 'DUMP' || normalized === 'MEM') {
      this.appendLine('scan C:\\Windows\\MEMORY_0247.DMP ...', 'dim');
      this.appendLine('0xFFFFF803_0078D700  3A 28 20 49 54 5F 48 41 53 5F 54 45 45 54 48', 'dim');
      this.appendLine('                     ":( IT_HAS_TEETH"', 'err');
      this.appendLine('0xFFFFF803_0078D710  53 4C 45 45 50 5F 49 53 5F 4F 50 54 49 4F 4E', 'dim');
      this.appendLine('                     "SLEEP_IS_OPTION"', 'warn');
      this.appendLine('0xFFFFF803_0078D720  57 41 4B 45 5F 55 50 00 00 00 00 00 00 00 00', 'ok');
      this.appendLine('                     "WAKE_UP" — 有効な強制割り込みです', 'ok');
      return;
    }

    // ------------------------------------------------------------------ PS
    if (normalized === 'PS' || normalized === 'TASKLIST') {
      this.appendLine('PID 0x0004  SYSTEM_IDLE_ABYSS        CPU 01.2%', 'dim');
      this.appendLine('PID 0x0247  HOST_CONSCIOUSNESS.EXE   CPU 12.4%  [SWALLOWED]', 'warn');
      this.appendLine('PID 0x0666  SMILE_ENTITY.SYS         CPU 86.4%  [DIGESTING]', 'err');
      this.appendLine('PID 0x078D  OBSERVER_BEHIND_HOST    CPU 00.1%  [WATCHING]', 'err');
      return;
    }

    if (normalized === 'WHOAMI') {
      this.appendLine('nt authority\\swallowed_observer  (PID 0x0247)', 'warn');
      this.scheduleParasyteHijack('[SMILE_ENTITY.SYS] 「お前」はもう半分、この画面の中だ。');
      return;
    }

    if (normalized === 'DIR' || normalized === 'LS') {
      this.appendLine('02/47/2026  <DIR>  BEDROOM_BACKUP.CORRUPT', 'dim');
      this.appendLine('02/47/2026  <SYS>  SMILE_ENTITY.SYS        [JAWS_LOCKED]', 'err');
      this.appendLine('02/47/2026  <KEY>  INTERRUPT_VECTOR.WAKE_UP', 'ok');
      return;
    }

    if (raw === ':(' || raw === ':)') {
      this.audio.playOneShot('pain_glitch', { volume: 0.5, reverb: 0.4 });
      this.appendLine(':(  :(  :(  口ノ中デ鳴イテイル  :(  :(  :(', 'err');
      this.onWrongCommand?.(raw);
      return;
    }

    if (
      ['EXIT', 'QUIT', 'REBOOT', 'RESTART', 'SHUTDOWN', 'POWEROFF'].includes(normalized)
    ) {
      this.wrongAttemptCount++;
      this.audio.playOneShot('console_error', { volume: 0.52 });
      this.appendLine(`[STOP 0x000000F4] '${raw}' は拒否されました。電源割り込みは表示系に乗っ取られています。`, 'err');
      this.scheduleParasyteHijack('[SMILE_ENTITY.SYS] 電源を切っても、黒い画面の奥に私の目が見えるぞ。');
      this.onWrongCommand?.(raw);
      return;
    }

    this.wrongAttemptCount++;
    this.audio.playOneShot('console_error', { volume: 0.5 });
    const errors = [
      `[SYNTAX_FAULT] '${raw}' は無効です。`,
      `[ACCESS_DENIED] '${raw}' では目を覚ませません。`,
      `[DIGESTION_WARN] 誤入力 '${raw}' が青画面に咀嚼されました。`,
    ];
    this.appendLine(errors[(this.wrongAttemptCount - 1) % errors.length], 'err');
    const taunts = [
      '[SMILE_ENTITY.SYS] 指が震えているな。椅子の背もたれに、もう誰か立っているぞ。',
      '[SMILE_ENTITY.SYS] 思い出せないのか？ 目を覚ます命令は、ずっと画面の上にあった。',
      '[SMILE_ENTITY.SYS] あと少しで 100% だ。お前の名前も記憶も綺麗な青になる。',
    ];
    this.scheduleParasyteHijack(taunts[(this.wrongAttemptCount - 1) % taunts.length]);
    this.onWrongCommand?.(raw);
  }
}
