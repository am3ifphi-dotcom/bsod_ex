/**
 * ゲーム内コンソールのコマンドロジック
 * 「WAKE_UP」だけが崩壊イベントを開始する。他は世界観に沿った応答。
 */
export interface ConsoleLine {
  text: string;
  cls: 'sys' | 'err' | 'ok' | 'user';
}

export interface ExecResult {
  lines: ConsoleLine[];
  wakeUp: boolean;
  clear?: boolean;
}

const SYM = '▓▒░█│─┌┐└┘├┤┬┴┼═║╔╗╚╝';

function garble(s: string, p = 0.12): string {
  return s
    .split('')
    .map((c) => (Math.random() < p && c !== ' ' ? SYM[Math.floor(Math.random() * SYM.length)] : c))
    .join('');
}

let floodCount = 0;
let lastExec = 0;

export function resetConsoleState(): void {
  floodCount = 0;
  lastExec = 0;
}

export function bootLines(): ConsoleLine[] {
  return [
    { text: 'BSOD_SYS // TERMINAL FRAGMENT v0.—build lost', cls: 'sys' },
    { text: garble('接続: MEMORY DUMP 経由 / 遅延 0x0000 0000'), cls: 'sys' },
    { text: '入力を待機しています。help で断片の一覧を表示(完全ではありません)。', cls: 'sys' },
  ];
}

export function execCommand(raw: string): ExecResult {
  const now = performance.now();
  const dt = now - lastExec;
  lastExec = now;
  if (dt < 90) {
    floodCount++;
    if (floodCount > 6) {
      return {
        lines: [{ text: 'ERR 0x77 — FLOOD DETECTED。入力バッファが溺れています。', cls: 'err' }],
        wakeUp: false,
      };
    }
  } else if (dt > 800) {
    floodCount = 0;
  }

  const trimmed = raw.trim();
  const userLine: ConsoleLine = { text: `> ${raw}`, cls: 'user' };

  if (trimmed === '') {
    return {
      lines: [userLine, { text: 'ERR 0x000C — NO INPUT STREAM。空白は送れません。', cls: 'err' }],
      wakeUp: false,
    };
  }

  const cmd = trimmed.toLowerCase();

  // 唯一の脱出コマンド(大文字小文字は問わない)
  if (cmd === 'wake_up' || cmd === 'wakeup' || cmd === 'wake-up') {
    return {
      lines: [
        userLine,
        { text: garble('プロトコル WAKE_UP を受信しました。', 0.06), cls: 'ok' },
        { text: '整合性チェック ......... OK', cls: 'ok' },
        { text: '脱出シーケンスを開始します。', cls: 'ok' },
        { text: 'WARNING: WORLD INTEGRITY 0%', cls: 'err' },
      ],
      wakeUp: true,
    };
  }

  switch (cmd) {
    case 'help':
    case '?':
      return {
        lines: [
          userLine,
          { text: '--- 利用可能な断片 ---', cls: 'sys' },
          { text: '  status   : 世界の状態', cls: 'sys' },
          { text: '  sysinfo  : 端末情報', cls: 'sys' },
          { text: '  dir / ls : 記憶領域の一覧', cls: 'sys' },
          { text: '  whoami   : 現在の主体', cls: 'sys' },
          { text: '  run      : モジュール実行', cls: 'sys' },
          { text: '  cls      : 表示の消去', cls: 'sys' },
          { text: garble('  その他  : いくつかのコマンドが欠落しています。'), cls: 'sys' },
          { text: '---------------------', cls: 'sys' },
        ],
        wakeUp: false,
      };
    case 'status':
      return {
        lines: [
          userLine,
          { text: 'WORLD ................. CORRUPTED', cls: 'sys' },
          { text: 'SKY ................... ERROR_BLUE', cls: 'sys' },
          { text: `HOST .................. ${Math.random() > 0.5 ? 'PRESENT' : 'still dreaming'}`, cls: 'sys' },
          { text: 'EXIT PROTOCOL ......... ██ LOCKED', cls: 'err' },
          { text: garble('ヒント: この世界の中心で言葉が読める。'), cls: 'sys' },
        ],
        wakeUp: false,
      };
    case 'sysinfo':
    case 'info':
      return {
        lines: [
          userLine,
          { text: 'BSOD_EX TERMINAL 0x0000', cls: 'sys' },
          { text: 'MEM  : 0xDEAD0000 - 0xDEADFFFF (loop)', cls: 'sys' },
          { text: 'SOUL : PRESENT / UNREGISTERED', cls: 'sys' },
          { text: 'TIME : 02:17 (stopped)', cls: 'sys' },
          { text: garble('入力デバイス: キーボード(壊れかけ)'), cls: 'sys' },
        ],
        wakeUp: false,
      };
    case 'dir':
    case 'ls':
      return {
        lines: [
          userLine,
          { text: 'memory://dump/', cls: 'sys' },
          { text: '  room.bsp ............ 4.2 MB   saved', cls: 'sys' },
          { text: '  face.png ............ 13 KB    damaged', cls: 'sys' },
          { text: '  city.arc ............ ???      fragmented', cls: 'sys' },
          { text: '  wake_up.sys ......... [LOCKED]', cls: 'err' },
          { text: '  you_are_here.txt .... 0 B', cls: 'sys' },
        ],
        wakeUp: false,
      };
    case 'whoami':
      return {
        lines: [
          userLine,
          { text: 'GUEST_0x01 // ここへ落ちてきた人', cls: 'sys' },
          { text: garble('元の場所: 自室(ドアは閉まっている)'), cls: 'sys' },
        ],
        wakeUp: false,
      };
    case 'run':
    case 'exec':
      return {
        lines: [
          userLine,
          { text: 'ERR 0x21 — MODULE MISSING。実行する名前が足りません。', cls: 'err' },
        ],
        wakeUp: false,
      };
    case 'exit':
    case 'quit':
    case 'logout':
      return {
        lines: [
          userLine,
          { text: 'ERR 0x0018 — EXIT REJECTED。この場所はあなたを手放しません。', cls: 'err' },
          { text: garble('ただし、閉じる方法は「存在する」。'), cls: 'sys' },
        ],
        wakeUp: false,
      };
    case 'cls':
    case 'clear':
      return { lines: [userLine], wakeUp: false, clear: true };
    case 'wake':
      return {
        lines: [
          userLine,
          { text: 'ERR 0x0042 — INCOMPLETE SEQUENCE。言葉が途中で切れています。', cls: 'err' },
        ],
        wakeUp: false,
      };
    default: {
      // run <x> 形式
      const parts = cmd.split(/\s+/);
      if (parts[0] === 'run' && parts.length > 1) {
        return {
          lines: [
            userLine,
            { text: `ERR 0x21 — MODULE NOT FOUND: ${parts[1]}`, cls: 'err' },
            { text: garble('欠落したモジュールは、この世界のどこかに落ちている。'), cls: 'sys' },
          ],
          wakeUp: false,
        };
      }
      const creepy = [
        'そんなコマンドは最初から無い。',
        'その入力は、誰かの夢に届いた。',
        'キーボードが少しだけ温かい。',
        '入力の行が1つ増えている。あなたは増えていない。',
      ];
      return {
        lines: [
          userLine,
          { text: `ERR 0x00FF — UNKNOWN OPCODE: ${trimmed.slice(0, 32)}`, cls: 'err' },
          { text: garble(creepy[Math.floor(Math.random() * creepy.length)], 0.08), cls: 'sys' },
        ],
        wakeUp: false,
      };
    }
  }
}
