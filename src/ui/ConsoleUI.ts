import { AudioManager } from '../audio/AudioManager';

/**
 * ============================================================================
 *  KERNEL RECOVERY CONSOLE — available from the very first frame of the world
 * ============================================================================
 *
 *  Old design gated WAKE_UP behind a physical trip to the central tower: the
 *  command was literally refused with "信号が不完全です。光の柱に近づいてください"
 *  until a proximity flag flipped. That is a fetch quest, not horror.
 *
 *  New design: the directive is printed in the boot banner, before the player
 *  has taken a single step. Everything is executable from anywhere. The tower
 *  is now optional context — reaching it adds one extra archive line, never
 *  permission. The tension moves from "what do I type?" to "do I really want
 *  to type the thing I already know?"
 * ============================================================================
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
  private coreVisited = false;
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

  /** distToCore is informational only. coreVisited unlocks *lore*, never commands. */
  public setWorldState(distToCore: number, coreVisited = false): void {
    this.coreDistanceM = distToCore;
    this.coreVisited = coreVisited;
  }

  public reset(): void {
    this.locked = false;
    this.isOpen = false;
    this.wrongAttemptCount = 0;
    this.coreVisited = false;
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
    this.appendLine('Microsoft(R) Kernel Crash Dump Shell [Version 10.0.19045.78D7]', 'dim');
    this.appendLine('ACTIVE DUMP  : C:\\Windows\\MEMORY_0247.DMP  //  HOST_VITALS: 152 BPM', 'warn');
    this.appendLine('DIRECTIVE    : WAKE_UP  [AVAILABLE — ANY NODE, ANY DEPTH]', 'ok');
    this.appendLine('NOTICE       : 実行後、このダンプは閉じられます。', 'dim');
    this.appendLine('STATUS / HELP / LOOK / DUMP で状態を確認できます。入力はどこからでも有効です。', 'dim');
  }

  private appendLine(text: string, cls: '' | 'dim' | 'err' | 'warn' | 'ok' = ''): void {
    const div = document.createElement('div');
    div.className = `console-line ${cls}`.trim();
    div.textContent = text;
    this.logEl.appendChild(div);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  public open(distToCore?: number): void {
    if (this.isOpen || this.locked) return;
    if (typeof distToCore === 'number') this.coreDistanceM = distToCore;

    this.isOpen = true;
    this.modalEl.classList.remove('hidden');
    this.modalEl.setAttribute('aria-hidden', 'false');
    this.inputEl.disabled = false;
    this.inputEl.value = '';

    if (document.pointerLockElement) document.exitPointerLock();

    this.appendLine(
      `[NODE: ${Math.max(1, Math.round(this.coreDistanceM))}m FROM ORIGIN] リンク確立 — 全コマンドがこの端末で有効です。`,
      'dim'
    );
    if (this.coreVisited && !this.logEl.textContent?.includes('ARCHIVE_FRAGMENT')) {
      this.appendLine('[ARCHIVE_FRAGMENT] 演算核に到達済み: このダンプは 02:47 に 1 回だけ書き込まれた。', 'ok');
    }

    this.audio.playOneShot('glitch_slice', { volume: 0.20, rate: 0.88, reverb: 0.45 });
    requestAnimationFrame(() => this.inputEl.focus());
  }

  public close(notifyController: boolean): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.inputEl.blur();
    this.audio.playOneShot('ui_hover', { volume: 0.18, rate: 0.8 });
    this.modalEl.classList.add('hidden');
    this.modalEl.setAttribute('aria-hidden', 'true');
    if (notifyController) this.onCloseRequest?.();
  }

  private scheduleMachineNote(msg: string): void {
    if (this.hijackTimeout !== null) window.clearTimeout(this.hijackTimeout);
    this.hijackTimeout = window.setTimeout(() => {
      if (this.locked) return;
      this.audio.playKeystroke();
      this.appendLine(msg, 'err');
    }, 280);
  }

  private handleCommand(raw: string): void {
    if (!raw) {
      this.appendLine('DUMP:\\CORE> _', 'dim');
      return;
    }

    this.cmdHistory.push(raw);
    this.historyIdx = this.cmdHistory.length;
    this.appendLine(`DUMP:\\CORE> ${raw}`);
    const normalized = raw.toUpperCase().replace(/\s+/g, '_');

    if (normalized === 'WAKE_UP') {
      // NO GATE. No distance check, no "signal incomplete", no fetch quest.
      this.locked = true;
      this.inputEl.disabled = true;
      this.appendLine('[CRITICAL INTERRUPT ACCEPTED] DIRECTIVE "WAKE_UP" VERIFIED', 'ok');
      this.audio.playOneShot('reality_rift', { volume: 0.58, reverb: 0.5 });

      this.successTimeouts.push(window.setTimeout(() => {
        this.appendLine('[0x0078D7 -> 0x000000] UNMOUNTING DISPLAY_BUFFER ... SEVERED', 'ok');
      }, 180));
      this.successTimeouts.push(window.setTimeout(() => {
        this.appendLine('[NOTICE] 1 HANDLE STILL OPEN', 'warn');
        this.appendLine('[WARNING] DUMP SECTOR INTEGRITY 0% — SHATTERING', 'err');
      }, 360));
      this.successTimeouts.push(window.setTimeout(() => {
        this.close(false);
        this.onWakeUpCommand?.();
      }, 620));
      return;
    }

    if (normalized === 'CLEAR' || normalized === 'CLS') {
      this.logEl.innerHTML = '';
      this.printBootBanner();
      return;
    }

    if (normalized === 'HELP' || normalized === '?') {
      this.audio.playKeystroke();
      this.appendLine('COMMANDS: STATUS, LOOK, SIGNAL, DUMP, PS, DIR, WHOAMI, CLEAR, WAKE_UP', 'dim');
      this.appendLine('WAKE_UP は位置に関係なく実行できます。探索は任意です。', 'ok');
      return;
    }

    if (normalized === 'LOOK' || normalized === 'WHERE' || normalized === 'SCAN') {
      this.appendLine(`ORIGIN_VECTOR : ${Math.max(1, Math.round(this.coreDistanceM))}m — 演算核は参照点にすぎません`, 'dim');
      this.appendLine('GEOMETRY     : 未描画の大聖堂 / 無限ページ層 / 欠落フィールド / データ血管', 'dim');
      this.appendLine('OMISSION     : 12.4% の構造がこのフレームに存在しません', 'warn');
      return;
    }

    if (normalized === 'SIGNAL' || normalized === 'TRACE' || normalized === 'PING') {
      this.appendLine('0xFFFFF803_0078D700 : 3A 29 20 49 54 5F 57 41 53 5F 41 4C 57 41 59 53', 'err');
      this.appendLine('[decode] ":) IT_WAS_ALWAYS_ON"', 'err');
      this.appendLine('CARRIER      : 02:47:19 — 送信元はこの端末自身', 'dim');
      this.scheduleMachineNote('[dump] 送信者と受信者のハンドルが同一です。');
      return;
    }

    if (normalized === 'PS' || normalized === 'TASKLIST') {
      this.appendLine('PID 0x0004  SYSTEM_IDLE_ABYSS        CPU: 01.2%', 'dim');
      this.appendLine('PID 0x0247  HOST_CONSCIOUSNESS.EXE   CPU: 12.4% [SWALLOWED]', 'warn');
      this.appendLine('PID 0x0666  DISPLAY_BUFFER.SYS        CPU: 86.4% [WRITING]', 'err');
      return;
    }

    if (normalized === 'DUMP' || normalized === 'MEM') {
      this.appendLine('0xFFFFF803_0078D700 : 3A 28 20 49 54 5F 48 41 53 5F 54 45 45 54 48', 'err');
      this.appendLine('0xFFFFF803_0078D710 : WRITE_COUNT = 6  /  LAST_WRITE = 02:47:19', 'dim');
      this.appendLine('0xFFFFF803_0078D718 : WAKE_UP [RING0 / NOT GATED]', 'ok');
      return;
    }

    if (normalized === 'STATUS') {
      this.appendLine('HOST_BODY     : 自室のデスクチェアで硬直中（02:47 停止）', 'warn');
      this.appendLine('DIGESTION     : 99.4% — 「99% 完了」はまだ完了していません', 'err');
      this.appendLine('DIRECTIVE     : WAKE_UP [AVAILABLE — ANY NODE]', 'ok');
      this.appendLine(
        this.coreVisited
          ? 'ARCHIVE       : 演算核を確認済み（追加情報あり）'
          : 'ARCHIVE       : 未確認 — 確認は必須ではありません',
        'dim'
      );
      return;
    }

    if (normalized === 'WHOAMI') {
      this.appendLine('nt authority\\swallowed_observer (PID: 0x0247)', 'warn');
      this.scheduleMachineNote('[dump] このハンドルは 02:47:19 に開かれ、まだ閉じられていません。');
      return;
    }

    if (normalized === 'DIR' || normalized === 'LS') {
      this.appendLine('02/47/2026  <DIR>  BEDROOM_BACKUP.CORRUPT', 'dim');
      this.appendLine('02/47/2026  <SYS>  DISPLAY_BUFFER.SYS [JAWS_REMOVED]', 'err');
      this.appendLine('02/47/2026  <KEY>  WAKE_UP.DIRECTIVE  [NO LOCK]', 'ok');
      return;
    }

    if (
      normalized === 'EXIT' || normalized === 'QUIT' || normalized === 'REBOOT' ||
      normalized === 'RESTART' || normalized === 'SHUTDOWN'
    ) {
      this.wrongAttemptCount++;
      this.audio.playOneShot('console_error', { volume: 0.48 });
      this.appendLine(
        `[STOP 0x000000F4] '${raw}' は拒否されました。標準の電源割り込みは表示バッファに吸収されています。`,
        'err'
      );
      this.appendLine('WAKE_UP のみがこのダンプを閉じます。', 'dim');
      this.onWrongCommand?.(raw);
      return;
    }

    if (raw === ':(' || raw === ':)') {
      this.audio.playOneShot('pain_glitch', { volume: 0.34, reverb: 0.4 });
      this.appendLine('0x3A 0x28  ->  0x3A 0x29   [1 GLYPH REWRITTEN]', 'err');
      this.appendLine('WRITE_COUNT = 7', 'dim');
      this.onWrongCommand?.(raw);
      return;
    }

    this.wrongAttemptCount++;
    this.audio.playOneShot('console_error', { volume: 0.46 });
    const errors = [
      `[SYNTAX_FAULT] '${raw}' は無効です。ダンプは変更されませんでした。`,
      `[NO_SUCH_HANDLE] '${raw}' に対応するレコードがありません。`,
      `[WRITE_PROTECTED] '${raw}' は読み取り専用領域を指しています。`,
    ];
    this.appendLine(errors[(this.wrongAttemptCount - 1) % errors.length], 'err');
    const notes = [
      '[dump] このシェルには WAKE_UP 以外に終了手段が登録されていません。',
      '[dump] 画面はまだ 99% です。',
      '[dump] 位置情報は権限に影響しません。',
    ];
    this.scheduleMachineNote(notes[(this.wrongAttemptCount - 1) % notes.length]);
    this.onWrongCommand?.(raw);
  }
}
