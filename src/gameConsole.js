// gameConsole.js — the in-world console (C key). Not the browser devtools.
// Input-safe: IME composition guard, key-repeat guard, history, and the game
// loop fully ignores gameplay keys while this is open (handled in main.js).
export class GameConsole {
  constructor(hooks) {
    this.hooks = hooks; // { tryWakeUp(), getStatus(), onClose(), audio, dev, devCommand(args) }
    this.el = document.getElementById('console');
    this.log = document.getElementById('consoleLog');
    this.input = document.getElementById('consoleInput');
    this.isOpen = false; this.composing = false; this.history = []; this.hIdx = -1; this.errCount = 0;
    this.input.addEventListener('compositionstart', () => this.composing = true);
    this.input.addEventListener('compositionend', () => this.composing = false);
    this.input.addEventListener('keydown', e => this._onKey(e));
    document.getElementById('consoleClose').addEventListener('click', () => this.close());
    this.printBoot();
  }
  printBoot() {
    this.log.innerHTML = '';
    this.line('MEM://CONSOLE v0.9.∞ — カーネルへの接続を確立しました', 'dim');
    this.line('セッション: guest@bsod  権限: 読み取り専用のはずだった', 'dim');
    this.line('「help」と入力すると、壊れていない範囲で使い方を表示します。', '');
    this.line('— 信号は不安定です。このコンソール自体、食われかけています —', 'warn-t');
  }
  open() {
    if (this.isOpen) return; this.isOpen = true;
    this.el.classList.remove('hidden');
    this.hooks.audio && this.hooks.audio._blip && this.hooks.audio._blip(1046, .07, .04, 'square');
    setTimeout(() => { this.input.focus(); this.input.select(); }, 30);
    this.log.scrollTop = this.log.scrollHeight;
  }
  close() {
    if (!this.isOpen) return; this.isOpen = false;
    this.el.classList.add('hidden'); this.input.blur();
    this.hooks.onClose && this.hooks.onClose();
  }
  line(text, cls = '') {
    const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text;
    this.log.appendChild(d);
    while (this.log.children.length > 220) this.log.removeChild(this.log.firstChild);
    this.log.scrollTop = this.log.scrollHeight;
  }
  _onKey(e) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); if (!this.history.length) return;
      this.hIdx = e.key === 'ArrowUp' ? Math.max(0, this.hIdx - 1) : Math.min(this.history.length, this.hIdx + 1);
      this.input.value = this.history[this.hIdx] ?? '';
      setTimeout(() => this.input.setSelectionRange(99, 99), 0); return;
    }
    if (e.key === 'Enter') {
      if (this.composing || e.isComposing || e.keyCode === 229) return; // IME確定のEnterは実行しない
      e.preventDefault(); if (e.repeat) return;
      const raw = this.input.value; this.input.value = '';
      this.execute(raw);
    }
  }
  execute(raw) {
    const cmdline = (raw ?? '').trim();
    this.line('guest@bsod:~> ' + cmdline, 'you');
    if (!cmdline) return; // 空Enter: 何もしない（壊れない）
    this.history.push(cmdline); this.hIdx = this.history.length;
    const [headRaw, ...rest] = cmdline.split(/\s+/);
    const head = headRaw.toLowerCase();
    const args = rest.join(' ');
    const A = this.hooks.audio;
    switch (head) {
      case 'help': case '?': case 'h':
        this.line('— 利用可能なコマンド（残存分） —', 'dim');
        [['help', 'この一覧'], ['status', 'あなたの現在状態'], ['scan', '周辺メモリを走査'], ['ls', 'このセクターの内容'], ['cat <file>', 'ファイルを読む'], ['echo <text>', '反響させる'], ['whoami', 'あなたは誰か'], ['clear', '画面を消去'], ['exit', 'コンソールを閉じる'], ['reboot', '再起動を試みる（推奨しません）']]
          .forEach(([c, d]) => this.line(`  ${c.padEnd(12)} ${d}`));
        this.line('…一覧の最後の項目が、ノイズで読めません: 「W���_��」', 'warn-t'); break;
      case 'status': { const s = this.hooks.getStatus();
        this.line(`位置セクター : ${s.area}`); this.line(`回収した断片 : ${s.fragments} / ${s.fragmentsTotal}`);
        this.line(`同期率       : ${(98.4 - s.fragments * 3.7).toFixed(1)} % （低下中）`);
        this.line(s.discovered ? '記憶内キー   : [ 認識済みの言葉があります ]' : '記憶内キー   : [ 未発見 ]', s.discovered ? 'ok' : 'dim'); break; }
      case 'scan': { const s = this.hooks.getStatus();
        this.line('走査中… ▚▚▚▚▚▚▚░░░');
        this.line(s.nearestFragment != null ? `未回収の断片まで約 ${s.nearestFragment} m の残響を検知` : '近傍に未回収の断片はありません', 'dim');
        this.line(`中心構造物まで約 ${s.toSpire} m — 信号はそちらから来ています`, 'dim'); break; }
      case 'ls': case 'dir':
        this.line('MEM://sector/current/'); this.line('  memory.log    diary_2026.txt    夢の残り.bin    :(    .hidden', 'dim'); break;
      case 'cat': case 'type': {
        const f = args.toLowerCase();
        if (f.includes('memory')) { this.line('log: 03:12 ブルースクリーン発生'); this.line('log: 03:13 ユーザーが画面をクリックし続けている'); this.line('log: 03:14 ユーザーが見つかりません', 'warn-t'); this.line('log: ??:?? ユーザーは「中」にいます', 'err'); }
        else if (f.includes('diary')) { this.line('「最近、PCのファンの音が人の声みたいに聞こえる。気のせいだと思う。'); this.line('　あと、ブルースクリーンの顔文字、昨日と向きが違った気がする」', 'dim'); }
        else if (f.includes('hidden')) { this.line('壊れていない言葉は、世界の中心で待っている。', 'ok'); this.line('読めたら、ここへ戻ってきて、そのまま打て。', 'ok'); }
        else if (!f) this.line('使い方: cat <file> （ls で一覧）', 'warn-t');
        else { this.line(`ERR 0x0002: '${args}' は存在しないか、食われました`, 'err'); A && A.errorBuzz(); }
        break; }
      case 'echo': this.line(args ? args.split('').map(c => Math.random() < .06 ? '�' : c).join('') : '（反響なし）…ここでは音が戻ってきません', 'dim'); break;
      case 'whoami': this.line('guest …いいえ。あなたは「ユーザー」のはずです。', 'warn-t'); this.line('権限レコードが書き換えられています。誰に？', 'dim'); break;
      case 'clear': case 'cls': this.log.innerHTML = ''; break;
      case 'exit': case 'quit': case 'q': case 'close': this.line('接続を閉じます。…また会いましょう、すぐに。', 'dim'); setTimeout(() => this.close(), 260); break;
      case 'reboot': case 'restart': case 'shutdown':
        this.line('再起動シーケンスを開始… できません。', 'err'); this.line('ERR 0x0000FACE: 終了を拒否されました。理由: 「まだ夢の途中」', 'err'); A && A.errorBuzz(); break;
      case 'ver': case 'version': this.line('BSOD_EX kernel 0.9.∞ / MEM build 20261024', 'dim'); break;
      case ':(': this.line('…こちらも、悲しいのです。ずっとここにいるので。', 'warn-t'); break;
      case 'wake_up': case 'wakeup': case 'wake': {
        const r = this.hooks.tryWakeUp(head);
        if (r === 'ok') { this.line('キー認証 … [ OK ]', 'ok'); this.line('世界の整合性を解除します。足元に注意してください。', 'warn-t'); }
        else if (r === 'wrongform') { this.line('ERR 0x0BAD: 惜しい。言葉の「形」が違います。中心で見た通りに。', 'warn-t'); A && A.errorBuzz(); }
        else { this.line('ERR 0x0000FACE: その文字列への参照が壊れています (dangling reference)', 'err'); this.line('— 意味はあります。でも、あなたの中にまだ「ない」のです —', 'dim'); A && A.errorBuzz(); }
        break; }
      case 'debug': if (this.hooks.dev && this.hooks.devCommand) { this.hooks.devCommand(args, msg => this.line(msg, 'ok')); }
        else { this.line('ERR 0x0005: アクセスが拒否されました', 'err'); A && A.errorBuzz(); } break;
      default: {
        this.errCount++;
        const msgs = [
          `ERR 0x${(0x1000 + this.errCount * 257).toString(16).toUpperCase()}: '${headRaw}' は認識できないコマンドです`,
          `'${headRaw}' …その言葉には力がありません。ここでは通じません。`,
          `ERR 0xC0000005: アクセス違反 — '${headRaw}' の先には何もいません`,
          `入力を受け付けました。…誰かが、向こう側で笑いました。`,
        ];
        this.line(msgs[this.errCount % msgs.length], 'err');
        if (this.errCount % 5 === 0) this.line(':(', 'warn-t');
        A && A.errorBuzz();
      }
    }
  }
}
