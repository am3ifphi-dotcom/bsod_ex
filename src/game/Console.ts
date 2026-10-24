import type { AudioEngine } from '../core/audio';
import type { UI } from '../ui/UI';
import { RNG } from '../core/util';

type Hooks = {
  inVoid: () => boolean;
  busy: () => boolean;
  onWakeUp: () => void;
  onOpen?: () => void;
  onClose?: () => void;
};

const FILES: Record<string, string> = {
  'boot.log': [
    'MEMORY_INTERFACE v0.9.3 — cold boot',
    '[0.000] operator: unknown',
    '[0.412] scanning memory map ........ 31% torn',
    '[0.913] personality buffer ........ OK',
    '[1.204] room_01 ................... LOADED',
    '[1.205] room_01.wallpaper ......... MISSING',
    '[2.490] dark_room_hum.ogg ......... LOOPING',
    '[3.017] WARNING: screen is a door',
  ].join('\n'),
  'readme.txt': [
    'この層は記録の残骸でできている。',
    '壊れた UI の向こうに、まだ命令がひとつ残っている。',
    '画面に書かれた名前を、そのまま打て。',
    '— ただし、打った後に元の部屋が残っているとは限らない。',
  ].join('\n'),
  'operator.dat': [
    'name: (削除済み)',
    'last_input: 03:07:00',
    'last_input_devices: keyboard, mouse, eyes',
    'wake_count: 1',
  ].join('\n'),
  'memory.map': [
    '0x0000 - 0x0FFF  room_01        [intact]',
    '0x1000 - 0x1AFF  room_01.prop   [corrupted]',
    '0x1B00 - 0x2FFF  corridor       [torn]',
    '0x3000 - 0x4FFF  monolith       [LOCKED — requires instruction]',
    '0x5000 - 0xFFFF  (unknown)',
  ].join('\n'),
};

const JUNK = ['MEMORY_MANAGEMENT_FAILURE', '0x0000001A', 'PAGE_FAULT_IN_NONPAGED_AREA', 'BAD_POOL_CALLER', 'KERNEL_SECURITY_CHECK_FAILURE'];

export class GameConsole {
  private history: string[] = [];
  private rng = new RNG(4711);
  private fired = false;

  constructor(private ui: UI, private audio: AudioEngine, private hooks: Hooks) {
    ui.onConsoleSubmit = (text) => this.submit(text);
  }

  get isOpen() { return this.ui.consoleOpen; }

  open() {
    if (this.isOpen) return;
    if (!this.hooks.inVoid()) {
      this.ui.openConsole();
      this.ui.printConsole('OPERATOR_CONSOLE はこの層からは到達できません。', 'err');
      this.ui.printConsole('memory_interface: LINK DOWN  (返答不能)', 'dim');
      this.ui.setConsoleInputEnabled(false);
      this.hooks.onOpen?.();
      return;
    }
    if (this.hooks.busy()) return;
    this.ui.clearConsole();
    this.ui.openConsole();
    this.ui.printConsole('OPERATOR_CONSOLE // MEMORY_INTERFACE', 'sys');
    this.ui.printConsole('接続: DIRECT  /  レイテンシ: --ms', 'dim');
    this.ui.printConsole('操作可能な命令があります。`help` で一覧。', 'dim');
    this.ui.printConsole('', 'dim');
    this.audio.consoleKey();
    this.hooks.onOpen?.();
  }

  close() {
    if (!this.isOpen) return;
    this.ui.setConsoleInputEnabled(true);
    this.ui.closeConsole();
    this.audio.uiTick(0.06);
    this.hooks.onClose?.();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  submit(raw: string) {
    const text = raw.replace(/\r|\n/g, '');
    this.ui.printConsole(`> ${text}`, 'in');
    const trimmed = text.trim();
    if (!trimmed) {
      // 空 Enter: 落ちない。静かに次のプロンプト
      this.audio.uiTick(0.05);
      this.ui.printConsole('', 'dim');
      return;
    }
    this.history.push(trimmed);
    this.audio.consoleKey();
    const lower = trimmed.toLowerCase();
    // コマンド名と引数 (連続する空白・アンダースコアの正規化)
    const norm = trimmed.replace(/\s+/g, ' ').trim();
    const [cmdRaw, ...args] = norm.split(' ');
    const cmd = cmdRaw.toLowerCase();
    const arg = args.join(' ');

    switch (cmd) {
      case 'help':
      case '?':
        this.ui.printConsole('使用可能な命令:', 'sys');
        this.ui.printConsole('  help          この一覧', 'dim');
        this.ui.printConsole('  status        この層の状態', 'dim');
        this.ui.printConsole('  ls / dir      記録の一覧', 'dim');
        this.ui.printConsole('  cat <file>    記録を読む', 'dim');
        this.ui.printConsole('  scan          周辺の走査', 'dim');
        this.ui.printConsole('  locate        中心構造物の座標', 'dim');
        this.ui.printConsole('  whoami        operator 情報', 'dim');
        this.ui.printConsole('  ver / date    バージョン・時刻', 'dim');
        this.ui.printConsole('  echo <text>   文字を返す', 'dim');
        this.ui.printConsole('  ping          応答確認', 'dim');
        this.ui.printConsole('  restore       復元 (未実装)', 'dim');
        this.ui.printConsole('  exit / close  コンソールを閉じる', 'dim');
        this.ui.printConsole('※ 実行できる命令はこれで全部ではない。', 'warn');
        break;
      case 'status':
        this.ui.printConsole('layer: 0x3   stability: 41.2%   integrity: DEGRADED', 'sys');
        this.ui.printConsole(`intrusions: ${this.rng.int(3, 9)}   dropped_frames: ${this.rng.int(120, 900)}`, 'dim');
        this.ui.printConsole('warning: operator host still reachable', 'warn');
        break;
      case 'ls':
      case 'dir':
        this.ui.printConsole('  boot.log        readme.txt', 'sys');
        this.ui.printConsole('  operator.dat    memory.map', 'sys');
        this.ui.printConsole('  ... 217 個の破損した記録 (名前なし)', 'dim');
        break;
      case 'cat':
      case 'more':
      case 'type': {
        const f = arg.trim().toLowerCase();
        if (!f) { this.ui.printConsole('usage: cat <file>', 'err'); this.audio.errorBeep(1); break; }
        const content = FILES[f];
        if (!content) {
          this.ui.printConsole(`cat: ${arg}: 記録が見つかりません (ERROR 0x${this.rng.int(0x1000, 0xFFFF).toString(16).toUpperCase()})`, 'err');
          this.audio.errorBeep(2);
          break;
        }
        this.ui.printConsole('', 'dim');
        for (const line of content.split('\n')) this.ui.printConsole(line, 'out');
        this.ui.printConsole('', 'dim');
        break;
      }
      case 'scan': {
        this.ui.printConsole('scanning... 31% ... 78% ... 100%', 'dim');
        this.ui.printConsole('構造物: 東 62m / 西 118m / 地下 -12m', 'sys');
        this.ui.printConsole('未知の信号: 1  (中心構造物 / 内部)', 'warn');
        this.audio.uiConfirm(true);
        break;
      }
      case 'locate':
        this.ui.printConsole('TARGET: monolith  x=0 z=-96  height≈93m', 'sys');
        this.ui.printConsole('status: 内部に命令が 1 つ保存されている', 'warn');
        break;
      case 'whoami':
        this.ui.printConsole('operator: (名前は削除されました)', 'sys');
        this.ui.printConsole('session: 2   wake_count: 1   host: room_01', 'dim');
        this.ui.printConsole('NOTE: あなたが最後に眠った時刻は 03:07', 'warn');
        break;
      case 'ver':
        this.ui.printConsole('MEMORY_INTERFACE v0.9.3 (build 07-03)', 'sys');
        this.ui.printConsole('kernel: blue_screen / 16-bit memory model', 'dim');
        break;
      case 'date':
      case 'time':
        this.ui.printConsole('system time: 03:07:00  (clocks stopped)', 'sys');
        break;
      case 'echo':
        this.ui.printConsole(arg || '', 'out');
        break;
      case 'ping':
        this.ui.printConsole('PING monolith (0x1F): 1 hop, 412ms', 'sys');
        this.ui.printConsole('PING room_01 (host):   request timed out', 'err');
        this.audio.errorBeep(1);
        break;
      case 'restore':
      case 'restore_room':
        this.ui.printConsole('restore: 対象 room_01 は現在「使用中」です。', 'warn');
        this.ui.printConsole('restore: 中断します (ERROR 0x00000024)', 'err');
        this.audio.errorBeep(2);
        break;
      case 'wake':
      case 'wake_up':
      case 'wakeup': {
        // 正規化: 大文字小文字・空白・アンダースコアの差を吸収
        const canon = norm.replace(/[\s_]+/g, '').toUpperCase();
        if (canon === 'WAKEUP') {
          if (this.fired) {
            this.ui.printConsole('instruction already accepted. 処理は進行中です。', 'warn');
            this.ui.printConsole('(この層はもう崩れ始めている)', 'dim');
            break;
          }
          this.fired = true;
          this.ui.printConsole('', 'dim');
          this.ui.printConsole('EXECUTING ......................', 'sys');
          this.ui.printConsole('instruction accepted', 'warn');
          this.ui.printConsole('WARNING: host integrity 12%', 'err');
          this.audio.uiConfirm(true);
          this.ui.setConsoleInputEnabled(false);
          this.hooks.onWakeUp();
        } else {
          this.unknown(trimmed);
        }
        break;
      }
      case 'clear':
        this.ui.clearConsole();
        break;
      case 'exit':
      case 'close':
      case 'quit':
        this.close();
        break;
      case 'sudo':
      case 'su':
        this.ui.printConsole('特権は不要です。あなたは既に内側にいます。', 'warn');
        break;
      case 'shutdown':
      case 'reboot':
        this.ui.printConsole('再起動は許可されていません。', 'err');
        this.ui.printConsole('(この層を閉じる方法は 1 つだけ)', 'dim');
        this.audio.errorBeep(2);
        break;
      case 'hello':
      case 'hi':
        this.ui.printConsole('こんにちは。まだそこにいますか。', 'sys');
        break;
      default:
        if (lower === 'wake up' || lower === 'wake_ up') {
          if (this.fired) {
            this.ui.printConsole('instruction already accepted. 処理は進行中です。', 'warn');
            break;
          }
          this.fired = true;
          this.ui.printConsole('EXECUTING ......................', 'sys');
          this.ui.setConsoleInputEnabled(false);
          this.hooks.onWakeUp();
          break;
        }
        this.unknown(trimmed);
    }
  }

  private unknown(raw: string) {
    const code = `0x${this.rng.int(0x1000, 0xFFFF).toString(16).toUpperCase().padStart(8, '0')}`;
    this.ui.printConsole(`'${raw}' は認識されません。 (ERROR ${code})`, 'err');
    const flavour = this.rng.pick([
      '記録の外側の言葉です。',
      'その名前は、まだ書かれていません。',
      'ここでは意味を持ちません。',
      `unknown instruction — ${this.rng.pick(JUNK)}`,
      'この文字列は既に誰かが試しました。',
    ]);
    this.ui.printConsole(flavour, 'dim');
    this.audio.errorBeep(2);
  }
}
