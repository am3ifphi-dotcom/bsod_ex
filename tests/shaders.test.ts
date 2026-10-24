import { describe, expect, it } from 'vitest';
import { parser } from '@shaderfrog/glsl-parser';
import { BSOD_SHADER, DOF_SHADER } from '../src/core/Renderer';

const stripIncludes = (src: string): string => src.replace(/#include <[^>]+>/g, '');

const shaders = [
  ['bsod vertex', BSOD_SHADER.vertexShader],
  ['bsod fragment', BSOD_SHADER.fragmentShader],
  ['dof vertex', DOF_SHADER.vertexShader],
  ['dof fragment', DOF_SHADER.fragmentShader],
] as const;

describe('post-processing shaders', () => {
  for (const [name, src] of shaders) {
    it(`${name} is valid GLSL`, () => {
      expect(() => parser.parse(stripIncludes(src))).not.toThrow();
    });
  }

  it('declares every uniform it uses (no silent black frames)', () => {
    for (const [name, src] of shaders) {
      if (!name.endsWith('fragment')) continue;
      const declared = new Set(
        [...src.matchAll(/uniform\s+\w+\s+([A-Za-z_]\w*)\s*;/g)].map((m) => m[1]),
      );
      const used = new Set([...src.matchAll(/\b(u[A-Z]\w*)\b/g)].map((m) => m[1]));
      for (const u of used) expect(declared, `${name}: ${u}`).toContain(u);
    }
  });

  it('every declared uniform is wired up by the pass', () => {
    for (const [name, src] of shaders) {
      if (!name.endsWith('fragment')) continue;
      const declared = [...src.matchAll(/uniform\s+\w+\s+([A-Za-z_]\w*)\s*;/g)].map((m) => m[1]);
      const uniforms = name.startsWith('bsod') ? BSOD_SHADER.uniforms : DOF_SHADER.uniforms;
      for (const u of declared) {
        if (u === 'tDiffuse' || u === 'tDepth') continue;
        expect(Object.keys(uniforms), `${name}: ${u}`).toContain(u);
      }
    }
  });

  it('contains no smoothstep(edge0, edge1, x) argument swaps', () => {
    // cheap sanity check on the grade: both edges present and ordered where literal
    for (const [name, src] of shaders) {
      for (const m of src.matchAll(/smoothstep\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,/g)) {
        expect(Number(m[1]), name).toBeLessThanOrEqual(Number(m[2]));
      }
    }
  });
});
