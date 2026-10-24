// room.js — the player's bedroom at night. Monitor light is the key light.
// The monitor screen is a live canvas (the BSOD) whose stage is driven by main.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvasTex } from './textures.js';

export const ROOM = { x0: -2.3, x1: 2.3, z0: -1.7, z1: 1.7, h: 2.55 };
export const MONITOR_POS = new THREE.Vector3(-0.3, 1.13, -1.38); // screen centre
export const DESK_FRONT = new THREE.Vector3(-0.3, 0, -0.62);     // where the player stands to inspect

function box(group, mat, w, h, d, x, y, z, ry = 0, rounded = 0) {
  const geo = rounded > 0 ? new RoundedBoxGeometry(w, h, d, 2, rounded) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
}
function cyl(group, mat, r0, r1, h, x, y, z, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
}

export function buildRoom(M, col) {
  const g = new THREE.Group(); g.name = 'room';
  const { x0, x1, z0, z1, h } = ROOM;
  /* --- shell --- */
  const floor = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, .06, z1 - z0), M.roomFloor);
  floor.position.set(0, -.03, 0); floor.receiveShadow = true; g.add(floor);
  const ceil = box(g, M.ceiling, x1 - x0, .06, z1 - z0, 0, h + .03, 0); ceil.castShadow = false;
  const mkWall = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, .08), M.wallPlaster);
    m.position.set(x, h / 2, z); m.rotation.y = ry; m.receiveShadow = true; m.castShadow = true; g.add(m); return m; };
  mkWall(x1 - x0, 0, z0 - .04, 0); mkWall(x1 - x0, 0, z1 + .04, 0);
  mkWall(z1 - z0, x0 - .04, 0, Math.PI / 2); mkWall(z1 - z0, x1 + .04, 0, Math.PI / 2);
  // baseboards
  [[0, z0 + .015, x1 - x0, 0], [0, z1 - .015, x1 - x0, 0]].forEach(([x, z, w]) => box(g, M.plasticGrey, w, .09, .03, x, .045, z).castShadow = false);
  col.addGround({ x0, x1, z0, z1, y: 0, tag: 'room-floor' });
  const W = (wx0, wx1, wz0, wz1, wy1 = h) => col.addWall({ x0: wx0, x1: wx1, z0: wz0, z1: wz1, y0: 0, y1: wy1 });
  W(x0 - .2, x1 + .2, z0 - .24, z0); W(x0 - .2, x1 + .2, z1, z1 + .24); W(x0 - .24, x0, z0, z1); W(x1, x1 + .24, z0, z1);

  /* --- desk + PC (against -Z wall) --- */
  const deskY = .73;
  box(g, M.deskWood, 1.7, .045, .72, -0.3, deskY, -1.3);
  box(g, M.deskWood, .05, deskY, .66, -1.12, deskY / 2, -1.3); box(g, M.deskWood, .05, deskY, .66, .52, deskY / 2, -1.3);
  box(g, M.deskWood, .5, .12, .6, -0.95, deskY - .09, -1.3); // drawer block
  W(-1.16, .56, -1.68, -.94, deskY + .02);
  // monitor
  const mon = new THREE.Group(); mon.position.copy(MONITOR_POS); g.add(mon);
  box(mon, M.plasticBlack, .585, .355, .028, 0, 0, -.016, 0, .006);
  box(mon, M.plasticBlack, .07, .34, .05, 0, -.33, -.05);
  box(mon, M.plasticBlack, .24, .018, .19, 0, -.5, -.015);
  // --- BSOD screen (live canvas) ---
  const bsodCanvas = document.createElement('canvas'); bsodCanvas.width = 1024; bsodCanvas.height = 600;
  const bsodCtx = bsodCanvas.getContext('2d');
  const bsodTex = new THREE.CanvasTexture(bsodCanvas); bsodTex.colorSpace = THREE.SRGBColorSpace; bsodTex.anisotropy = 8;
  const screenGeo = new THREE.PlaneGeometry(.545, .315, 26, 16);
  const basePos = screenGeo.attributes.position.array.slice();
  const screenMat = new THREE.MeshStandardMaterial({ map: bsodTex, emissive: 0xffffff, emissiveMap: bsodTex, emissiveIntensity: 1.05, roughness: .92, metalness: 0, color: 0x000000 });
  const screen = new THREE.Mesh(screenGeo, screenMat); screen.position.set(0, 0, .0015); mon.add(screen);
  const monLED = box(mon, M.ledAmber, .012, .006, .004, .24, -.165, .002); monLED.castShadow = false;
  const monitorLight = new THREE.SpotLight(0x8fc4ff, 14, 9, 1.18, .9, 1.7); // single shadow pass (cheaper than a point cube)
  monitorLight.position.set(MONITOR_POS.x, MONITOR_POS.y + .05, MONITOR_POS.z + .3);
  monitorLight.target.position.set(-.1, .55, 1.1);
  monitorLight.castShadow = true; monitorLight.shadow.mapSize.set(1024, 1024); monitorLight.shadow.bias = -.004; monitorLight.shadow.camera.near = .05;
  g.add(monitorLight, monitorLight.target);
  const monitorGlow = new THREE.PointLight(0x2f6fd0, 2.4, 3.2, 2); // blue spill behind desk
  monitorGlow.position.set(MONITOR_POS.x, MONITOR_POS.y, MONITOR_POS.z - .12); g.add(monitorGlow);

  // keyboard / mouse / pad
  const kbTex = canvasTex(512, 170, (c2, w, hh) => { c2.fillStyle = '#17191d'; c2.fillRect(0, 0, w, hh);
    c2.fillStyle = '#262a31'; for (let r = 0; r < 5; r++) for (let k = 0; k < 15; k++) c2.fillRect(10 + k * 33, 10 + r * 31, 28, 25);
    c2.fillRect(120, 134, 260, 25); c2.fillStyle = 'rgba(120,180,255,.25)'; c2.fillRect(8, 4, 60, 3); });
  const kb = box(g, new THREE.MeshStandardMaterial({ map: kbTex, roughness: .6 }), .45, .02, .15, -0.3, deskY + .035, -1.06, .02, .006);
  box(g, M.fabricDark, .62, .005, .26, -0.22, deskY + .026, -1.05).castShadow = false; // desk mat
  const mouse = box(g, M.plasticBlack, .06, .035, .105, .06, deskY + .042, -1.05, -.15, .015);
  // PC tower with glass side + spinning fan
  const pc = new THREE.Group(); pc.position.set(.42, deskY + .025, -1.38); g.add(pc);
  box(pc, M.pcCase, .21, .44, .42, 0, .22, 0, 0, .008);
  const pcGlass = box(pc, M.glassDark, .006, .38, .36, -.108, .22, 0); pcGlass.castShadow = false;
  box(pc, M.ledBlue, .004, .3, .012, -.1, .22, .16).castShadow = false;
  box(pc, M.ledBlue, .004, .3, .012, -.1, .22, -.16).castShadow = false;
  const fan = new THREE.Group(); fan.position.set(-.1, .3, -.02); fan.rotation.z = 0; pc.add(fan);
  const fanRing = new THREE.Mesh(new THREE.TorusGeometry(.05, .006, 8, 24), M.ledBlue); fanRing.rotation.y = Math.PI / 2; pc.add(fanRing); fanRing.position.copy(fan.position);
  for (let i = 0; i < 7; i++) { const b = box(fan, M.plasticGrey, .004, .04, .016, 0, 0, 0); b.geometry.translate(0, .024, 0); b.rotation.x = i / 7 * Math.PI * 2; b.castShadow = false; }
  fan.rotation.y = Math.PI / 2;
  box(g, M.ledBlue, .05, .008, .008, .42, deskY + .47, -1.16).castShadow = false; // power LED strip
  // desk props
  const mug = cyl(g, new THREE.MeshStandardMaterial({ color: 0x31548f, roughness: .4 }), .04, .035, .095, -0.78, deskY + .07, -1.12);
  const mugH = new THREE.Mesh(new THREE.TorusGeometry(.026, .006, 8, 18, Math.PI), mug.material); mugH.position.set(-0.735, deskY + .07, -1.12); mugH.rotation.z = -Math.PI / 2; g.add(mugH);
  box(g, M.paper, .21, .004, .297, -0.86, deskY + .028, -1.32, .22).castShadow = false;
  box(g, M.paper, .21, .004, .297, -0.82, deskY + .031, -1.3, -.12).castShadow = false;
  const phoneScr = new THREE.MeshStandardMaterial({ color: 0x05070c, emissive: 0x1a2f4d, emissiveIntensity: .7, roughness: .2 });
  box(g, phoneScr, .07, .008, .145, .18, deskY + .03, -1.28, .5, .004);
  // headphone stand
  cyl(g, M.plasticBlack, .05, .06, .01, -1.0, deskY + .03, -1.5); cyl(g, M.plasticBlack, .008, .008, .24, -1.0, deskY + .15, -1.5);
  const hpBand = new THREE.Mesh(new THREE.TorusGeometry(.085, .011, 8, 20, Math.PI), M.plasticBlack); hpBand.position.set(-1.0, deskY + .26, -1.5); hpBand.castShadow = true; g.add(hpBand);
  box(g, M.fabricDark, .035, .09, .075, -1.085, deskY + .2, -1.5, 0, .012); box(g, M.fabricDark, .035, .09, .075, -.915, deskY + .2, -1.5, 0, .012);
  // cables (desk -> floor strip)
  const cableCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(.42, .9, -1.55), new THREE.Vector3(.5, .45, -1.6), new THREE.Vector3(.34, .05, -1.5), new THREE.Vector3(.7, .03, -1.42)]);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 24, .008, 6), M.plasticBlack); cable.castShadow = true; g.add(cable);
  box(g, M.plasticGrey, .26, .035, .07, .78, .02, -1.44, .15);
  // chair
  const chair = new THREE.Group(); chair.position.set(-0.3, 0, -0.52); chair.rotation.y = Math.PI + .14; g.add(chair);
  box(chair, M.fabricDark, .48, .07, .46, 0, .47, 0, 0, .03);
  const chairBack = box(chair, M.fabricDark, .46, .62, .07, 0, .86, -.24, 0, .03); chairBack.rotation.x = .1;
  box(chair, M.plasticBlack, .05, .03, .26, -.27, .66, .02); box(chair, M.plasticBlack, .05, .03, .26, .27, .66, .02);
  cyl(chair, M.metalDark, .026, .026, .4, 0, .24, 0); cyl(chair, M.plasticBlack, .3, .32, .03, 0, .035, 0);
  W(-.56, -.04, -.78, -.26, .5);

  /* --- bed (west) --- */
  box(g, M.deskWood, .98, .22, 2.05, -1.78, .13, .42);
  box(g, M.fabricBed, .92, .16, 1.96, -1.78, .32, .42, 0, .05);
  box(g, new THREE.MeshStandardMaterial({ map: M.fabricDark.map, color: 0x54677f, roughness: 1 }), .94, .07, 1.25, -1.78, .4, .78, .02, .03); // blanket
  box(g, M.pillow, .58, .12, .36, -1.78, .44, -.32, .06, .05);
  box(g, M.deskWood, .98, .55, .06, -1.78, .4, -.62);
  W(-2.3, -1.26, -.62, 1.46, .55);

  /* --- shelf (east) + books --- */
  const sx = 2.02, sz = .55;
  box(g, M.deskWood, .3, 1.8, .04, sx, .9, sz - .55); box(g, M.deskWood, .3, 1.8, .04, sx, .9, sz + .55);
  box(g, M.deskWood, .3, .04, 1.14, sx, 1.8, sz);
  const bookMats = [0x7a3b3b, 0x33506e, 0x77683a, 0x3d5c46, 0x5b4470, 0x8a8d90, 0x274b63, 0x94536a].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: .85 }));
  const bookGeo = new THREE.BoxGeometry(.16, 1, .035);
  [.32, .78, 1.24].forEach((sy, si) => {
    box(g, M.deskWood, .3, .035, 1.14, sx, sy, sz);
    let bz = sz - .5;
    while (bz < sz + .42) { const bh = .2 + Math.random() * .11, bw = .022 + Math.random() * .02;
      const bk = new THREE.Mesh(bookGeo, bookMats[Math.random() * bookMats.length | 0]);
      bk.scale.set(1, bh, bw / .035); bk.position.set(sx, sy + .02 + bh / 2, bz + bw / 2);
      if (Math.random() < .1) bk.rotation.x = .16; bk.castShadow = true; bk.receiveShadow = true; g.add(bk); bz += bw + .003 + (Math.random() < .12 ? .06 : 0); }
  });
  cyl(g, new THREE.MeshStandardMaterial({ color: 0x9a5a38, roughness: .8 }), .055, .042, .1, sx, 1.87, sz + .3); // plant pot
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e5d38, roughness: 1, flatShading: true });
  for (let i = 0; i < 6; i++) { const leaf = new THREE.Mesh(new THREE.ConeGeometry(.022, .17, 5), leafMat);
    leaf.position.set(sx + Math.sin(i * 2.1) * .03, 2.0, sz + .3 + Math.cos(i * 2.1) * .03); leaf.rotation.set(Math.cos(i * 2.1) * .5, 0, Math.sin(i * 2.1) * .5); leaf.castShadow = true; g.add(leaf); }
  W(1.86, 2.3, -.05, 1.15, 1.85);

  /* --- window (+X wall, north half) + night city --- */
  const cityTex = canvasTex(512, 384, (c2, w, hh) => { const grad = c2.createLinearGradient(0, 0, 0, hh);
    grad.addColorStop(0, '#060d21'); grad.addColorStop(.7, '#0a1834'); grad.addColorStop(1, '#0d1f42'); c2.fillStyle = grad; c2.fillRect(0, 0, w, hh);
    c2.fillStyle = '#dfe9f5'; c2.beginPath(); c2.arc(420, 60, 20, 0, 7); c2.fill(); c2.fillStyle = 'rgba(160,190,230,.25)'; c2.beginPath(); c2.arc(420, 60, 44, 0, 7); c2.fill();
    for (let b = 0; b < 26; b++) { const bx = Math.random() * w, bw = 26 + Math.random() * 60, bh = 70 + Math.random() * 190, by = hh - bh;
      c2.fillStyle = '#04070f'; c2.fillRect(bx, by, bw, bh);
      for (let i = 0; i < bw * bh / 260; i++) { c2.fillStyle = Math.random() < .7 ? 'rgba(255,205,130,.9)' : 'rgba(170,215,255,.9)';
        c2.fillRect(bx + 3 + Math.random() * (bw - 7), by + 4 + Math.random() * (bh - 8), 2.6, 3.4); } } });
  const city = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 1.14), new THREE.MeshBasicMaterial({ map: cityTex }));
  city.position.set(x1 - .055, 1.5, -.85); city.rotation.y = -Math.PI / 2; g.add(city); // the night view (inset in the frame)
  // window frame bars (top/bottom/sides) around the view
  box(g, M.plasticGrey, .06, .07, 1.56, x1 - .03, 2.11, -.85).castShadow = false;
  box(g, M.plasticGrey, .06, .07, 1.56, x1 - .03, .89, -.85).castShadow = false;
  box(g, M.plasticGrey, .06, 1.28, .07, x1 - .03, 1.5, -1.6).castShadow = false;
  box(g, M.plasticGrey, .06, 1.28, .07, x1 - .03, 1.5, -.1).castShadow = false;
  const winGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 1.14), new THREE.MeshStandardMaterial({ color: 0x8fb6dd, transparent: true, opacity: .1, roughness: .05, metalness: .3 }));
  winGlass.position.set(x1 - .075, 1.5, -.85); winGlass.rotation.y = -Math.PI / 2; g.add(winGlass);
  box(g, M.plasticGrey, .03, 1.1, .035, x1 - .05, 1.5, -.85).castShadow = false;
  box(g, M.plasticGrey, .03, .035, 1.36, x1 - .05, 1.5, -.85).castShadow = false;
  // curtains (folded: angled thin boxes)
  for (let i = 0; i < 5; i++) { box(g, M.fabricDark, .02, 1.5, .09, x1 - .09 - Math.abs(i - 2) * .012, 1.42, -1.52 + i * .055, (i - 2) * .2); }
  for (let i = 0; i < 3; i++) { box(g, M.fabricDark, .02, 1.5, .09, x1 - .09, 1.42, -.28 + i * .055, (i - 1) * .2); }
  const windowLight = new THREE.SpotLight(0x5577b8, 6, 7, .95, .9, 1.6);
  windowLight.position.set(x1 + .3, 1.9, -.85); windowLight.target.position.set(.4, .2, -.5); g.add(windowLight, windowLight.target);

  /* --- clock (south wall) --- */
  const clock = new THREE.Group(); clock.position.set(.9, 1.95, z1 - .03); clock.rotation.y = Math.PI; g.add(clock);
  const clockFaceTex = canvasTex(256, 256, (c2, w, hh) => { c2.fillStyle = '#e8e6df'; c2.beginPath(); c2.arc(128, 128, 126, 0, 7); c2.fill();
    c2.fillStyle = '#22242a'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; c2.save(); c2.translate(128 + Math.sin(a) * 104, 128 - Math.cos(a) * 104); c2.rotate(a); c2.fillRect(-2.5, -9, 5, i % 3 ? 12 : 19); c2.restore(); } });
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(.16, 32), new THREE.MeshStandardMaterial({ map: clockFaceTex, roughness: .6 }));
  clockFace.position.z = .012; clock.add(clockFace);
  const clockRim = new THREE.Mesh(new THREE.TorusGeometry(.16, .014, 8, 36), M.plasticBlack); clock.add(clockRim);
  const handMat = new THREE.MeshBasicMaterial({ color: 0x181a20 });
  const mkHand = (len, wdt, z) => { const grp = new THREE.Group(); const hm = new THREE.Mesh(new THREE.BoxGeometry(wdt, len, .002), handMat);
    hm.geometry.translate(0, len / 2 - .012, 0); hm.position.z = z; grp.add(hm); clock.add(grp); return grp; };
  const hourH = mkHand(.082, .011, .016), minH = mkHand(.125, .008, .018);
  const secH = mkHand(.14, .0035, .02); secH.children[0].material = new THREE.MeshBasicMaterial({ color: 0xb03a3a });

  /* --- door, poster, AC, misc --- */
  box(g, M.deskWood, .82, 2.02, .05, 1.55, 1.01, z1 - .02);
  box(g, M.deskWood, .68, .8, .02, 1.55, 1.5, z1 - .055).castShadow = false;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.028, 14, 10), M.metalDark); knob.position.set(1.22, 1.02, z1 - .07); knob.castShadow = true; g.add(knob);
  const posterTex = canvasTex(384, 512, (c2, w, hh) => { const gr = c2.createLinearGradient(0, 0, 0, hh);
    gr.addColorStop(0, '#0d2447'); gr.addColorStop(1, '#17457f'); c2.fillStyle = gr; c2.fillRect(0, 0, w, hh);
    c2.fillStyle = 'rgba(160,205,255,.85)'; c2.beginPath(); c2.arc(192, 190, 85, 0, 7); c2.fill();
    c2.fillStyle = '#0d2447'; c2.beginPath(); c2.arc(192, 168, 85, 0, 7); c2.fill();
    c2.fillStyle = '#eaf4ff'; c2.font = '300 44px "Segoe UI",sans-serif'; c2.textAlign = 'center'; c2.fillText('SIGNAL', 192, 372); c2.fillText('LOST', 192, 424);
    c2.font = '15px Consolas,monospace'; c2.fillStyle = 'rgba(190,220,255,.6)'; c2.fillText('— no carrier —', 192, 462); });
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(.52, .7), new THREE.MeshStandardMaterial({ map: posterTex, roughness: .9 }));
  poster.position.set(-1.5, 1.62, z0 + .045); g.add(poster);
  box(g, M.pillow, .8, .22, .18, .6, 2.32, z0 + .13, 0, .03); // AC
  box(g, M.plasticGrey, .6, .02, .1, .6, 2.22, z0 + .13).castShadow = false;
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.15), M.rug); rug.rotation.x = -Math.PI / 2; rug.rotation.z = .03;
  rug.position.set(.1, .006, .35); rug.receiveShadow = true; g.add(rug);
  cyl(g, M.plasticGrey, .13, .105, .3, 1.05, .15, -1.32); // trash bin
  W(.92, 1.18, -1.45, -1.19, .32);
  const crumple = new THREE.SphereGeometry(.035, 7, 6);
  [[1.02, -1.05], [.86, -1.3], [1.24, -1.28]].forEach(([x, z]) => { const s = new THREE.Mesh(crumple, M.paper); s.position.set(x, .03, z); s.castShadow = true; g.add(s); });
  box(g, M.cardboard, .44, .32, .36, 1.82, .16, -1.38, .12); box(g, M.cardboard, .36, .26, .3, 1.8, .45, -1.4, -.09);
  W(1.58, 2.06, -1.58, -1.18, .6);
  const ceilLamp = cyl(g, M.pillow, .19, .24, .09, 0, h - .05, 0); ceilLamp.castShadow = false;
  // anomaly shard (hidden until return)
  const deskShard = new THREE.Mesh(new THREE.OctahedronGeometry(.035), M.bsodBright);
  deskShard.position.set(-0.62, deskY + .06, -1.18); deskShard.visible = false; g.add(deskShard);

  /* --- devour face rig (hidden; driven by main sequence) --- */
  const faceGroup = new THREE.Group(); faceGroup.position.copy(MONITOR_POS); faceGroup.visible = false; g.add(faceGroup);
  const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), M.faceMat.clone()); facePlane.position.z = .05; faceGroup.add(facePlane);
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(.5, 40), new THREE.MeshBasicMaterial({ color: 0x000208 }));
  mouth.position.set(.28, -.28, .04); mouth.scale.set(.001, .001, 1); faceGroup.add(mouth);

  /* --- BSOD drawing --- */
  const FACE_RECT = { x: 78, y: 66, w: 250, h: 190 }; // canvas px where :( lives
  let bsodState = { stage: 0, percent: 0, standby: false, mouth: 0 };
  function drawBSOD(now = 0) {
    const c2 = bsodCtx, w = 1024, hh = 600, st = bsodState.stage;
    if (bsodState.standby) { c2.fillStyle = '#04070d'; c2.fillRect(0, 0, w, hh);
      if ((now % 5200) < 2600) { c2.fillStyle = 'rgba(150,200,255,.55)'; c2.font = '300 64px "Segoe UI",sans-serif'; c2.fillText(':(', 78, 150); }
      bsodTex.needsUpdate = true; return; }
    c2.fillStyle = '#0a64d8'; c2.fillRect(0, 0, w, hh);
    const jx = () => (st > .25 ? (Math.random() - .5) * st * 9 : 0), jy = () => (st > .45 ? (Math.random() - .5) * st * 6 : 0);
    // face
    const fs = 168 * (1 + st * .85);
    c2.fillStyle = '#eaf4ff'; c2.font = `300 ${fs}px "Segoe UI",sans-serif`; c2.textBaseline = 'top';
    c2.shadowColor = st > .3 ? `rgba(160,215,255,${st})` : 'transparent'; c2.shadowBlur = st * 30;
    c2.fillText(':(', FACE_RECT.x + jx() - st * 30, FACE_RECT.y + jy() - st * 22);
    c2.shadowBlur = 0;
    if (bsodState.mouth > 0) { const mx = FACE_RECT.x + 118, my = FACE_RECT.y + 130, mr = bsodState.mouth * 95;
      c2.fillStyle = '#000208'; c2.beginPath(); c2.ellipse(mx, my, mr * .82, mr, 0, 0, 7); c2.fill(); }
    c2.font = '26px "Segoe UI","Yu Gothic UI",sans-serif'; c2.fillStyle = '#eaf4ff';
    const corrupt = s => st < .2 ? s : s.split('').map(ch => Math.random() < st * .16 ? '�▚░'[Math.random() * 3 | 0] : ch).join('');
    const lines = [
      '問題が発生したため、PC を再起動する必要があります。',
      'エラー情報を収集中です。再起動は自動的に行われます。',
      '', `${Math.floor(bsodState.percent)}% 完了`, '',
      st > .55 ? '…こちらを、見ていますか。' : 'この問題と解決方法の詳細については、後でオンラインで検索してください。',
    ];
    lines.forEach((ln, i) => c2.fillText(corrupt(ln), 82 + jx(), 300 + i * 40 + jy()));
    // QR-ish block + stop code
    c2.fillStyle = '#eaf4ff'; c2.fillRect(82, 512, 64, 64); c2.fillStyle = '#0a64d8';
    for (let i = 0; i < 46; i++) c2.fillRect(86 + Math.random() * 54, 516 + Math.random() * 54, 5, 5);
    c2.fillStyle = '#eaf4ff'; c2.font = '19px "Segoe UI",sans-serif';
    c2.fillText('停止コード: ' + corrupt('CRITICAL_PROCESS_DIED'), 168, 528);
    c2.fillText(corrupt('失敗した内容: reality.sys'), 168, 556);
    // slice glitches (small bands only, rate limited by caller)
    if (st > .3) { const bands = Math.floor(st * 6);
      for (let i = 0; i < bands; i++) { const y = Math.random() * hh, bh = 3 + Math.random() * 15, off = (Math.random() - .5) * st * 90;
        c2.drawImage(bsodCanvas, 0, y, w, bh, off, y, w, bh); } }
    if (st > .65) { c2.fillStyle = `rgba(0,6,24,${(st - .65) * .5})`; for (let i = 0; i < 12; i++) c2.fillRect(Math.random() * w, Math.random() * hh, Math.random() * 190, 5 + Math.random() * 24); }
    bsodTex.needsUpdate = true;
  }
  drawBSOD(0);

  /* --- dynamic refs / update --- */
  const refs = {
    group: g, screen, screenMat, screenGeo, basePos, monitorLight, monitorGlow, monLED,
    faceGroup, facePlane, mouth, chair, deskShard, fan,
    clockHands: { hourH, minH, secH }, clockPos: new THREE.Vector3(.9, 1.95, z1 - .1),
    fanPos: new THREE.Vector3(.42, 1.0, -1.38),
    clockRunning: true, clockTime: 3 * 3600 + 32 * 60 + 10, _lastSec: -1,
    drawBSOD, bsodState, FACE_RECT, bsodCanvas,
    setScreenBulge(amount) { // geometry-level glitch: screen swells toward the player near the face
      const pos = screenGeo.attributes.position, arr = pos.array;
      const fx = -.13, fy = .05;
      for (let i = 0; i < arr.length; i += 3) { const x = basePos[i], y = basePos[i + 1];
        const d2 = (x - fx) * (x - fx) + (y - fy) * (y - fy);
        arr[i + 2] = amount * .16 * Math.exp(-d2 * 26) + amount * .012 * Math.sin(x * 40) * Math.cos(y * 34); }
      pos.needsUpdate = true; screenGeo.computeVertexNormals();
    },
    update(dt, t, audio) {
      fan.rotation.x += dt * 14;
      deskShard.rotation.y += dt * 1.4; deskShard.position.y = deskY + .06 + Math.sin(t * 2) * .006;
      // monitor light: near-imperceptible mains breathing (no strobe)
      monitorLight.intensity = (bsodState.standby ? 2.6 : 14) + Math.sin(t * 7.3) * .1 + Math.sin(t * 1.7) * .16;
      if (refs.clockRunning) { refs.clockTime += dt;
        const s = refs.clockTime % 60, m = (refs.clockTime / 60) % 60, hr = (refs.clockTime / 3600) % 12;
        secH.rotation.z = -Math.floor(s) / 60 * Math.PI * 2; // ticking (stepped) second hand
        minH.rotation.z = -m / 60 * Math.PI * 2; hourH.rotation.z = -hr / 12 * Math.PI * 2;
        const whole = Math.floor(refs.clockTime);
        if (whole !== refs._lastSec) { refs._lastSec = whole; audio && audio.clockTick(); } }
    },
    setAnomaly(on) { // the room after you come back: something is slightly wrong
      deskShard.visible = on; refs.clockRunning = !on;
      if (on) { secH.rotation.z = -33 / 60 * Math.PI * 2; minH.rotation.z = -33 / 60 * Math.PI * 2; hourH.rotation.z = -(3 + 33 / 60) / 12 * Math.PI * 2; // stopped at 3:33
        chair.rotation.z = .5; chair.position.set(.18, .1, -.35); chair.rotation.y = 2.6; // knocked over
        monLED.material = M.ledBlue; bsodState.standby = true; }
      else { chair.rotation.set(0, Math.PI + .14, 0); chair.position.set(-0.3, 0, -0.52);
        monLED.material = M.ledAmber; bsodState.standby = false; refs.clockTime = 3 * 3600 + 32 * 60 + 10; }
      drawBSOD(performance.now());
    },
    reset() { bsodState.stage = 0; bsodState.percent = 0; bsodState.mouth = 0; refs.setScreenBulge(0);
      faceGroup.visible = false; faceGroup.scale.setScalar(1); faceGroup.position.copy(MONITOR_POS); mouth.scale.set(.001, .001, 1);
      refs.setAnomaly(false); drawBSOD(0); },
  };
  return refs;
}
