// ゲーム内コンソール(Cキーで起動。ブラウザDevToolsではない)
export class GameConsole {
  constructor(audio) {
    this.audio = audio;
    this.panel = document.getElementById('console-panel');
    this.logEl = document.getElementById('console-log');
    this.input = document.getElementById('console-input');
    this.isOpen = false;
    this.history = [];
    this.historyIdx = -1;
    this.discovery = false;
    this.onWakeUp = null;
    this.onToggle = null;

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') { this._exec(); }
      else if (e.code === 'ArrowUp') {
        e.preventDefault();
        if (this.history.length) {
          this.historyIdx = Math.min(this.history.length - 1, this.historyIdx + 1);
          this.input.value = this.history[this.history.length - 1 - this.historyIdx] || '';
        }
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.historyIdx = Math.max(-1, this.historyIdx - 1);
        this.input.value = this.historyIdx === -1 ? '' : this.history[this.history.length - 1 - this.historyIdx];
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key.length === 1) {
        this.audio.keyClack();
      }
    });
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.panel.classList.remove('hidden');
    this.input.value = '';
    this.historyIdx = -1;
    setTimeout(() => this.input.focus(), 30);
    this.audio.uiOpen();
    if (this.onToggle) this.onToggle(true, false);
    if (this.logEl.children.length === 0) {
      this.sys('SYS_CONSOLE v3.33 — session attached to corrupted process');
      this.sys("type 'help' for available commands.");
    }
  }

  // handoff=true は崩壊演出へ移るとき(ロック復帰しない)
  close(handoff = false) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.classList.add('hidden');
    this.input.blur();
    if (!handoff) this.audio.uiClose();
    if (this.onToggle) this.onToggle(false, handoff);
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  _add(text, cls = '') {
    const div = document.createElement('div');
    div.className = 'log-line ' + cls;
    div.textContent = text;
    this.logEl.appendChild(div);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
  sys(t) { this._add(t, 'log-sys'); }
  ok(t) { this._add(t, 'log-ok'); }
  err(t) { this._add(t, 'log-err'); }
  warn(t) { this._add(t, 'log-warn'); }

  _exec() {
    const raw = this.input.value.trim();
    if (!raw) return;
    this.history.unshift(raw);
    this.historyIdx = -1;
    this._add('> ' + raw, 'log-in');
    this.input.value = '';
    const cmd = raw.toLowerCase().replace(/\s+/g, ' ');
    this.route(cmd, raw);
  }

  route(cmd, raw) {
    const c = cmd.split(' ')[0];
    switch (c) {
      case 'help':
        this.sys('available commands:');
        this.sys('  help ................ この一覧');
        this.sys('  status .............. プロセス状態');
        this.sys('  whoami .............. 実行者の識別');
        this.sys('  dir / ls ............ メモリ内容の一覧');
        this.sys('  cls / clear ......... 画面を消す');
        this.sys('  echo <text> ......... 文字列を出力');
        this.sys('  version / ver ....... カーネル情報');
        this.sys('  reboot .............. 再起動試行');
        this.sys('  debug ............... 異常の診断');
        this.sys('  exit / close ........ コンソールを閉じる');
        this.sys('  ※ 世界のどこかに、脱出コマンドが隠されている');
        break;
      case 'status':
        this.sys('PROCESS: CRITICAL_PROCESS_DIED');
        this.sys('MEMORY: 87% corrupted — free pages: 0');
        this.sys('REALITY_LINK: unstable');
        this.sys('USER: still inside the screen');
        break;
      case 'whoami':
        this.warn('nt authority\\still_awake');
        this.sys('…いや、そうではない。誰がこれを打っている?');
        break;
      case 'dir': case 'ls':
        this.sys('C:\\SCREEN\\')
        this.sys('  error.log   page_fault.dmp   :(.sys   WAKE_UP.???');
        this.sys('  ※ 最後のファイルだけ、拡張子が壊れている');
        break;
      case 'cls': case 'clear':
        this.logEl.innerHTML = '';
        this.sys('memory cleared. the memory remains.');
        break;
      case 'echo':
        this._add(raw.slice(5).trim() || ' ', 'log-ok');
        break;
      case 'version': case 'ver':
        this.sys('BSOD_EX kernel 0x3F — build 3:33');
        this.sys('uptime: undefined');
        break;
      case 'reboot':
        this.err('REBOOT FAILED — boot device is the room you left.');
        this.audio.glitch(0.6);
        break;
      case 'debug':
        this.warn('diagnostic: the walls are rendering at 60fps. they should not move.');
        this.warn('diagnostic: your heartbeat is a system process now.');
        this.audio.glitch(0.4);
        break;
      case 'god': case 'godmode':
        this.err('ACCESS DENIED — this place has no gods, only admins.');
        break;
      case 'run': case 'exec':
        this.err('EXEC_FAILED — cannot run. you are already being run.');
        break;
      case 'home': case 'escape': case 'logout':
        this.warn('command not recognized here. find the real one.');
        break;
      case 'exit': case 'close': case 'quit':
        this.close();
        return;
      case 'wake_up': case 'wakeup':
        if (!this.discovery) {
          this.err('ERR_UNKNOWN_SIGNAL: "WAKE_UP" — その文字列はまだ、この世界に存在しない。');
          this.audio.glitch(0.5);
        } else {
          this.ok('> WAKE_UP … acknowledged.');
          this.warn('reality process terminating.');
          this.audio.blip(1200, 0.15, 'square', 0.1);
          if (this.clock) this.clock(0.5, () => this.onWakeUp && this.onWakeUp());
          else setTimeout(() => this.onWakeUp && this.onWakeUp(), 500);
        }
        break;
      default:
        this.err(`ERR_COMMAND_NOT_FOUND: '${c}' // the machine ignores you.`);
        this.audio.glitch(0.35);
    }
  }
}
