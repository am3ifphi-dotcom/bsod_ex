export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;

// 区間ごとのキーフレーム合成
export function keyframe(points, t) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, v0] = points[i];
    const [t1, v1] = points[i + 1];
    if (t <= t1) return lerp(v0, v1, easeInOutCubic(invLerp(t0, t1, t)));
  }
  return points[points.length - 1][1];
}

export function rand(a, b) { return a + Math.random() * (b - a); }
export function choice(arr) { return arr[(Math.random() * arr.length) | 0]; }

let _seed = 1337;
export function srand(s) { _seed = s | 0; }
export function sranda() { // 決定論的乱数
  _seed = (_seed * 1664525 + 1013904223) | 0;
  return ((_seed >>> 0) % 100000) / 100000;
}
