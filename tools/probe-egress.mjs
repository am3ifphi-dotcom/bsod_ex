/**
 * 外向き通信の実測プローブ — 「どのホストに届くか」を推測でなく測る
 * -------------------------------------------------------------
 * Arena / E2B のサンドボックスは外向き HTTPS をホスト名（TLS の SNI）で絞る。
 * 遮断は HTTP ステータスではなく TLS ハンドシェイクの失敗（curl 35 / code 000）
 * として現れるので、見た目で判断せず必ず実測する。
 *
 *   node tools/probe-egress.mjs                 # 既知の候補マトリクスを測定
 *   node tools/probe-egress.mjs example.com     # 追加ホストも測る
 *   node tools/probe-egress.mjs --json          # 機械可読で出す
 *
 * 結果の読み方:
 *   OK   … そのホストは輸送路に使える（アセットを載せ替えて取得できる）
 *   TLS  … 名前解決はできても TLS で切られる＝許可リスト外
 *   DNS  … 名前すら引けない
 *   HTTP … 届いたが 4xx/5xx（経路としては生きている。認証やパスの問題）
 */
import { execFile } from 'node:child_process';

const CANDIDATES = [
  // --- GitHub 系（輸送路になり得る） ---
  'https://api.github.com/rate_limit',
  'https://codeload.github.com/octocat/Hello-World/tar.gz/refs/heads/master',
  'https://github.com/octocat/Hello-World',
  // --- GitHub 系（ redirect 先で死にやすい） ---
  'https://raw.githubusercontent.com/octocat/Hello-World/master/README',
  'https://gist.githubusercontent.com/',
  'https://objects.githubusercontent.com/',
  'https://camo.githubusercontent.com/',
  'https://octocat.github.io/',
  // --- パッケージレジストリ（任意ファイルを載せられる輸送路） ---
  'https://registry.npmjs.org/three',
  'https://registry.npmjs.org/three/-/three-0.186.1.tgz',
  'https://pypi.org/pypi/requests/json',
  'https://files.pythonhosted.org/packages/source/r/requests/requests-2.32.3.tar.gz',
  // --- よく提案されるが遮断されやすい CDN / プロキシ ---
  'https://cdn.jsdelivr.net/gh/octocat/Hello-World@master/README',
  'https://unpkg.com/three/package.json',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.186.1/three.module.min.js',
  // --- 3D アセット側 ---
  'https://sketchfab.com/',
  'https://api.sketchfab.com/v3/search?type=models',
  'https://huggingface.co/api/models',
  'https://marketplace.canva.com/',
  // --- Google（コネクタは別経路。HTTP は大概遮断） ---
  'https://www.googleapis.com/drive/v3/about',
  'https://storage.googleapis.com/',
  'https://drive.google.com/',
  'https://drive.usercontent.google.com/',
];

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const extra = args.filter((a) => !a.startsWith('--')).map((a) => (a.startsWith('http') ? a : `https://${a}/`));
const targets = [...CANDIDATES, ...extra];

function probe(url, timeout = 12) {
  return new Promise((resolve) => {
    execFile(
      'curl',
      // -S: -s でもエラー文言を stderr に出させる（遮断理由の判定に使う）
      ['-sS', '-o', '/dev/null', '-m', String(timeout), '-w', '%{http_code}|%{content_type}|%{size_download}', '-L', url],
      { timeout: (timeout + 5) * 1000 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = `${stderr || err.message || ''}`.replace(/\s+/g, ' ').trim();
          const c = typeof err.code === 'number' ? err.code : Number((msg.match(/\((\d+)\)/) || [])[1]) || 0;
          // curl の終了コードで遮断の種類を確定させる
          const kind =
            c === 6 ? 'DNS'
            : c === 28 ? 'TIMEOUT'
            : c === 7 ? 'REFUSED'
            : [35, 58, 59, 60, 77, 80, 82, 83, 90, 91].includes(c) ? 'TLS'
            : /ssl|tls|handshake|certificate|cipher/.test(msg.toLowerCase()) ? 'TLS'
            : /resolve|name or service/.test(msg.toLowerCase()) ? 'DNS'
            : c === 18 || c === 92 || c === 56 || c === 52 ? 'TLS' // 接続を途中で切られる＝SNI 遮断の典型
            : 'ERROR';
          return resolve({ url, kind, code: 0, curl: c, detail: msg.slice(0, 110) });
        }
        const [code, type, size] = String(stdout).trim().split('|');
        const n = Number(code);
        const kind = n === 0 ? 'TLS' : n >= 200 && n < 400 ? 'OK' : 'HTTP';
        resolve({ url, kind, code: n, type: type || '', size: Number(size) || 0, detail: '' });
      }
    );
  });
}

const hostOf = (u) => {
  try { return new URL(u).host; } catch { return u; }
};

async function main() {
  const results = [];
  const CONC = 6;
  for (let i = 0; i < targets.length; i += CONC) {
    const batch = await Promise.all(targets.slice(i, i + CONC).map(probe));
    results.push(...batch);
  }

  if (asJson) {
    console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    return;
  }

  const mark = { OK: '✓', TLS: '✗', DNS: '✗', REFUSED: '✗', HTTP: '△', TIMEOUT: '△', ERROR: '△' };
  console.log('ホスト到達性マトリクス（実測）');
  console.log('-'.repeat(96));
  const hosts = new Map();
  for (const r of results) {
    const h = hostOf(r.url);
    const prev = hosts.get(h);
    // 同じホストの複数 URL は「一番良い結果」を採用
    const rank = { OK: 3, HTTP: 2, TIMEOUT: 1, ERROR: 1, REFUSED: 0, TLS: 0, DNS: 0 };
    if (!prev || rank[r.kind] > rank[prev.kind]) hosts.set(h, r);
    const label = `${mark[r.kind]} ${r.kind.padEnd(7)} ${String(r.code).padStart(3)}`;
    const tail = r.size ? `  ${r.size}B` : r.curl ? `  curl(${r.curl}) ${r.detail.slice(0, 44)}` : '';
    console.log(`${label}  ${r.url.slice(0, 70)}${tail}`);
  }

  const okHosts = [...hosts.entries()].filter(([, r]) => r.kind === 'OK').map(([h]) => h);
  const deadHosts = [...hosts.entries()]
    .filter(([, r]) => ['TLS', 'DNS', 'REFUSED'].includes(r.kind))
    .map(([h, r]) => `${h}(${r.kind})`);
  console.log('-'.repeat(96));
  console.log(`輸送路に使えるホスト: ${okHosts.join(', ') || '（なし）'}`);
  console.log(`遮断されているホスト: ${deadHosts.join(', ') || '（なし）'}`);
  console.log('');
  console.log('次の一手:');
  console.log('  1. 欲しいアセットが「使えるホスト」上に存在しないか検索する');
  console.log('     例) curl -s -H "authorization: Bearer $GH_TOKEN" \\');
  console.log('           "https://api.github.com/search/repositories?q=<keyword>&per_page=10"');
  console.log('  2. 無ければ、ユーザーに「使えるホスト」への1ホップだけ頼む');
  console.log('     例) 公開 GitHub リポジトリへ置く → node tools/fetch-model.mjs <github.com の URL>');
  console.log('  3. 遮断ホストへ直接は絶対に当たらない（時間の無駄＋誤解を招く）');
}

main();
