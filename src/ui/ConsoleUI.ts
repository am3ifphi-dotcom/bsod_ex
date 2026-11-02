import { AudioManager } from '../audio/AudioManager';

/**
 * A portable recovery shell. It is deliberately available everywhere in the dump world:
 * the world is a place to investigate, not a gate that withholds the ending behind a walk.
 */
export class ConsoleUI {
  private readonly modalEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly formEl: HTMLFormElement;
  private readonly inputEl: HTMLInputElement;
  private readonly closeBtn: HTMLButtonElement;

  public isOpen = false;
  private locked = false;
  private wrongAttemptCount = 0;
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

  /** Kept as a harmless compatibility seam for callers from older builds. */
  public setWorldState(_coreRevealed?: boolean, _distToCore?: number): void {
    // Recovery is local to the player now. No location-dependent access gate.
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
    this.appendLine('MEMORY_DUMP // LOCAL RECOVERY SHELL  [02:47:00]', 'dim');
    this.appendLine('UPLINK: SELF-HOSTED  //  LOCATION LOCK: DISABLED  //  EXIT VECTOR: WAKE_UP', 'ok');
    this.appendLine('SMILE_ENTITY.SYS is watching the terminal stream. It cannot revoke this shell.', 'warn');
    this.appendLine('診断: HELP / STATUS。いつでも WAKE_UP を実行して、この領域を強制終了できます。', 'dim');
  }

  private appendLine(text: string, cls: '' | 'dim' | 'err' | 'warn' | 'ok' = ''): void {
    const div = document.createElement('div');
    div.className = `console-line ${cls}`.trim();
    div.textContent = text;
    this.logEl.appendChild(div);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  public open(): void {
    if (this.isOpen || this.locked) return;

    this.isOpen = true;
    this.modalEl.classList.remove('hidden');
    this.modalEl.setAttribute('aria-hidden', 'false');
    this.inputEl.disabled = false;
    this.inputEl.value = '';

    if (document.pointerLockElement) document.exitPointerLock();

    this.appendLine('[LOCAL_CONSOLE: READY] 接続地点は問いません。WAKE_UP で今すぐ離脱できます。', 'ok');
    this.audio.playOneShot('glitch_slice', { volume: 0.26, rate: 0.88, reverb: 0.45 });
    this.audio.playOneShot('monitor_glitch', {
      volume: 0.16,
      rate: 0.7,
      duration: 0.7,
      releaseSec: 0.3,
    });

    requestAnimationFrame(() => this.inputEl.focus());
  }

  public close(notifyController: boolean): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.inputEl.blur();
    this.audio.playOneShot('ui_hover', { volume: 0.22, rate: 0.8 });
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
    }, 280);
  }

  private handleCommand(raw: string): void {
    if (!raw) {
      this.appendLine('MEM:\\SELF> _', 'dim');
      this.appendLine('[WARN] 命令語が入力されていません。HELP または WAKE_UP を入力してください。', 'warn');
      return;
    }

    this.cmdHistory.push(raw);
    this.historyIdx = this.cmdHistory.length;
    this.appendLine(`MEM:\\SELF> ${raw}`);
    const normalized = raw.toUpperCase().replace(/\s+/g, '_');

    if (normalized === 'WAKE_UP') {
      this.locked = true;
      this.inputEl.disabled = true;
      this.appendLine('[CRITICAL INTERRUPT ACCEPTED] DIRECTIVE "WAKE_UP" VERIFIED.', 'ok');
      this.appendLine('[LOCAL_ROUTE] Position bypassed. Cutting display ownership now...', 'dim');
      this.audio.playOneShot('reality_rift', { volume: 0.75, reverb: 0.45 });

      this.successTimeouts.push(window.setTimeout(() => {
        this.appendLine('[SMILE_ENTITY.SYS]: 待テ……ソレハ、ドコカラデモ実行デキル命令ジャナイ。', 'err');
        this.audio.playKeystroke();
      }, 150));

      this.successTimeouts.push(window.setTimeout(() => {
        this.appendLine('[0x0078D7 -> 0x000000] DISPLAY_HOOK UNMOUNTED // ROUTE SEVERED', 'ok');
        this.appendLine('[WARNING] VIRTUAL CORTEX INTEGRITY 0% — SHATTERING DUMP SECTOR!', 'warn');
      }, 330));

      this.successTimeouts.push(window.setTimeout(() => {
        this.close(false);
        this.onWakeUpCommand?.();
      }, 560));
      return;
    }

    if (normalized === 'CLEAR' || normalized === 'CLS') {
      this.logEl.innerHTML = '';
      this.printBootBanner();
      return;
    }

    if (normalized === 'HELP' || normalized === '?') {
      this.audio.playKeystroke();
      this.appendLine('利用可能な診断コマンド: STATUS, PS, WHOAMI, DIR, DUMP, CLEAR, WAKE_UP', 'dim');
      this.appendLine('※ WAKE_UP は場所・探索進行に関係なく実行できます。景色を見るか、今すぐ切断するかはあなたが決める。', 'ok');
      return;
    }

    if (normalized === 'PS' || normalized === 'TASKLIST') {
      this.appendLine('PID 0x0004  SYSTEM_IDLE_ABYSS        CPU: 01.2%', 'dim');
      this.appendLine('PID 0x0247  HOST_CONSCIOUSNESS.EXE   CPU: 12.4% [MIRRORED]', 'warn');
      this.appendLine('PID 0x0666  SMILE_ENTITY.SYS         CPU: 86.4% [LOSING DISPLAY]', 'err');
      return;
    }

    if (normalized === 'DUMP' || normalized === 'MEM' || normalized === 'TRACE') {
      this.appendLine('0xFFFFF803_0078D700 : 3A 28 20 57 41 4B 45 5F 55 50  [":( WAKE_UP"]', 'err');
      this.appendLine('RECOVERY_ROUTE = LOCAL // ORIGIN = CURRENT_VIEWPORT // HOP_COUNT = 0', 'dim');
      return;
    }

    if (normalized === 'STATUS') {
      this.appendLine('HOST_BODY     : 自室のデスクチェアで硬直中（午前 02:47 停止）', 'warn');
      this.appendLine('DIGESTION     : 99.4% — 意識データが青い深淵に溶けかけています', 'err');
      this.appendLine('ESCAPE_ROUTE  : LOCAL SHELL READY — WAKE_UP を入力すれば現在地から切断します。', 'ok');
      return;
    }

    if (normalized === 'WHOAMI') {
      this.appendLine('nt authority\\swallowed_observer (PID: 0x0247)', 'warn');
      this.scheduleParasyteHijack('[SMILE_ENTITY.SYS]: 「お前」はもう半分、この画面の中だ。');
      return;
    }

    if (normalized === 'DIR' || normalized === 'LS') {
      this.appendLine('02/47/2026  <DIR>  BEDROOM_BACKUP.CORRUPT', 'dim');
      this.appendLine('02/47/2026  <SYS>  SMILE_ENTITY.SYS [DISPLAY_OWNER]', 'err');
      this.appendLine('02/47/2026  <CMD>  WAKE_UP.LOCAL_INTERRUPT', 'ok');
      return;
    }

    if (
      normalized === 'EXIT' || normalized === 'QUIT' || normalized === 'REBOOT' ||
      normalized === 'RESTART' || normalized === 'SHUTDOWN'
    ) {
      this.wrongAttemptCount++;
      this.audio.playOneShot('console_error', { volume: 0.6 });
      this.appendLine(`[STOP 0x000000F4] '${raw}' は拒否されました。表示システムの通常終了は乗っ取られています。`, 'err');
      this.scheduleParasyteHijack('[SMILE_ENTITY.SYS]: 再起動？ 画面の外なんて、もうない。');
      this.onWrongCommand?.(raw);
      return;
    }

    if (raw === ':(' || raw === ':)') {
      this.audio.playOneShot('pain_glitch', { volume: 0.55, reverb: 0.4 });
      this.appendLine(':(  :(  :(  口ノ中デ鳴イテイル  :(  :(  :(', 'err');
      this.onWrongCommand?.(raw);
      return;
    }

    this.wrongAttemptCount++;
    this.audio.playOneShot('console_error', { volume: 0.58 });
    const eerieErrors = [
      `[SYNTAX_FAULT] '${raw}' は無効です。空の瞳孔が収縮し、ダンプ領域が軋んでいます。`,
      `[ACCESS_DENIED] '${raw}' では切断できません。WAKE_UP をそのまま実行してください。`,
      `[DIGESTION_WARN] 誤入力 '${raw}' が青画面に咀嚼されました。正しい覚醒命令が必要です。`,
    ];
    this.appendLine(eerieErrors[(this.wrongAttemptCount - 1) % eerieErrors.length], 'err');
    const taunts = [
      '[SMILE_ENTITY.SYS]: 指が震えているな。自室の椅子の背もたれに、もう誰か立っているぞ。',
      '[SMILE_ENTITY.SYS]: どこへ歩いても同じだ。だが、ここなら今すぐ切れる。',
      '[SMILE_ENTITY.SYS]: あと少しで 100% 完了だ。お前の名前も記憶も綺麗な青になる。',
    ];
    this.scheduleParasyteHijack(taunts[(this.wrongAttemptCount - 1) % taunts.length]);
    this.onWrongCommand?.(raw);
  }
}
