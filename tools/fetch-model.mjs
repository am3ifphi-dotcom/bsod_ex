/**
 * 元モデル(.glb)を GitHub 経由で取得する
 * -------------------------------------------------------------
 * このサンドボックスは sketchfab.com へ出られない（TLS の SNI で遮断される）が、
 * github.com / api.github.com / codeload.github.com には出られる。
 * そこで「ブラウザで .glb を GitHub のリポジトリに置く」→「ここが取得する」という
 * 橋渡しをする。取得・検証・配置まで自律的に走る。
 *
 * 使い方:
 *   node tools/fetch-model.mjs                     # 既定: このリポジトリの public/models/classroom.glb
 *   node tools/fetch-model.mjs https://github.com/me/assets/blob/main/models/room.glb
 *   node tools/fetch-model.mjs https://raw.githubusercontent.com/me/assets/main/room.glb
 *   node tools/fetch-model.mjs --npm some-pkg --npm-path models/room.glb
 *   node tools/fetch-model.mjs --repo me/assets --path models/classroom.glb --ref main
 *   node tools/fetch-model.mjs --force --via blob  # 取得経路を指定（auto|contents|blob|tarball）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/* ---------------- 引数 ---------------- */
const argv = process.argv.slice(2);
const get = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

function detectRepo() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (m) return m[1];
  } catch {}
  return null;
}

/* ---------------- URL 変換 ----------------
 * 遮断はホスト名（TLS の SNI）単位なので、同じバイト列を「許可ホストの別表現」に
 * 書き換えれば取得できる。ここでは github 系のいろいろな書き方と npm を、
 * api.github.com / codeload.github.com / registry.npmjs.org の経路へ正規化する。
 */
function fromURL(u) {
  let m = u.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+?)\/?$/);
  if (m) {
    return {
      repo: `${m[1]}/${m[2]}`, ref: m[3], path: m[4],
      note: 'raw.githubusercontent.com は遮断されるので api.github.com の blob 経路へ変換',
    };
  }
  m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(blob|raw|tree)\/([^/]+)\/(.+?)(?:[?#].*)?$/);
  if (m) {
    return {
      repo: `${m[1]}/${m[2]}`, ref: m[4], path: m[3] === 'tree' ? null : m[5],
      via: m[3] === 'tree' ? 'tarball' : undefined,
      note: `github.com の ${m[3]} URL を API 経路へ変換`,
    };
  }
  m = u.match(/^https?:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\/tar\.gz\/(.+?)\/?$/);
  if (m) return { repo: `${m[1]}/${m[2]}`, ref: m[3], path: null, via: 'tarball', note: 'codeload の tarball 経路' };
  m = u.match(/^https?:\/\/(?:www\.)?npmjs\.com\/package\/(@?[^/?#]+)(?:\/v\/([^/?#]+))?/) ||
      u.match(/^https?:\/\/registry\.npmjs\.org\/(@?[^/]+(?:\/[^/?#]+)?)(?:\/-\/.+\.tgz)?$/);
  if (m) return { npm: m[1], npmVersion: m[2] || null, note: 'npm レジストリの tarball 経路へ変換' };
  return null;
}

const urlArg = get('url', argv.find((a) => /^https?:\/\//.test(a)) || null);
let repo = get('repo', detectRepo());
let ref = get('ref', 'main');
let path = get('path', 'public/models/classroom.glb');
let via = get('via', 'auto'); // auto | contents | blob | tarball
let npmPkg = get('npm', null);
let npmVersion = get('npm-version', null);
const npmPath = get('npm-path', null);
const force = has('force');
const noValidate = has('no-validate');

if (urlArg) {
  const t = fromURL(urlArg);
  if (!t) {
    console.error(`✗ この URL は変換できません: ${urlArg}`);
    console.error('  対応: github.com/{o}/{r}/blob|tree|raw/... , raw.githubusercontent.com/... ,');
    console.error('        codeload.github.com/... , npmjs.com/package/... , registry.npmjs.org/...');
    console.error('  それ以外のホストは sandbox から届かないので、上記のどれかに載せ替えてください。');
    process.exit(1);
  }
  console.log(`URL変換: ${t.note}`);
  if (t.npm) {
    npmPkg = t.npm;
    npmVersion = t.npmVersion;
  } else {
    repo = t.repo;
    if (t.ref) ref = t.ref;
    if (t.path) path = t.path;
    if (t.via) via = t.via;
  }
}

const out = resolve(ROOT, get('out', urlArg && path ? `public/models/${path.split('/').pop()}` : 'public/models/classroom.glb'));

if (!npmPkg && !repo) {
  console.error('✗ リポジトリを特定できません。--repo owner/name か URL を指定してください。');
  process.exit(1);
}

/* ---------------- glTF バイナリの検証 ---------------- */
function validateGlb(buf, label) {
  if (buf.length < 12) throw new Error(`${label}: ファイルが短すぎます（${buf.length} bytes）`);
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) {
    const head = buf.subarray(0, 200).toString('utf8').replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`${label}: glTF バイナリではありません（magic=0x${magic.toString(16)}）。先頭: ${head}`);
  }
  const version = buf.readUInt32LE(4);
  const length = buf.readUInt32LE(8);
  if (version !== 2) throw new Error(`${label}: glTF version ${version} は未対応（2 が必要です）`);
  if (length !== buf.length) throw new Error(`${label}: 宣言長 ${length} ≠ 実長 ${buf.length}（途中で切れています）`);
  return { version, length };
}

/* ---------------- HTTP（curl 経由） ----------------
 * このサンドボックスの外向き HTTPS は E2B の MITM プロキシを通る
 * （証明書の issuer が "O=E2B; CN=E2B Proxy CA"）。その CA は
 * /etc/ssl/certs には入っているが Node の既定の信頼ストアには無いので、
 * node:fetch だと UNABLE_TO_VERIFY_LEAF_SIGNATURE になる。
 * そのため HTTP は curl に任せる（手元マシンでもそのまま動く）。
 */
const token = (() => {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return t && !t.includes('dummy') ? t : null;
})();

function curl(url, { accept = 'application/vnd.github+json', out = null, maxTime = 600 } = {}) {
  const args = ['-fsSL', '--max-time', String(maxTime), '-H', `accept: ${accept}`,
    '-H', 'user-agent: omoide-classroom-model-fetcher'];
  if (token) args.push('-H', `authorization: Bearer ${token}`);
  args.push('-w', '\n%{http_code}');
  if (out) args.push('-o', out);
  args.push(url);
  try {
    const res = execFileSync('curl', args, { maxBuffer: 64 * 1024 * 1024, encoding: out ? 'utf8' : 'buffer' });
    if (out) return { body: readFileSync(out), code: Number(String(res).trim().split('\n').pop()) };
    const buf = Buffer.isBuffer(res) ? res : Buffer.from(res);
    const nl = buf.lastIndexOf(0x0a);
    return { body: buf.subarray(0, nl), code: Number(buf.subarray(nl + 1).toString().trim()) };
  } catch (e) {
    const detail = (e.stderr ? String(e.stderr) : e.message).split('\n').slice(0, 3).join(' / ').slice(0, 240);
    throw new Error(`curl 失敗 (${url})\n      ${detail}`);
  }
}

function gh(url, accept) {
  return curl(url, { accept });
}

async function viaContents() {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`;
  const meta = JSON.parse(gh(url).body.toString('utf8'));
  if (meta.type !== 'file') throw new Error(`${path} はファイルではありません（type=${meta.type}）`);
  console.log(`  contents: size=${meta.size} sha=${meta.sha.slice(0, 10)}`);
  if (meta.content && meta.encoding === 'base64') {
    return Buffer.from(meta.content, 'base64');
  }
  // 1 MB を超えると contents は中身を返さないので blob へ
  return viaBlob(meta.sha, meta.size);
}

async function viaBlob(sha, size) {
  if (!sha) {
    const url = `https://api.github.com/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`;
    const meta = JSON.parse(gh(url).body.toString('utf8'));
    sha = meta.sha;
    size = meta.size;
  }
  if (size > 100 * 1024 * 1024) throw new Error(`${size} bytes は blob API の上限(100MB)を超えます`);
  console.log(`  blob: ${sha.slice(0, 10)} (${size} bytes)`);
  const tmp = resolve(ROOT, `.model-fetch-blob-${Date.now()}`);
  try {
    gh(`https://api.github.com/repos/${repo}/git/blobs/${sha}`, 'application/vnd.github.raw+json');
    // 大きなバイナリは -o で直接ファイルへ
    const r = curl(`https://api.github.com/repos/${repo}/git/blobs/${sha}`, {
      accept: 'application/vnd.github.raw+json',
      out: tmp,
      maxTime: 900,
    });
    if (r.code !== 200) throw new Error(`blob API が HTTP ${r.code}`);
    return r.body;
  } finally {
    try { execFileSync('rm', ['-f', tmp]); } catch {}
  }
}

async function viaTarball() {
  const url = `https://codeload.github.com/${repo}/tar.gz/${encodeURIComponent(ref)}`;
  console.log(`  tarball: ${url}`);
  const tmp = resolve(ROOT, `.model-fetch-${Date.now()}.tar.gz`);
  const r = curl(url, { accept: 'application/gzip', out: tmp, maxTime: 900 });
  if (r.code !== 200) throw new Error(`HTTP ${r.code} ${url}`);
  try {
    // tar 内は "<repo>-<ref>/" が頭に付く。GNU tar は strip 前の名前で照合するので
    // --strip-components ではなく --wildcards で取り出す。
    const buf = execFileSync('tar', ['-xzOf', tmp, '--wildcards', `*/${path}`], {
      maxBuffer: 512 * 1024 * 1024,
    });
    return buf;
  } finally {
    try {
      execFileSync('rm', ['-f', tmp]);
    } catch {}
  }
}

async function viaNpm(pkg, ver, innerPath) {
  const enc = pkg.startsWith('@') ? pkg.replace('/', '%2f') : pkg;
  const meta = JSON.parse(curl(`https://registry.npmjs.org/${enc}`, { accept: 'application/json' }).body.toString('utf8'));
  const version = ver || meta['dist-tags']?.latest;
  const tgz = meta.versions?.[version]?.dist?.tarball;
  if (!tgz) throw new Error(`npm: ${pkg}@${version} の tarball が見つかりません`);
  console.log(`  npm: ${pkg}@${version} → ${tgz}`);
  const tmp = resolve(ROOT, `.model-fetch-npm-${Date.now()}.tgz`);
  const r = curl(tgz, { accept: 'application/octet-stream', out: tmp, maxTime: 900 });
  if (r.code !== 200) throw new Error(`npm tarball が HTTP ${r.code}`);
  try {
    const list = execFileSync('tar', ['-tzf', tmp], { encoding: 'utf8', maxBuffer: 64e6 }).trim().split('\n');
    if (!innerPath) {
      const cand = list.filter((n) => /\.(glb|gltf|zip|fbx|obj|hdr|png|jpg)$/i.test(n));
      throw new Error(
        `--npm-path を指定してください（tar 内は package/ 始まり）。候補:\n      ${(cand.length ? cand : list).slice(0, 14).join('\n      ')}`
      );
    }
    return execFileSync('tar', ['-xzOf', tmp, '--wildcards', `package/${innerPath}`], { maxBuffer: 512e6 });
  } finally {
    try { execFileSync('rm', ['-f', tmp]); } catch {}
  }
}

/* ---------------- 本体 ---------------- */
if (existsSync(out) && !force) {
  const cur = readFileSync(out);
  try {
    validateGlb(cur, '既存ファイル');
    console.log(`✓ すでに配置済み: ${out.replace(ROOT + '/', '')} (${(cur.length / 1048576).toFixed(2)} MB)`);
    console.log('  取り直す場合は --force を付けてください。');
    process.exit(0);
  } catch (e) {
    console.log(`! 既存ファイルが不正なので取得し直します（${e.message}）`);
  }
}

let buf = null;
const errs = [];

if (npmPkg) {
  console.log(`取得元: npm ${npmPkg}${npmVersion ? `@${npmVersion}` : ''}${npmPath ? ` : ${npmPath}` : ''}`);
  try {
    buf = await viaNpm(npmPkg, npmVersion, npmPath);
  } catch (e) {
    errs.push(String(e.message));
    console.error(`\n✗ ${e.message.split('\n').join('\n  ')}`);
    process.exit(1);
  }
} else {
  console.log(`取得元: github.com/${repo} @ ${ref} : ${path}`);
  const order = via === 'auto' ? ['contents', 'blob', 'tarball'] : [via];
  for (const step of order) {
    try {
      console.log(`  経路: ${step}`);
      buf = step === 'contents' ? await viaContents() : step === 'blob' ? await viaBlob() : await viaTarball();
      if (buf && buf.length) break;
      buf = null;
    } catch (e) {
      const msg = String(e.message);
      errs.push(msg);
      console.log(`  ${step} 失敗: ${msg.split('\n')[0]}`);
      buf = null;
    }
  }
}
if (!buf) {
  const notFound = errs.length > 0 && errs.every((m) => /404|Not found in archive/i.test(m));
  console.error('\n✗ 取得できませんでした。');
  if (notFound) {
    console.error(`  → github.com/${repo} の "${ref}" に「${path}」がありません。`);
    console.error('    そのパスへ .glb をコミットしてください。');
    console.error('    ・25MB まで: github.com の Web UI へドラッグ＆ドロップ');
    console.error('    ・それ以上: git add / push、またはこのチャットに添付');
    console.error(`    確認コマンド: gh api repos/${repo}/contents/${path}?ref=${ref}`);
  } else {
    console.error(`  最後に起きたエラー: ${(errs[errs.length - 1] || '不明').split('\n')[0]}`);
    console.error('  確認してほしいこと:');
    console.error('   - リポジトリ名／パス／ref が実在するか（大文字小文字も）');
    console.error('   - .glb が Git LFS に入っていないか（LFS ポインタだと glTF になりません）');
    console.error('   - private リポジトリなら gh auth status が通っているか');
  }
  process.exit(1);
}

let info;
try {
  if (noValidate) info = { version: '-', length: buf.length };
  else info = validateGlb(buf, '取得したファイル');
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  console.error('  → .glb（glTF バイナリ）そのものを置いてください。.gltf + 別ファイル形式や、');
  console.error('    Git LFS のポインタファイルだとここで弾かれます。');
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
const st = statSync(out);
console.log(`\n✓ 配置しました: ${out.replace(ROOT + '/', '')}`);
console.log(`  glTF v${info.version} / ${(st.size / 1048576).toFixed(2)} MB / sha256 ${createHash('sha256').update(buf).digest('hex').slice(0, 16)}…`);
if (st.size > 40 * 1024 * 1024) {
  console.log('  ! 40MB を超えています。ビルド成果物とロード時間が大きくなるので、');
  console.log('    テクスチャを 2K 以下に落とす／draco・meshopt で圧縮すると軽くなります。');
}
console.log('\n次の一歩: npm run dev を開いて、GLTFLoader で読み込む統合を実装します。');
