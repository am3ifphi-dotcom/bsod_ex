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
  private coreUnlocked = false;
  private coreDistanceM = 76;
  private hijackTimeout: number | null = null;
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

  public setWorldState(coreRevealed: boolean, distToCore: number): void {
    this.coreUnlocked = coreRevealed;
    this.coreDistanceM = distToCore;
  }

  public reset(): void {
    this.locked = false;
    this.isOpen = false;
    this.wrongAttemptCount = 0;
    this.coreUnlocked = false;
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
    this.appendLine('ACTIVE DUMP   : C:\\Windows\\MEMORY_0247.DMP  //  HOST_VITALS: 152 BPM (MOTOR_LOCKED)', 'warn');
    this.appendLine('PARASYTE_HOOK : SMILE_ENTITY.SYS -> OPTIC_CHIASM_RING0 [ACTIVE]', 'err');
    this.appendLine('診断: STATUS / HELP でダンプ状態を確認、または中央聖堂で特定した緊急割り込み命令を実行してください。', 'dim');
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

    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    if (this.coreUnlocked) {
      this.appendLine('[SANCTUARY_LINK: SYNCED] 中央聖堂の碑板と同期完了 — 緊急割り込み命令を入力可能。', 'ok');
    } else {
      this.appendLine(
        `[CORE_SIGNAL: ${Math.max(1, Math.round(this.coreDistanceM))}m] 中央の光の柱（聖堂コア）へ近づくと、散乱した命令語が収束します。`,
        'dim'
      );
    }

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
    }, 280);
  }

  private handleCommand(raw: string): void {
    if (!raw) {
      this.appendLine('DUMP:\\CORE> _', 'dim');
      this.appendLine('[WARN] 命令語が入力されていません。空の天球の瞳がこちらを覗き込んでいます。', 'warn');
      return;
    }

    this.cmdHistory.push(raw);
    this.historyIdx = this.cmdHistory.length;

    this.appendLine(`DUMP:\\CORE> ${raw}`);
    const normalized = raw.toUpperCase().replace(/\s+/g, '_');

    if (normalized === 'WAKE_UP') {
      this.locked = true;
      this.inputEl.disabled = true;
      this.appendLine('[CRITICAL INTERRUPT ACCEPTED] DIRECTIVE "WAKE_UP" VERIFIED!', 'ok');
      this.audio.playOneShot('reality_rift', { volume: 0.75, reverb: 0.45 });

      setTimeout(() => {
        this.appendLine('[SMILE_ENTITY.SYS]: 待テ……喉ノ奥カラ這イ出ルナ！！', 'err');
        this.audio.playKeystroke();
      }, 150);

      setTimeout(() => {
        this.appendLine('[0x0078D7 -> 0x000000] UNMOUNTING PARASYTE_CHIASM_HOOK ... SEVERED', 'ok');
        this.appendLine('[WARNING] VIRTUAL CORTEX INTEGRITY 0% — SHATTERING DUMP SECTOR!', 'warn');
      }, 330);

      setTimeout(() => {
        this.close(false);
        this.onWakeUpCommand?.();
      }, 560);
      return;
    }

    if (normalized === 'CLEAR' || normalized === 'CLS') {
      this.logEl.innerHTML = '';
      this.printBootBanner();
      return;
    }

    if (normalized === 'HELP' || normalized === '?') {
      this.audio.playKeystroke();
      this.appendLine('利用可能な診断コマンド: STATUS, PS, WHOAMI, DIR, DUMP, CLEAR, REBOOT', 'dim');
      this.appendLine(
        this.coreUnlocked
          ? '※ 中央聖堂の上空に収束した7文字の強制覚醒命令をそのまま入力してください。'
          : `※ 光の柱が立つ中央聖堂（残り約 ${Math.max(1, Math.round(this.coreDistanceM))}m）へ向かうと、覚醒命令が判明します。`,
        'warn'
      );
      return;
    }

    if (normalized === 'PS' || normalized === 'TASKLIST') {
      this.appendLine('PID 0x0004  SYSTEM_IDLE_ABYSS        CPU: 01.2%', 'dim');
      this.appendLine('PID 0x0247  HOST_CONSCIOUSNESS.EXE   CPU: 12.4% [SWALLOWED]', 'warn');
      this.appendLine('PID 0x0666  SMILE_ENTITY.SYS         CPU: 86.4% [DIGESTING_MEMORIES]', 'err');
      return;
    }

    if (normalized === 'DUMP' || normalized === 'MEM' || normalized === 'TRACE') {
      this.appendLine('0xFFFFF803_0078D700 : 3A 28 20 49 54 5F 48 41 53 5F 54 45 45 54 48  [":( IT_HAS_TEETH"]', 'err');
      this.appendLine('0xFFFFF803_0078D710 : CORE_SANCTUARY_COORDS = (0.0, -56.0)', 'dim');
      return;
    }

    if (normalized === 'STATUS') {
      this.appendLine('HOST_BODY     : 自室のデスクチェアで硬直中（午前 02:47 停止）', 'warn');
      this.appendLine('DIGESTION     : 99.4% — 意識データが青い深淵に溶けかけています', 'err');
      this.appendLine(
        this.coreUnlocked
          ? 'SANCTUARY_KEY : 収束完了！ 中央のプレートに浮かぶ命令語を入力してください。'
          : `CORE_DISTANCE : 中央聖堂まで約 ${Math.max(1, Math.round(this.coreDistanceM))}m — 近づくと秘密の命令語が収束します。`,
        this.coreUnlocked ? 'ok' : 'dim'
      );
      return;
    }

    if (normalized === 'WHOAMI') {
      this.appendLine('nt authority\\swallowed_observer (PID: 0x0247)', 'warn');
      this.scheduleParasyteHijack('[SMILE_ENTITY.SYS]: 「お前」はもう半分、私の歯の内側だ。');
      return;
    }

    if (normalized === 'DIR' || normalized === 'LS') {
      this.appendLine('02/47/2026  <DIR>  BEDROOM_BACKUP.CORRUPT', 'dim');
      this.appendLine('02/47/2026  <SYS>  SMILE_ENTITY.SYS [JAWS_LOCKED]', 'err');
      this.appendLine('02/47/2026  <KEY>  CORE_SANCTUARY.WAKE_DIRECTIVE', 'warn');
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
        `[STOP 0x000000F4] '${raw}' は拒否されました。標準の電源・終了割り込みは顎の神経に直結されています。`,
        'err'
      );
      this.scheduleParasyteHijack('[SMILE_ENTITY.SYS]: 再起動？ 何度電源を切っても、黒い画面の奥に私の目が見えるぞ。');
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
      `[ACCESS_DENIED] '${raw}' では目を覚ませません。光の柱が立つ中央聖堂の刻印を読み取ってください。`,
      `[DIGESTION_WARN] 誤入力 '${raw}' が青画面に咀嚼されました。正しい覚醒命令が必要です。`,
    ];
    this.appendLine(eerieErrors[(this.wrongAttemptCount - 1) % eerieErrors.length], 'err');
    const taunts = [
      '[SMILE_ENTITY.SYS]: 指が震えているな。自室の椅子の背もたれに、もう誰か立っているぞ。',
      '[SMILE_ENTITY.SYS]: 思い出せないのか？ 中央の祭壇の上を見ろ……いや、見るな。',
      '[SMILE_ENTITY.SYS]: あと少しで 100% 完了だ。お前の名前も記憶も綺麗な青になる。',
    ];
    this.scheduleParasyteHijack(taunts[(this.wrongAttemptCount - 1) % taunts.length]);
    this.onWrongCommand?.(raw);
  }
}
