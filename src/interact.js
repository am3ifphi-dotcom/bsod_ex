/**
 * 調べられる物（ホットスポット）と、記憶のかけら
 */
import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2(0, 0);
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _box = new THREE.Box3();

/* ==================================================================
   記憶のかけら
   ================================================================== */
export const FRAGMENT_DEFS = [
  {
    id: 'chalk-dust',
    name: 'チョークの粉',
    pos: [-0.6, 0.98, -3.87],
    body: '黒板消しをはたくと、粉が光の柱のなかで泳いだ。\n咳こみながら、当番はそれをやっていた。',
  },
  {
    id: 'eraser-crumbs',
    name: '机の下の消しくず',
    pos: [1.3, 0.2, 1.95],
    body: '机の下には、消しゴムのかすがいつもあった。\nしゃがまないと、見えない場所。',
  },
  {
    id: 'summer-light',
    name: '夏のひかり',
    pos: [4.25, 1.18, -2.7],
    body: '窓際の席は、夏のあいだずっとまぶしかった。\nカーテンがふくらんで、外のにおいが入ってくる。',
  },
  {
    id: 'book-smell',
    name: '本のにおい',
    pos: [-2.2, 0.99, 3.72],
    body: '古い図鑑の、あのにおい。\nページをめくる指が、少し湿っていた。',
  },
  {
    id: 'winter-smell',
    name: '冬のにおい',
    pos: [-4.22, 0.8, 0.55],
    body: 'ストーブの上のヤカンと、鉄のあたたかさ。\n窓だけは、寒かった。',
  },
  {
    id: 'rag-drop',
    name: 'ぞうきんのしずく',
    pos: [3.3, 0.52, 3.6],
    body: 'しぼりきれなかったぞうきんから、\n床にしたたる水。掃除の時間の終わり。',
  },
  {
    id: 'one-note',
    name: '音のひとつ',
    pos: [3.2, 0.88, -3.18],
    body: 'だれかが帰りに弾いていった、ひと音だけ。\nうまくないけど、たのしそうだった。',
  },
  {
    id: 'footsteps',
    name: 'だれかの足音',
    pos: [-5.28, 1.28, 2.45],
    body: '廊下を走ってはいけない、と言われたのに。\nあの足音は、たぶん自分のものだった。',
  },
];

export function createFragments(M, scene) {
  const ringGeo = new THREE.TorusGeometry(0.085, 0.004, 6, 26);
  const coreGeo = new THREE.IcosahedronGeometry(0.045, 0);
  const spriteMat = (tex) =>
    new THREE.SpriteMaterial({
      map: tex,
      color: 0xffd9a0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
    });

  return FRAGMENT_DEFS.map((def, i) => {
    const g = new THREE.Group();
    g.position.set(...def.pos);
    const core = new THREE.Mesh(coreGeo, M.fragment.clone());
    g.add(core);
    const ring = new THREE.Mesh(ringGeo, M.fragment.clone());
    ring.material.transparent = true;
    ring.material.opacity = 0.55;
    g.add(ring);
    const glow = new THREE.Sprite(spriteMat(M.glow));
    glow.scale.setScalar(0.42);
    g.add(glow);
    const halo = new THREE.Sprite(spriteMat(M.glowSoft));
    halo.scale.setScalar(1.0);
    halo.material.opacity = 0.22;
    g.add(halo);
    scene.add(g);
    return {
      ...def,
      index: i,
      group: g,
      core,
      ring,
      glow,
      halo,
      collected: false,
      t: 0,
      phase: Math.random() * Math.PI * 2,
      baseY: def.pos[1],
    };
  });
}

/* ==================================================================
   インタラクション
   ================================================================== */
export class Interaction {
  constructor({ camera, hotspots, fragments, blockers = [], ui, actions = {} }) {
    this.camera = camera;
    this.hotspots = hotspots;
    this.fragments = fragments;
    this.blockers = blockers;
    this.ui = ui;
    this.actions = actions;
    this.target = null; // { kind:'hotspot'|'fragment', ref, dist }
    this.discovered = new Set();
    this.collectedCount = 0;
    this._acc = 0;

    // ホットスポットごとのメッシュとバウンディングボックスを集めておく
    for (const h of this.hotspots) {
      h._meshes = [];
      for (const o of h.meshes) {
        o.updateMatrixWorld(true);
        o.traverse((c) => {
          if (c.isMesh && c.visible) h._meshes.push(c);
        });
      }
      h._box = new THREE.Box3();
      for (const m of h._meshes) h._box.expandByObject(m);
      h._discovered = false;
    }
    for (const b of this.blockers) b.updateMatrixWorld(true);
  }

  update(dt, time) {
    // かけらのアニメーション
    for (const f of this.fragments) {
      if (f.collected) {
        f.t += dt;
        const k = Math.min(1, f.t / 0.8);
        f.group.scale.setScalar(1 + k * 1.6);
        f.glow.material.opacity = 0.9 * (1 - k);
        f.halo.material.opacity = 0.22 + k * 0.7;
        f.halo.scale.setScalar(1 + k * 3.4);
        f.core.material.opacity = 1 - k;
        f.core.material.transparent = true;
        f.ring.material.opacity = 0.55 * (1 - k);
        f.group.position.y = f.baseY + k * 0.5;
        if (k >= 1 && f.group.parent) f.group.parent.remove(f.group);
        continue;
      }
      const bob = Math.sin(time * 1.4 + f.phase) * 0.045;
      f.group.position.y = f.baseY + bob;
      f.group.rotation.y = time * 0.7 + f.phase;
      f.ring.rotation.x = time * 1.1;
      f.ring.rotation.z = time * 0.6;
      const pulse = 0.9 + Math.sin(time * 2.6 + f.phase) * 0.16;
      f.glow.scale.setScalar(0.42 * pulse);
      f.core.material.emissiveIntensity = 2.0 + Math.sin(time * 3 + f.phase) * 0.9;
      f.halo.material.opacity = 0.16 + Math.sin(time * 1.8 + f.phase) * 0.06;
    }

    // ターゲット検出（20Hz で十分）
    this._acc += dt;
    if (this._acc < 0.05) return;
    this._acc = 0;
    this._detect();
  }

  _detect() {
    _ray.setFromCamera(_ndc, this.camera);
    _ray.near = 0.05;
    const cam = this.camera.position;
    let best = null;

    // ブロッカー（壁など）までの距離
    let blockDist = Infinity;
    if (this.blockers.length) {
      _ray.far = 30;
      const bh = _ray.intersectObjects(this.blockers, false);
      if (bh.length) blockDist = bh[0].distance;
    }

    // 記憶のかけら：近さと視野で判定（小さいので当てやすい方が親切）
    for (const f of this.fragments) {
      if (f.collected) continue;
      const d = cam.distanceTo(f.group.position);
      if (d > 1.7) continue;
      _v.copy(f.group.position).sub(cam).normalize();
      const fwd = this.camera.getWorldDirection(_fwd);
      if (fwd.dot(_v) < 0.5) continue;
      if (!best || d < best.dist) best = { kind: 'fragment', ref: f, dist: d };
    }

    // ホットスポット
    for (const h of this.hotspots) {
      const reach = h.reach || 2.2;
      if (h._box.isEmpty()) continue;
      _box.copy(h._box);
      const closest = _box.clampPoint(cam, _v);
      const d0 = cam.distanceTo(closest);
      if (d0 > reach) continue;
      _ray.far = reach;
      const hits = _ray.intersectObjects(h._meshes, false);
      if (!hits.length) continue;
      const dist = hits[0].distance;
      if (dist > blockDist + 0.08) continue; // 壁ごしは不可
      if (best && best.kind === 'fragment') continue;
      if (!best || dist < best.dist) best = { kind: 'hotspot', ref: h, dist };
    }

    const changed =
      (best?.ref?.id || null) !== (this.target?.ref?.id || null) || (best?.kind || null) !== (this.target?.kind || null);
    this.target = best;
    if (changed) {
      if (best) {
        if (best.kind === 'fragment') this.ui.prompt(`記憶のかけら ― ${best.ref.name}`, '拾う');
        else this.ui.prompt(best.ref.name, best.ref.action ? 'さわる' : '調べる');
        this.ui.crosshair(true);
      } else {
        this.ui.hidePrompt();
        this.ui.crosshair(false);
      }
    }
  }

  use() {
    const t = this.target;
    if (!t) return false;
    if (t.kind === 'fragment') {
      const f = t.ref;
      if (f.collected) return false;
      f.collected = true;
      f.t = 0;
      this.collectedCount++;
      this.ui.card({
        tag: '記憶のかけら',
        title: f.name,
        body: f.body,
        extra: `${this.collectedCount} / ${this.fragments.length} を見つけた`,
        memory: true,
      });
      this.actions.onFragment?.(f, this.collectedCount, this.fragments.length);
      this.target = null;
      this.ui.hidePrompt();
      this.ui.crosshair(false);
      return true;
    }
    const h = t.ref;
    if (!h._discovered) {
      h._discovered = true;
      this.discovered.add(h.id);
      this.actions.onDiscover?.(h, this.discovered.size);
    }
    this.ui.card({ tag: h.tag || 'きおく', title: h.title, body: h.body, extra: h.extra || '' });
    if (h.action) this.actions[h.action]?.(h);
    else this.actions.default?.(h);
    return true;
  }
}
