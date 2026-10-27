// console.js — the diegetic terminal inside the glitch world (C key)
const HELP_LINES = [
  'AVAILABLE INSTRUCTIONS:',
  '  HELP      — this fragment',
  '  STATUS    — query the world',
  '  WHOAMI    — identity check',
  '  SCAN      — local anomalies',
  '  TIME      — clock source',
  '  CLEAR     — wipe the glass',
  '  ABOUT     — credits of this artifact',
  '…some instructions are not listed.',
];

const ERRORS = [
  'SYNTAX REJECTED. THE GLASS IS STILL AWAKE.',
  'NO SUCH INSTRUCTION IN THIS CONTEXT.',
  'ERROR 0x000000' + 'FF — RECURSION IN PROGRESS.',
  'THE WORLD DOES NOT RECOGNIZE THAT SHAPE.',
  '…ECHO ONLY. NOTHING EXECUTED.',
  'PARSE FAILURE AT LINE ∞.',
];

export class GameConsole {
  constructor({ audio, onWake, onCommand, onClose }) {
    this.audio = audio;
    this.onWake = onWake;
    this.onCommand = onCommand;
    this.onClose = onClose;
    this.opened = false;
    this.discovered = false;
    this.history = [];
    this.wrap = document.getElementById('console-wrap');
    this.log = document.getElementById('console-log');
    this.input = document.getElementById('console-input');
    this._blocker = (e) => { e.stopPropagation(); };

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this._submit();
      else if (e.key === 'Escape') this.close();
      else if (e.key.length === 1 || e.key === 'Backspace') {
        this.audio.play('terminal_prompt', { vol: 0.16, rate: 0.9 + Math.random() * 0.35, bus: 'ui' });
      }
    });
    // prevent the game from seeing console keys
    this.wrap.addEventListener('keydown', this._blocker);
    this.wrap.addEventListener('keyup', this._blocker);
    this.wrap.addEventListener('click', () => this.input.focus());
  }

  open() {
    if (this.opened) return;
    this.opened = true;
    this.wrap.classList.remove('hidden');
    this._print('bsod shell v0.9 — connection unstable', 'c-sys');
    this._print('type HELP for the fragment list.', 'c-sys');
    if (this.discovered) this._print('the glass remembers the word.', 'c-sys');
    setTimeout(() => this.input.focus(), 30);
    this.audio.play('doorclick', { vol: 0.5, bus: 'ui' });
  }

  close() {
    if (!this.opened) return;
    this.opened = false;
    this.wrap.classList.add('hidden');
    this.input.blur();
    this.audio.play('mclick', { vol: 0.4, bus: 'ui' });
    if (this.onClose) this.onClose();
  }

  toggle() { this.opened ? this.close() : this.open(); }

  discover() {
    if (this.discovered) return;
    this.discovered = true;
  }

  _print(text, cls) {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    this.log.appendChild(div);
    this.log.scrollTop = this.log.scrollHeight;
  }

  _submit() {
    const raw = this.input.value.trim();
    this.input.value = '';
    if (!raw) return;
    this._print('guest@bsod:~$ ' + raw, 'c-in');
    this.audio.play('terminal_prompt', { vol: 0.35, bus: 'ui' });
    const cmd = raw.toUpperCase().replace(/\s+/g, ' ');

    if (cmd === 'CLEAR' || cmd === 'CLS') {
      this.log.innerHTML = '';
      return;
    }

    if (cmd === 'WAKE_UP') {
      if (!this.discovered) {
        this._print('ERROR: TOKEN NOT RECOGNIZED IN THIS CONTEXT.', 'c-err');
        this._print('…yet the glass trembles when you say it.', 'c-sys');
        this.audio.play('deniedbeep', { vol: 0.5, bus: 'ui' });
        if (this.onCommand) this.onCommand('wake_refused');
        return;
      }
      this._print('WAKE_UP … ACCEPTED.', 'c-ok');
      this._print('RELEASING THE WORLD.', 'c-ok');
      this.audio.play('terminal_success', { vol: 0.6, bus: 'ui' });
      setTimeout(() => { if (this.onWake) this.onWake(); }, 420);
      return;
    }

    switch (cmd) {
      case 'HELP':
      case '?':
        HELP_LINES.forEach((l) => this._print(l, 'c-sys'));
        this.audio.play('twobeep', { vol: 0.4, bus: 'ui' });
        break;
      case 'STATUS':
        this._print('WORLD STATE   : FRAGMENTED', 'c-sys');
        this._print('HEAP          : 0x00007FF6`WAKE_UP', 'c-sys');
        this._print('USER          : GUEST (UNREGISTERED)', 'c-sys');
        this._print('EXIT PATH     : NONE MAPPED', 'c-err');
        this.audio.play('twobeep', { vol: 0.4, bus: 'ui' });
        break;
      case 'WHOAMI':
        this._print('guest. you fell in through the smile.', 'c-sys');
        this.audio.play('beep', { vol: 0.45, bus: 'ui' });
        break;
      case 'SCAN':
        this._print('scanning…', 'c-sys');
        this._print('  anomaly ▸ the tower hums in 7/8 time', 'c-sys');
        this._print('  anomaly ▸ 416 glyphs missing their parents', 'c-sys');
        this._print('  anomaly ▸ a word is carved into the glass, east of here', 'c-sys');
        if (!this.discovered) this._print('  …find the monolith.', 'c-sys');
        this.audio.play('triplebeep', { vol: 0.45, bus: 'ui' });
        break;
      case 'TIME':
        this._print('CLOCK SOURCE: DETACHED. LAST KNOWN: 03:33', 'c-sys');
        this.audio.play('beep', { vol: 0.4, bus: 'ui' });
        break;
      case 'ABOUT':
      case 'CREDITS':
        this._print('BSOD_EX — a small glitch horror experience', 'c-sys');
        this._print('models: Sketchfab CC assets & community GLBs', 'c-sys');
        this._print('audio: tgstation sound pack (CC BY-SA 3.0), Kenney (CC0)', 'c-sys');
        this._print('thanks for playing in the dark.', 'c-sys');
        this.audio.play('twobeep', { vol: 0.4, bus: 'ui' });
        break;
      default: {
        const e = ERRORS[(Math.random() * ERRORS.length) | 0];
        this._print(e, 'c-err');
        this.audio.play('deniedbeep', { vol: 0.42, bus: 'ui' });
        if (this.onCommand) this.onCommand('error');
        break;
      }
    }
  }
}
