import fs from 'node:fs';
import { validate, formatDiagnostic } from '@moreplease/glslang';

const files = process.argv.slice(2);
let failed = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');

  // Shared GLSL helper blocks (e.g. `const HASH = \`...\``) may be interpolated
  // into several shaders. Resolve them before compiling so the linter validates
  // exactly the source the GPU will see.
  const helpers = new Map();
  const helperRe = /const\s+(\w+)\s*=\s*`([\s\S]*?)`;/g;
  let h;
  while ((h = helperRe.exec(src))) helpers.set(h[1], h[2]);

  const re = /\/\* glsl \*\/ `([\s\S]*?)`/g;
  let m, i = 0;
  while ((m = re.exec(src))) {
    i++;
    let body = m[1].replace(/\$\{(\w+)\}/g, (_all, name) => helpers.get(name) ?? '');
    // three.js chunk-injected variants (`#include <...>`) can't be validated standalone.
    if (/#include\s*</.test(body)) continue;
    // three.js injects `transformed` via its morph/skinning chunks in onBeforeCompile variants.
    if (/\btransformed\b/.test(body)) continue;
    const isVert = /gl_Position/.test(body) && !/gl_FragColor/.test(body);
    const prelude = isVert
      ? `#version 100\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nattribute vec3 position;\nattribute vec2 uv;\nattribute vec3 normal;\nuniform mat4 projectionMatrix;\nuniform mat4 modelViewMatrix;\nuniform mat4 modelMatrix;\nuniform mat4 viewMatrix;\nuniform mat3 normalMatrix;\nuniform vec3 cameraPosition;\nattribute mat4 instanceMatrix;\nattribute vec3 instanceColor;\nattribute vec4 color;\n`
      : `#version 100\n#extension GL_OES_standard_derivatives : enable\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nuniform vec3 cameraPosition;\nuniform mat4 viewMatrix;\nuniform float uOpacity;\n`;
    const src2 = prelude + body;
    try {
      const res = await validate([{ name: isVert ? `s${i}.vert` : `s${i}.frag`, source: src2 }], { target: 'webgl1' });
      if (!res.ok) {
        failed++;
        console.log(`FAIL ${f} shader#${i} (${isVert ? 'vert' : 'frag'})`);
        console.log(res.diagnostics.slice(0, 6).map(formatDiagnostic).join('\n'));
      }
    } catch (e) {
      console.log(`ERR ${f} #${i}: ${e.message.slice(0, 200)}`);
    }
  }
  console.log(`${f}: ${i} shaders checked`);
}
process.exit(failed ? 1 : 0);
