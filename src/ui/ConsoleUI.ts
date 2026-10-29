import { AudioManager } from '../audio/AudioManager';

export class ConsoleUI {
  private readonly modalEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly formEl: HTMLFormElement;
  private readonly inputEl: HTMLInputElement;
  private readonly closeBtn: HTMLButtonElement;

  public isOpen = false;
  private locked = false;
  private wrongAttemptCount = 0;
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

  public reset(): void {
    this.locked = false;
    this.isOpen = false;
    this.wrongAttemptCount = 0;
    this.modalEl.classList.add('hidden');
    this.modalEl.setAttribute('aria-hidden', 'true');
    this.logEl.innerHTML = '';
    this.inputEl.value = '';
    this.inputEl.disabled = false;
    this.printBootBanner();
  }

  private printBootBanner(): void {
    this.appendLine('Microsoft(R) Kernel Crash Dump Shell [Version 10.0.19045.78D7]', 'dim');
    this.appendLine('ACTIVE DUMP : C:\\Windows\\MEMORY_0247.DMP (SECTOR LOCKED)', 'dim');
    this.appendLine('ヒント: 未知の命令語は世界の中枢（CORE）に刻まれています。HELP で補助情報表示。', 'dim');
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

    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // CRT boot texture: a short signal crack plus the panel's own hum settling in.
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

  private handleCommand(raw: string): void {
    if (!raw) {
      this.appendLine('DUMP:\\CORE> _', 'dim');
      this.appendLine('[WARN] 命令語が入力されていません。', 'warn');
      return;
    }

    this.cmdHistory.push(raw);
    this.historyIdx = this.cmdHistory.length;

    this.appendLine(`DUMP:\\CORE> ${raw}`);
    const normalized = raw.toUpperCase().replace(/\s+/g, '_');

    if (normalized === 'WAKE_UP') {
      this.locked = true;
      this.inputEl.disabled = true;
      this.appendLine('[CRITICAL INTERRUPT ACCEPTED] DIRECTIVE "WAKE_UP" VERIFIED.', 'ok');
      this.audio.playOneShot('reality_rift', { volume: 0.72, reverb: 0.45 });

      setTimeout(() => {
        this.appendLine('[0x0078D7 -> 0x000000] UNHOOKING SMILE_ENTITY.SYS ... OK', 'warn');
        this.audio.playKeystroke();
      }, 170);

      setTimeout(() => {
        this.appendLine('[WARNING] VIRTUAL TERRAIN INTEGRITY 0% — SHATTERING DUMP SECTOR!', 'err');
      }, 340);

      setTimeout(() => {
        this.close(false);
        this.onWakeUpCommand?.();
      }, 540);
      return;
    }

    if (normalized === 'CLEAR' || normalized === 'CLS') {
      this.logEl.innerHTML = '';
      this.printBootBanner();
      return;
    }

    if (normalized === 'HELP' || normalized === '?') {
      this.audio.playKeystroke();
      this.appendLine('利用可能な診断コマンド: STATUS, WHOAMI, DIR, DUMP, CLEAR, REBOOT', 'dim');
      this.appendLine('※ 緊急脱出用の割り込み命令はマスクされています：[████_██] — 中央構造物を調査してください。', 'warn');
      return;
    }

    if (normalized === 'DUMP' || normalized === 'MEM' || normalized === 'TRACE') {
      this.appendLine('0xFFFFF803_0078D700 : 3A 28 20 49 5F 53 45 45 5F 59 4F 55  [":( I_SEE_YOU"]', 'err');
      this.appendLine('0xFFFFF803_0078D710 : CORE_SANCTUARY_COORDS = (0.0, -56.0)', 'dim');
      return;
    }

    if (normalized === 'STATUS') {
      this.appendLine('HOST_BODY     : SLEEP_PARALYSIS (02:47 AM)', 'warn');
      this.appendLine('DUMP_PROGRESS : 99% (STALLED)', 'warn');
      this.appendLine('CORE_DISTANCE : 光の柱が立つ中央構造物に秘密の命令語が存在します。', 'dim');
      return;
    }

    if (normalized === 'WHOAMI') {
      this.appendLine('nt authority\\captured_observer (PID: 0x0247)', 'warn');
      return;
    }

    if (normalized === 'DIR' || normalized === 'LS') {
      this.appendLine('02/47/2026  <DIR>  BEDROOM_BACKUP.CORRUPT', 'dim');
      this.appendLine('02/47/2026  <SYS>  SMILE_ENTITY.SYS [RUNNING]', 'err');
      this.appendLine('02/47/2026  <KEY>  CORE_SANCTUARY.LOCK', 'warn');
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
        `[STOP 0x000000F4] '${raw}' は拒否されました。標準の終了処理は ':(' によってフックされています。`,
        'err'
      );
      this.onWrongCommand?.(raw);
      return;
    }

    if (raw === ':(' || raw === ':)') {
      this.audio.playOneShot('pain_glitch', { volume: 0.55, reverb: 0.4 });
      this.appendLine(':(  :(  :(  見つけた  :(  :(  :(', 'err');
      this.onWrongCommand?.(raw);
      return;
    }

    // World-consistent eerie rejection for unknown commands
    this.wrongAttemptCount++;
    this.audio.playOneShot('console_error', { volume: 0.58 });
    const eerieErrors = [
      `[SYNTAX_FAULT] '${raw}' は有効なカーネル割り込みではありません。ダンプ領域が軋んでいます。`,
      `[ACCESS_DENIED] '${raw}' では目を覚ませません。世界の中心にある巨大構造物を調べてください。`,
      `[MEMORY_ECHO] 入力 '${raw}' は青画面に吸収されました。正しい脱出コマンドが必要です。`,
    ];
    this.appendLine(eerieErrors[(this.wrongAttemptCount - 1) % eerieErrors.length], 'err');
    this.onWrongCommand?.(raw);
  }
}
