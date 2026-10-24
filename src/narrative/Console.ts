/**
 * The in-world console (not the browser devtools). Opened with C while inside the glitch world.
 * Commands are pseudo-commands: help/status/ls/cat/whoami/ping/echo/scan/log/exit… and, of
 * course, the one command the world is waiting for. Unknown input always gets an in-fiction
 * response; nothing crashes, nothing leaks.
 */

export interface ConsoleLine {
  text: string;
  cls: 'cmd' | 'err' | 'ok' | 'sys' | 'warn' | 'line';
}

export interface ConsoleContext {
  areaName: string;
  wakeKnown: boolean;
  onWakeUp: () => void;
  onExit?: () => void;
  playType?: () => void;
  playError?: () => void;
  playOk?: () => void;
  visitedAreas: string[];
}

const FILES = {
  'notes.txt': [
    'it keeps the same room.',
    'it is not the same room.',
    'the clock never moves past 03:47.',
    '',
    'i counted the windows. there are two.',
    'the room only has one.',
  ],
  'wake.log': [
    '00:01 boot — memory sectors remapped',
    '03:47 anomaly — occupant reported a blue screen',
    '03:47 anomaly — occupant clicked the face 6 times',
    '03:48 intrusion — occupant transferred into sector 0',
    '— record ends —',
  ],
  'manifest.dat': [
    'EXHIBIT 00 .... flight helmet',
    'EXHIBIT 01 .... the street that was never built',
    'EXHIBIT 02 .... a sofa nobody sat on',
    'EXHIBIT 03 .... the word',
  ],
  'readme': [
    'This machine is a room.',
    'The room is a machine.',
    'To leave, say the word the monolith says.',
  ],
};

export class GameConsole {
  private ctx: ConsoleContext;
  private wakeArmed = false;

  constructor(ctx: ConsoleContext) {
    this.ctx = ctx;
  }

  setContext(patch: Partial<ConsoleContext>): void {
    this.ctx = { ...this.ctx, ...patch };
  }

  /** Intro lines shown when the console opens. */
  welcome(): ConsoleLine[] {
    return [
      { text: 'MEMORY CONSOLE v0.9.3 — session 0x2F63', cls: 'sys' },
      { text: `linked sector: ${this.ctx.areaName}   integrity: ${(47 + Math.random() * 4).toFixed(1)}%`, cls: 'sys' },
      { text: "type 'help' for local commands.", cls: 'sys' },
    ];
  }

  submit(raw: string): ConsoleLine[] {
    const text = raw.trim();
    const lines: ConsoleLine[] = [];
    const echo: ConsoleLine = { text: `> ${raw}`, cls: 'cmd' };
    lines.push(echo);

    if (!text) {
      this.ctx.playError?.();
      lines.push({ text: 'ERR_EMPTY_INPUT :: the machine heard nothing, and waited.', cls: 'err' });
      lines.push({ text: 'null :: 0x00000000', cls: 'err' });
      return lines;
    }

    // normalise: case, spaces, extra separators
    const norm = text.toLowerCase().replace(/[\s_\-]+/g, '');
    const cmd = text.trim().split(/\s+/)[0].toLowerCase();
    const args = text.trim().split(/\s+/).slice(1);

    if (norm === 'wakeup') {
      this.wakeArmed = true;
      this.ctx.playOk?.();
      lines.push({ text: '> resolving word …', cls: 'sys' });
      lines.push({ text: '> WAKE_UP accepted.', cls: 'ok' });
      lines.push({ text: '', cls: 'line' });
      lines.push({ text: 'the room turns its head.', cls: 'warn' });
      this.ctx.onWakeUp();
      return lines;
    }

    switch (cmd) {
      case 'help':
        lines.push({ text: 'available: help, status, ls, cat <file>, whoami, ping, echo <text>,', cls: 'line' });
        lines.push({ text: '           scan, log, map, clear, exit', cls: 'line' });
        lines.push({ text: 'some words are not listed.', cls: 'warn' });
        break;
      case 'status':
        lines.push({ text: `sector............ ${this.ctx.areaName}`, cls: 'line' });
        lines.push({ text: `integrity......... ${(40 + Math.random() * 12).toFixed(1)}%`, cls: 'line' });
        lines.push({ text: 'occupant.......... 1 (unresolved)', cls: 'line' });
        lines.push({ text: 'exit.............. unknown', cls: 'warn' });
        break;
      case 'ls':
      case 'dir':
        lines.push({ text: Object.keys(FILES).join('   '), cls: 'line' });
        lines.push({ text: '1 directory, 4 files, 1 missing', cls: 'sys' });
        break;
      case 'cat':
        if (!args.length) {
          lines.push({ text: 'usage: cat <file>', cls: 'err' });
          this.ctx.playError?.();
        } else {
          const key = Object.keys(FILES).find((f) => f === args[0] || f.startsWith(args[0]));
          if (!key) {
            lines.push({ text: `cat: ${args[0]}: no such file`, cls: 'err' });
            lines.push({ text: 'the file might be on the other side of the screen.', cls: 'warn' });
            this.ctx.playError?.();
          } else {
            for (const l of FILES[key as keyof typeof FILES]) lines.push({ text: l, cls: 'line' });
          }
        }
        break;
      case 'whoami':
        lines.push({ text: 'occupant_0001 (temporary)', cls: 'line' });
        lines.push({ text: 'previous occupant: the same, 14 times', cls: 'warn' });
        break;
      case 'ping':
        lines.push({ text: 'PING monolith (0.0.0.0): 56 data bytes', cls: 'line' });
        lines.push({ text: '64 bytes from the other room: ttl=3 time=0.47 ms', cls: 'line' });
        lines.push({ text: '1 packet lost — the word is still there', cls: 'warn' });
        break;
      case 'echo':
        lines.push({ text: args.join(' ') || ' ', cls: 'line' });
        break;
      case 'scan':
      case 'map':
        lines.push({ text: `mapped sectors: ${this.ctx.visitedAreas.length ? this.ctx.visitedAreas.join(', ') : 'none'}`, cls: 'line' });
        lines.push({ text: 'a signal is coming from the tallest structure.', cls: 'sys' });
        lines.push({ text: 'it repeats the same eight characters.', cls: 'warn' });
        break;
      case 'log':
        for (const l of FILES['wake.log']) lines.push({ text: l, cls: 'line' });
        break;
      case 'clear':
        break;
      case 'exit':
      case 'quit':
      case 'logout':
        lines.push({ text: 'there is no logout. there is only the word.', cls: 'warn' });
        this.ctx.onExit?.();
        break;
      case 'wake':
        if (args.length && args[0].toLowerCase() === 'up') {
          lines.push({ text: '> separated input. join the words.', cls: 'warn' });
        } else {
          lines.push({ text: 'wake: command incomplete — a subject is required.', cls: 'warn' });
          lines.push({ text: 'try the monolith. it has been saying it all along.', cls: 'sys' });
        }
        break;
      case 'wake_up':
        lines.push({ text: '> malformed token. the machine prefers it as one word.', cls: 'warn' });
        break;
      case 'reboot':
      case 'restart':
      case 'reset':
        lines.push({ text: 'reboot: permission denied — an occupant is still inside.', cls: 'err' });
        this.ctx.playError?.();
        break;
      case 'format':
      case 'rm':
      case 'kill':
      case 'sudo':
        lines.push({ text: `> ${cmd}: this machine is not yours to erase.`, cls: 'err' });
        lines.push({ text: '0x80070005 — ACCESS_DENIED', cls: 'err' });
        this.ctx.playError?.();
        break;
      case 'hello':
      case 'hi':
        lines.push({ text: 'HELLO. YOU ARE EARLY.', cls: 'sys' });
        break;
      case 'help_me':
      case 'escape':
        lines.push({ text: 'no such command. the exit is a word, not a door.', cls: 'warn' });
        break;
      default: {
        this.ctx.playError?.();
        const codes = ['0x000000EF', '0xC000021A', '0x0000007B', '0xDEADBEEF', '0x80004005'];
        const code = codes[Math.floor(Math.random() * codes.length)];
        lines.push({ text: `'${cmd}' is not recognized as an internal command.`, cls: 'err' });
        lines.push({ text: `error ${code} :: the machine repeated your word back, slowly.`, cls: 'err' });
        if (Math.random() < 0.35) lines.push({ text: 'somewhere far away, something typed the same thing.', cls: 'warn' });
        break;
      }
    }
    return lines;
  }

  get hasAcceptedWake(): boolean { return this.wakeArmed; }

  /** Full reset for replay. */
  reset(): void {
    this.wakeArmed = false;
  }
}
