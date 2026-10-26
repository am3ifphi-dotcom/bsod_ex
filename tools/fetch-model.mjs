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

const repo = get('repo', detectRepo());
const ref = get('ref', 'main');
const path = get('path', 'public/models/classroom.glb');
const out = resolve(ROOT, get('out', 'public/models/classroom.glb'));
const via = get('via', 'auto'); // auto | contents | blob | tarball
const force = has('force');

if (!repo) {
  console.error('✗ リポジトリを特定できません。--repo owner/name を指定してください。');
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

console.log(`取得元: github.com/${repo} @ ${ref} : ${path}`);
const order =
  via === 'auto' ? ['contents', 'blob', 'tarball'] : [via];

let buf = null;
let lastErr = null;
for (const step of order) {
  try {
    console.log(`  経路: ${step}`);
    buf = step === 'contents' ? await viaContents() : step === 'blob' ? await viaBlob() : await viaTarball();
    if (buf && buf.length) break;
  } catch (e) {
    lastErr = e;
    console.log(`  ${step} 失敗: ${e.message.split('\n')[0]}`);
    buf = null;
  }
}
if (!buf) {
  console.error(`\n✗ 取得できませんでした。最後に起きたエラー:\n  ${lastErr ? lastErr.message : '不明'}`);
  console.error('\n  確認してほしいこと:');
  console.error('   - そのリポジトリ／パス／ref が実在するか（大文字小文字も）');
  console.error('   - .glb が Git LFS に入っていないか（LFS ポインタだと glTF になりません）');
  console.error('   - private の場合は gh auth status が通っているか');
  process.exit(1);
}

let info;
try {
  info = validateGlb(buf, '取得したファイル');
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
