// In-game recovery console: command parsing, pseudo commands and the one
// command that actually ends the session.
import { UI } from './ui';
import { AudioEngine } from '../core/audio';

export interface ConsoleHost {
  onWakeUp: () => void;
  onGlitch: (amount: number) => void;
  onCredits: () => void;
  getReadSecret: () => boolean;
}

const FILES = [
  'autoexec.bat', 'face.sys', 'memory.dmp', 'room.dat', 'you.bin', 'wake.dll',
  'console.exe', 'user_profile.ini', '0000EA.log',
];

export class GameConsole {
  private ui: UI;
  private audio: AudioEngine;
  private host: ConsoleHost;
  private attempts = 0;
  private booted = false;

  constructor(ui: UI, audio: AudioEngine, host: ConsoleHost) {
    this.ui = ui;
    this.audio = audio;
    this.host = host;
  }

  reset() {
    this.attempts = 0;
    this.booted = false;
    this.ui.clearConsole();
  }

  private out(text: string, kind: 'sys' | 'err' | 'ok' | 'warn' | 'echo' | 'plain' = 'sys') {
    this.ui.printLine(text, kind);
  }

  execute(raw: string) {
    const line = raw.trim();
    if (!line) {
      // empty enter is a real event in this world
      this.audio.ui('error');
      this.out('0x00000000  EMPTY_INPUT — the console is waiting for something.', 'err');
      this.attempts++;
      return;
    }
    const parts = line.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = line.slice(parts[0].length).trim();

    this.ui.setConsoleState('BUSY');
    window.setTimeout(() => this.ui.setConsoleState('READY'), 380);

    if (!this.booted) this.booted = true;

    switch (cmd) {
      case 'help':
      case '?':
        this.out('利用可能なコマンド:', 'ok');
        this.out('  HELP            この一覧', 'plain');
        this.out('  DIR / LS        記憶領域の一覧', 'plain');
        this.out('  CAT <file>      ファイルを読む', 'plain');
        this.out('  STATUS / VER    端末の状態', 'plain');
        this.out('  MEM             メモリダンプ', 'plain');
        this.out('  ECHO <text>     そのまま返す', 'plain');
        this.out('  CLS             画面を消す', 'plain');
        this.out('  WHOAMI          あなたは誰か', 'plain');
        this.out('  TIME            現在時刻', 'plain');
        this.out('  EXIT            終了（できるとは言っていない）', 'plain');
        this.out('  CREDITS         クレジット', 'plain');
        this.out('※ 一部のコマンドは端末を壊します。', 'warn');
        break;

      case 'dir':
      case 'ls':
        this.out(` C:\\ROOMS\\YOURS\\ のディレクトリ`, 'sys');
        this.out('  <DIR>          ..', 'plain');
        for (const f of FILES) this.out(`  ${f.padEnd(20)} ${(Math.random() * 4000 + 120).toFixed(0)} bytes`, 'plain');
        this.out(`  ${(FILES.length + 2).toString().padStart(3)} 個のファイル   ${(Math.random() * 200 + 120).toFixed(0)} bytes`, 'plain');
        this.out('  警告: room.dat は現在使用中です。', 'warn');
        break;

      case 'cat':
      case 'type':
        if (!arg) { this.out('usage: cat <file>', 'err'); break; }
        this.fileRead(arg.toLowerCase());
        break;

      case 'echo':
        this.out(arg || '', 'plain');
        break;

      case 'cls':
      case 'clear':
        this.ui.clearConsole();
        this.out('画面を消した。何も消えていない。', 'sys');
        break;

      case 'whoami':
        this.out('user\\unknown  (セッション 0x0000EA)', 'ok');
        this.out('このアカウントは削除されています。', 'warn');
        break;

      case 'status':
      case 'ver':
      case 'sysinfo':
        this.out('RECOVERY CONSOLE v0.0.7', 'ok');
        this.out('  memory : 0xDEADFACE / 0xFFFFFFFF  (破損)', 'plain');
        this.out('  rooms  : 1 (this one is a copy)', 'plain');
        this.out('  uptime : —', 'plain');
        this.out('  user   : 不在', 'plain');
        if (this.host.getReadSecret()) this.out('  hint   : 文字はもう読んだ。', 'warn');
        break;

      case 'mem':
      case 'memory':
      case 'dump': {
        this.out('DUMPING 0x0000EA...', 'sys');
        for (let i = 0; i < 6; i++) {
          const row = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase());
          this.out(`  ${(0xEA0000 + i * 8).toString(16).toUpperCase()}  ${row.join(' ')}`, 'plain');
        }
        this.out('  末尾に文字列: "WAKE_…" (読み取り不能)', 'warn');
        break;
      }

      case 'time':
      case 'date':
        this.out(`  23:58:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}  (この時刻は進みません)`, 'plain');
        break;

      case 'exit':
      case 'quit':
      case 'logout':
        this.out('access denied: 終了先がありません。', 'err');
        this.out('0xC000021A  STATUS_SYSTEM_PROCESS_TERMINATED', 'err');
        break;

      case 'reboot':
      case 'shutdown':
      case 'restart':
        this.out('再起動できません。この部屋はあなたの記憶に書き込まれています。', 'err');
        this.attempts += 2;
        this.host.onGlitch(0.35);
        break;

      case 'sudo':
      case 'admin':
        this.out('permission denied. あなたはこの部屋の管理者ではありません。', 'err');
        break;

      case 'open':
      case 'start':
      case 'run':
        this.out(`'${arg || '?'}' を実行できません。 0x0000007B`, 'err');
        break;

      case 'credits':
        this.out('クレジットを開きます…', 'ok');
        this.host.onCredits();
        break;

      case 'glitch':
      case 'face':
      case ':(':
        this.host.onGlitch(0.5);
        this.audio.glitchBurst(0.7);
        this.out('  :(  ', 'err');
        break;

      // ---- the one that matters (case-insensitive, any spacing)
      case 'wake_up':
      case 'wakeup':
        this.wakeUp();
        break;

      // ---- near miss: same word, wrong shape
      case 'wake':
      case 'up':
      case 'wake-up':
        this.out('SYNTAX ERROR: コマンドは1つの語で、区切りは空白ではありません。', 'err');
        this.out('  0x000000EA  THREAD_STUCK_IN_DEVICE_DRIVER', 'err');
        this.host.onGlitch(0.25);
        this.attempts++;
        break;

      case '目覚めろ':
      case 'めざめ':
        this.out('日本語のコマンドは、この機械には届きません。', 'warn');
        this.out('  (でも、意味は届いている)', 'warn');
        this.host.onGlitch(0.2);
        break;

      default:
        this.unknown(cmd);
        break;
    }
  }

  private wakeUp() {
    this.out('> WAKE_UP', 'ok');
    this.out('command accepted.', 'ok');
    this.out('loading user…', 'sys');
    this.out('loading room…', 'sys');
    this.out('0x000000EA — the ground was never solid.', 'err');
    this.audio.ui('error');
    this.host.onWakeUp();
  }

  private fileRead(name: string) {
    switch (name) {
      case 'wake.dll':
        this.out('  MZ\x90\x00 binary — 中身は空白です。', 'plain');
        this.out('  ファイル末尾に: この世界はあなたの部屋の写しです。', 'warn');
        break;
      case 'room.dat':
        this.out('  room.dat は使用中です。読み取りは許可されていません。', 'err');
        break;
      case 'face.sys':
        this.out('  0x000000EA  :(  :(  :(  :(  :(  :(  :(  :(', 'err');
        this.host.onGlitch(0.3);
        break;
      case 'you.bin':
        this.out('  読み取り不能。このファイルはあなたが開いている。', 'warn');
        break;
      case 'memory.dmp':
        this.out('  …中に小さな部屋があります。あなたの部屋です。', 'warn');
        break;
      case 'console.exe':
        this.out('  実行中です（このウィンドウがそれです）。', 'ok');
        break;
      default:
        this.out(`cat: ${name}: そのようなファイルはありません (0x00000002)`, 'err');
    }
  }

  private unknown(cmd: string) {
    this.attempts++;
    const a = this.attempts;
    this.audio.ui('error');
    this.out(`'${cmd}' は内部コマンドでも外部コマンドでもありません。`, 'err');
    const pick = a % 5;
    if (pick === 0) this.out('  the machine is listening.', 'warn');
    if (pick === 1) this.out('  0x0000001A  MEMORY_MANAGEMENT', 'warn');
    if (pick === 2) this.out('  この操作は記録されました。 (誰が記録しているかは不明)', 'warn');
    if (pick === 3) this.out('  HELP を試しましたか。それとも、もう答えは知っていますか。', 'warn');
    if (pick === 4) {
      this.out('  …', 'warn');
      this.host.onGlitch(0.12);
    }
  }
}
