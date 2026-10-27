/**
 * シェーダの構文チェック（GLSL ES 1.00 として parse する）
 *   node tools/glsl-check.mjs
 */
import { parser } from '@shaderfrog/glsl-parser';
import * as THREE from 'three';
import fs from 'node:fs';

const files = ['src/world.js', 'src/cutout.js', 'src/main.js'];
const shaders = [];

// ソースからテンプレートリテラルの GLSL をざっくり抽出
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /\/\* glsl \*\/ `([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(src))) shaders.push([f, m[1]]);
}

let bad = 0;
for (const [f, code] of shaders) {
  try {
    parser.parse(code);
    console.log(`  ✓ ${f} (${code.split('\n').length} 行)`);
  } catch (e) {
    bad++;
    console.log(`  ✗ ${f}: ${e.message}`);
  }
}
console.log(bad ? `✗ ${bad} 件失敗` : '✓ GLSL 構文 OK');
process.exit(bad ? 1 : 0);
