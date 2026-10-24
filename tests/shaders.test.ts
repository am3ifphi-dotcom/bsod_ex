// GLSL validation: parse every shader this project ships, plus the chunks it
// injects through onBeforeCompile, with a real GLSL parser.
//
// The injected chunks are obtained by calling the real injection functions on
// stub shaders, so this suite tracks the shipped code instead of a copy.
//
// Caveat: this catches syntax errors only. The shaders have never been
// compiled by a real GPU driver (no WebGL in this environment), so runtime
// compilation and visual correctness remain unverified.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { parser } from '@shaderfrog/glsl-parser';
import { bootDom, FakeAssets, makePhysics, readManifest } from './helpers.ts';
import * as S from '../src/core/shaders.ts';

bootDom();

const GLSL_EXPORTS = [
  'skyVert', 'skyFrag', 'debrisVert', 'debrisFrag',
  'mouthVert', 'mouthFrag', 'finalVert', 'finalFrag',
] as const;

function parse(name: string, src: string) {
  assert.ok(src && src.length > 40, `${name} is empty`);
  assert.ok(src.includes('void main'), `${name} has no main()`);
  try {
    parser.parse(src);
  } catch (err) {
    assert.fail(`${name} failed to parse: ${(err as Error).message.slice(0, 400)}`);
  }
}

/** three.js chunk-injection stub: the includes are stripped before parsing. */
function injected(mat: THREE.Material) {
  const shader: any = {
    uniforms: {},
    vertexShader: [
      '#include <common>',
      'void main() {',
      '  vec3 transformed = vec3(0.0);',
      '  vec3 objectNormal = vec3(0.0, 0.0, 1.0);',
      '  vec2 uv = vec2(0.0);',
      '  #include <begin_vertex>',
      '  gl_Position = vec4(transformed, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '  gl_FragColor = vec4(1.0);',
      '  #include <dithering_fragment>',
      '}',
    ].join('\n'),
  };
  assert.equal(typeof mat.onBeforeCompile, 'function', 'material injects no shader code');
  (mat.onBeforeCompile as any)(shader, undefined);
  const strip = (s: string) => s.split('\n')
    .filter((l) => !l.trim().startsWith('#include'))
    .join('\n');
  return { vert: strip(shader.vertexShader), frag: strip(shader.fragmentShader) };
}

test('named shader modules parse', () => {
  for (const key of GLSL_EXPORTS) {
    const src = (S as any)[key];
    assert.equal(typeof src, 'string', `${key} is not exported as a string`);
    parse(key, src);
  }
});

test('inline glsl templates in the game sources parse', () => {
  let found = 0;
  for (const file of ['src/game/sequences.ts', 'src/game/monitor.ts']) {
    const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    const re = /\/\* glsl \*\/`([\s\S]*?)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) parse(`${file}#${found++}`, m[1]);
  }
  assert.ok(found >= 2, `expected inline shader templates, found ${found}`);
});

test('withGlitch injection parses in both modes', () => {
  const uniforms = { uTime: { value: 0 }, uGlitch: { value: 0 } };
  for (const uvAttribute of [false, true]) {
    const mat = new THREE.MeshStandardMaterial();
    S.withGlitch(mat, uniforms, uvAttribute);
    const { vert, frag } = injected(mat);
    parse(`withGlitch/vertex/uv=${uvAttribute}`, vert);
    parse(`withGlitch/fragment/uv=${uvAttribute}`, frag);
    if (uvAttribute) assert.ok(frag.includes('vGlitchUv'), 'uv mode must drive vGlitchUv');
  }
});

test('the terrain grid injection parses', async () => {
  const physics = await makePhysics();
  const { World } = await import('../src/game/world.ts');
  const world = new World(new FakeAssets(readManifest()) as any, physics);
  world.build();
  const mat = world.terrainMesh.material as THREE.Material;
  const { vert, frag } = injected(mat);
  parse('terrain/vertex', vert);
  parse('terrain/fragment', frag);
  assert.ok(frag.includes('gridLine'), 'terrain fragment should draw the memory grid');
  assert.ok(vert.includes('vWorldPosT'), 'terrain vertex should pass world position');
});
