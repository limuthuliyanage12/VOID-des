/* VOID · venue3d.js: the three 3D scenes (three.js r128).
   V3D.venue(el, opts)   Lotus Tower grounds with Fly and Walk
   V3D.tables(el, opts)  VIP table map
   V3D.preview(el, objs) venue builder preview
   Palette: black ground, dark structures with white edges, and three emissive whites only. */
(() => {
const RM = matchMedia('(prefers-reduced-motion:reduce)').matches;
const W = 0xffffff, WARM = 0xead9b5, COOL = 0xdcebff;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TOUCH = matchMedia('(pointer:coarse)').matches;
const hasGL = () => { try { const c = document.createElement('canvas'); return !!(window.THREE && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch { return false; } };
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

/* ---------- Core: renderer, lights, a loop that only runs on screen ---------- */
function core(el, near = 70, far = 200) {
  const small = innerWidth < 900;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !small });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.25 : 1.5)); renderer.setClearColor(0x000000, 0);
  el.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x000000, near, far);
  const camera = new THREE.PerspectiveCamera(50, 1, .1, 600);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x0a0a0a, .7));
  const dl = new THREE.DirectionalLight(0xffffff, .8); dl.position.set(-30, 50, 40); scene.add(dl);
  const size = () => { const w = el.clientWidth, hh = el.clientHeight; if (!w || !hh) return; renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.updateProjectionMatrix(); };
  new ResizeObserver(size).observe(el); size();
  let vis = true, raf = 0, last = performance.now(); const fns = [];
  const loop = (now) => { raf = 0; if (!vis || document.hidden) return; const dt = Math.min(.05, (now - last) / 1000); last = now; fns.forEach((f) => f(dt, now / 1000)); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  new IntersectionObserver(([x]) => { vis = x.isIntersecting; if (vis) kick(); }).observe(el);
  document.addEventListener('visibilitychange', kick); kick();
  return { renderer, scene, camera, onFrame: (f) => fns.push(f), size };
}

/* ---------- Building blocks ---------- */
const mats = {};
const M = (c, o = {}) => { const k = c + JSON.stringify(o); return mats[k] || (mats[k] = new THREE.MeshStandardMaterial({ color: c, metalness: .35, roughness: .7, ...o })); };
const E = (c, i = 1) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: i });
let edge;
const edges = (m, op) => { edge = edge || new THREE.LineBasicMaterial({ color: W, transparent: true, opacity: .24 }); m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), op ? new THREE.LineBasicMaterial({ color: W, transparent: true, opacity: op }) : edge)); return m; };
function box(g, w, hh, d, x, y, z, o = {}) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), o.mat || M(o.c || 0x171717)); m.position.set(x, y + hh / 2, z); if (o.ry) m.rotation.y = o.ry; g.add(m); if (!o.plain) edges(m, o.edge); return m; }
function cyl(g, rt, rb, hh, x, y, z, o = {}) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, hh, o.seg || 24), o.mat || M(o.c || 0x171717)); m.position.set(x, y + hh / 2, z); g.add(m); if (o.edged) edges(m); return m; }
const signs = [];
function sign(g, text, w, hh, x, y, z, ry = 0, o = {}) {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * hh / w); const tex = new THREE.CanvasTexture(c);
  const draw = () => { const k = c.getContext('2d'); k.clearRect(0, 0, c.width, c.height); if (!o.bare) { k.fillStyle = '#111111'; k.fillRect(0, 0, c.width, c.height); k.strokeStyle = 'rgba(255,255,255,.5)'; k.lineWidth = 6; k.strokeRect(3, 3, c.width - 6, c.height - 6); }
    k.fillStyle = o.color || '#ffffff'; k.textAlign = 'center'; k.textBaseline = 'middle'; let fs = c.height * .5; k.font = `600 ${fs}px Inter, system-ui, sans-serif`; while (k.measureText(text).width > c.width * .86 && fs > 10) { fs -= 4; k.font = `600 ${fs}px Inter, system-ui, sans-serif`; }
    k.fillText(text, c.width / 2, c.height / 2 + fs * .04); tex.needsUpdate = true; };
  draw(); signs.push(draw);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: o.flat ? THREE.FrontSide : THREE.DoubleSide, opacity: o.opacity || 1, fog: !o.flat }));
  m.position.set(x, y, z); if (o.flat) m.rotation.x = -Math.PI / 2; m.rotation[o.flat ? 'z' : 'y'] = ry; g.add(m);
  if (!o.flat) { m.material.side = THREE.FrontSide; const b = m.clone(); b.rotation.y = ry + Math.PI; g.add(b); } return m;
}
document.fonts && document.fonts.ready.then(() => signs.forEach((d) => d()));
function people(scene, n, spot) { const body = new THREE.InstancedMesh(new THREE.CylinderGeometry(.22, .28, 1.1, 6), M(0x2a2a2a, { roughness: 1 }), n), head = new THREE.InstancedMesh(new THREE.SphereGeometry(.2, 8, 6), M(0x8a8a8a, { roughness: 1 }), n);
  const P = [], d = new THREE.Object3D(); for (let i = 0; i < n; i++) P.push([...spot(i), Math.random() * 6.28, .7 + Math.random() * .6]);
  const set = (t) => P.forEach(([x, z, ph, sp], i) => { const y = RM ? 0 : Math.abs(Math.sin(t * 4 * sp + ph)) * .16; d.position.set(x, .55 + y, z); d.updateMatrix(); body.setMatrixAt(i, d.matrix); d.position.y = 1.32 + y; d.updateMatrix(); head.setMatrixAt(i, d.matrix); body.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = true; });
  set(0); scene.add(body, head); return set; }
function lotus(g, x, z, s = 1) { const t = new THREE.Group(); t.position.set(x, 0, z); t.scale.setScalar(s); g.add(t);
  [[9, 1.2], [7.4, 1], [6, .9]].forEach(([r, hh], i) => cyl(t, r, r + .4, hh, 0, i * 1.05, 0, { seg: 32, edged: true }));
  cyl(t, 1.9, 2.7, 46, 0, 3, 0, { seg: 18, c: 0x1c1c1c });
  for (let i = 0; i < 18; i++) { const a = i / 18 * 6.283; const r = box(t, .16, 46, .3, Math.sin(a) * 2.35, 3, Math.cos(a) * 2.35, { plain: true, c: 0x2a2a2a }); r.rotation.y = a; }
  cyl(t, 3.4, 2.2, 1.6, 0, 49, 0, { seg: 24, edged: true });
  const pts = [[0, 0], [3.2, .6], [5.4, 3], [5.9, 6], [4.8, 9], [2.6, 11], [0, 11.6]].map(([a, b]) => new THREE.Vector2(a, b));
  const budMat = E(WARM, .55), bud = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), budMat); bud.position.y = 50.4; t.add(bud);
  const pet = new THREE.SphereGeometry(1, 10, 8), petMat = E(WARM, .8);
  [[8, 5.6, 51.5, 3.6], [8, 6, 54.5, 3.2], [7, 5.4, 57.5, 2.8], [6, 4.2, 60, 2.3]].forEach(([n, r, y, sz], k) => { for (let i = 0; i < n; i++) { const a = (i + k * .5) / n * 6.283, p = new THREE.Mesh(pet, petMat); p.scale.set(sz * .5, sz, .28); p.position.set(Math.sin(a) * r, y, Math.cos(a) * r); p.rotation.y = a; p.rotation.x = -.35; t.add(p); } });
  cyl(t, .5, 1.6, 4, 0, 62, 0, { c: 0x222222 }); const orb = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), E(COOL, 1.4)); orb.position.y = 67; t.add(orb); cyl(t, .08, .16, 9, 0, 68, 0, { mat: E(COOL, 1.2) });
  return (time) => { if (!RM) petMat.emissiveIntensity = .7 + Math.sin(time * 1.2) * .25; }; }
function stage(g, w, z) { box(g, w, 1.4, 8, 0, 0, z); box(g, w, .12, .18, 0, 1.4, z + 4, { mat: E(W, 1.6), plain: true });
  const booth = box(g, 4, 1.1, 1.4, 0, 1.4, z, { mat: E(W, .5) });
  [-1, 1].forEach((s) => { for (let i = 0; i < 3; i++) box(g, 1.6, 1.5, 1.4, s * (w / 2 - 1.4), 1.4 + i * 1.55, z + 2, { c: 0x0e0e0e }); box(g, .5, 9, .5, s * (w / 2 - .3), 0, z - 3); box(g, .5, 9, .5, s * (w / 2 - .3), 0, z + 3.4); });
  box(g, w, .6, .6, 0, 9, z + 3.4); box(g, w, .6, .6, 0, 9, z - 3);
  const cones = []; const cg = new THREE.ConeGeometry(2.4, 13, 20, 1, true); cg.translate(0, -6.5, 0);
  for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: W, transparent: true, opacity: .07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); c.position.set(-w / 2 + 1.5 + i * (w - 3) / 5, 9, z + 3.4); c.rotation.x = .5; g.add(c); cones.push(c); }
  return (time) => { if (RM) return; cones.forEach((c, i) => { c.rotation.z = Math.sin(time * .8 + i) * .5; c.rotation.x = .5 + Math.sin(time * .5 + i * 2) * .25; }); booth.material.emissiveIntensity = .5 + Math.abs(Math.sin(time * 4)) * .5; }; }
const motes = (scene, n, spread, col = W) => { const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = (Math.random() - .5) * spread; a[i * 3 + 1] = 1 + Math.random() * 16; a[i * 3 + 2] = (Math.random() - .5) * spread; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(a, 3)); const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: col, size: .16, transparent: true, opacity: .7 })); scene.add(p);
  return (dt) => { if (RM) return; for (let i = 0; i < n; i++) { a[i * 3 + 1] += dt * .35; if (a[i * 3 + 1] > 18) a[i * 3 + 1] = 1; } geo.attributes.position.needsUpdate = true; p.rotation.y += dt * .01; }; };

/* ---------- Orbit camera with eased goals, and pointer handling ---------- */
function orbit(camera, init, lim = { r: [12, 120], ph: [.12, 1.5] }) { const cur = { ...init }, goal = { ...init }; let auto = !RM, idle = 0;
  return { cur, goal, lim, touch() { auto = false; idle = 0; }, set(o) { this.touch(); Object.assign(goal, o); }, zoom(f) { this.touch(); goal.r = clamp(goal.r * f, ...lim.r); }, reset() { Object.assign(goal, init); auto = !RM; },
    step(dt) { if (auto) goal.th += dt * .05; else if (!RM && (idle += dt) > 6) auto = true; goal.ph = clamp(goal.ph, ...lim.ph); for (const k in cur) cur[k] += (goal[k] - cur[k]) * Math.min(1, dt * 4);
      const { th, ph, r, x, y, z } = cur; camera.position.set(x + r * Math.sin(th) * Math.cos(ph), y + r * Math.sin(ph), z + r * Math.cos(th) * Math.cos(ph)); camera.lookAt(x, y, z); } }; }
function pointer(el, cv, { drag, tap, pinch, move }) { const pts = new Map(); let moved = 0, pd = 0;
  cv.addEventListener('pointerdown', (e) => { el.focus({ preventScroll: true }); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pd = Math.hypot(a[0] - b[0], a[1] - b[1]); } try { cv.setPointerCapture(e.pointerId); } catch { /* ok */ } });
  cv.addEventListener('pointermove', (e) => { const p = pts.get(e.pointerId); if (!p) return move && move(e); const dx = e.clientX - p[0], dy = e.clientY - p[1]; pts.set(e.pointerId, [e.clientX, e.clientY]); moved += Math.abs(dx) + Math.abs(dy);
    if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pd) pinch && pinch(pd / d); pd = d; } else drag(dx, e.pointerType === 'touch' ? 0 : dy, e, dy); });
  const up = (e) => { if (pts.delete(e.pointerId) && moved < 6 && e.type === 'pointerup') tap && tap(e); pd = 0; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); pinch && pinch(e.deltaY > 0 ? 1.1 : .9); } }, { passive: false }); }
const fullscreen = (el, core) => { const set = (on) => { el.classList.toggle('full', on); document.documentElement.style.overflow = on ? 'hidden' : ''; core && core.size(); if (on) { try { el.requestFullscreen && el.requestFullscreen().catch(() => {}); } catch { /* ok */ } } else if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.classList.contains('full')) set(false); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && el.classList.contains('full')) set(false); });
  return () => set(!el.classList.contains('full')); };
const overlay = (el, modes, tools) => { el.append(h(`<div class="v3d-top"><div class="toggle" role="group" aria-label="${modes.label}"><span class="toggle-thumb" aria-hidden="true"></span>${modes.items.map((m, i) => `<button type="button" data-mode="${m.toLowerCase()}" aria-pressed="${i === 0}">${m}</button>`).join('')}</div><div class="v3d-tools">${tools.map(([id, label, txt]) => `<button type="button" class="${txt.length > 2 ? 'btn btn-line btn-sm' : 'icon-btn'}" data-tool="${id}" aria-label="${label}">${txt}</button>`).join('')}</div></div>`)); if (!modes.items.length) el.querySelector('.toggle').remove(); };

/* ---------- A. Venue: Lotus Tower grounds ---------- */
const POIS = [
  { id: 'stage', name: 'Main stage', dims: '18 m wide · DJ booth · 6 light rigs', desc: 'The centre of the night. Speaker stacks on both sides, a truss overhead and the floor ring right in front.', x: 0, z: -9, r: 7, view: [0, 34] },
  { id: 'backstage', name: 'Backstage', dims: 'Crew and artists only', desc: 'Green room, production, security, crew and artist rooms behind the stage wall. Not open to ticket holders.', x: 0, z: -24, r: 5 },
  { id: 'gold', name: 'VIP deck Gold', dims: '8 tables · LKR 100,000 each', desc: 'A raised deck on the west side with a clear view of the stage. Each table seats up to 6 and has its own VIP entrance.', x: -15, z: 0, r: 7, view: [.9, 30] },
  { id: 'platinum', name: 'VIP deck Platinum', dims: '8 tables · LKR 180,000 each', desc: 'The lake-side deck beside the stage. Each table seats up to 10 and comes with a table host.', x: 15, z: 0, r: 7, view: [-.9, 30] },
  { id: 'bar', name: '360 Bar', dims: 'Round bar · middle of the floor', desc: 'Order from any side. The glowing ring on top makes it easy to find from anywhere on the floor.', x: 0, z: 12, r: 5, view: [.5, 24] },
  { id: 'desk', name: 'Sound desk', dims: 'Front of house', desc: 'Where the sound and lights are mixed. Fenced on four sides, and the best spot to hear the room.', x: 0, z: 22, r: 4 },
  { id: 'food', name: 'Food stalls', dims: '8 stalls · lakeside row', desc: 'Energy, juice, food, veggie, bar and water along the lake, with first aid and the help desk at the end.', x: 27, z: 4, r: 6, view: [-1.2, 32] },
  { id: 'aid', name: 'First aid and help desk', dims: 'Lakeside row, south end', desc: 'Trained first aiders all night, and a help desk for lost items, tickets and anything else.', x: 27, z: 19, r: 3.5 },
  { id: 'rest', name: 'Restrooms', dims: '2 blocks · M and W', desc: 'Two blocks at the south end of the grounds, a short walk from the bar.', x: 1, z: 41, r: 6, view: [.2, 30] },
  { id: 'check', name: 'Ticket check', dims: '2 lanes', desc: 'Have your QR ready. One scan admits a whole party pass.', x: -27, z: 26, r: 3.5 },
  { id: 'walk', name: 'Entry walkway', dims: 'Gate 02 to ticket check', desc: 'A lit path from Lotus Road straight to the ticket check and the ENTRY arch.', x: -35, z: 26, r: 3.5, view: [1.3, 30] },
  { id: 'box', name: 'Box office and merch', dims: '5 counters', desc: 'Collect tickets, buy at the gate, get help, check in for VIP or pick up merch.', x: -28, z: 35, r: 5 },
  { id: 'gate1', name: 'Gate 01', dims: 'Lotus Road · north', desc: 'The north gate on Lotus Road, used for exit and for VIP drop-off.', x: -41, z: -6, r: 3.5 },
  { id: 'gate2', name: 'Gate 02', dims: 'Lotus Road · main entry', desc: 'The main way in. Gates open at 4 pm.', x: -41, z: 26, r: 3.5 },
  { id: 'amb', name: 'Ambulance bay', dims: '3 ambulances · covered', desc: 'Three ambulances on standby under cover for the whole event.', x: 22, z: 40, r: 5 },
  { id: 'fire', name: 'Fire tender', dims: 'North-west corner', desc: 'A fire tender and crew stationed on site.', x: -34, z: -24, r: 4 },
  { id: 'tower', name: 'Lotus Tower', dims: '350 m tall · Nelum Kuluna', desc: 'The tallest tower in South Asia, glowing just north of the stage.', x: 0, z: -40, r: 9, view: [0, 70] },
  { id: 'lake', name: 'Beira Lake', dims: 'East edge', desc: 'The lake runs along the east side, behind the food stalls and the Platinum deck.', x: 40, z: 6, r: 8 },
];
const STALLS = ['Energy', 'Juice', 'Food', 'Veggie', 'Bar', 'Water', 'First aid', 'Help desk'], COUNTERS = ['Collect', 'At gate', 'Help', 'VIP entry', 'Merch'];
STALLS.forEach((n, i) => POIS.push({ id: 's' + i, name: n + (i < 6 ? ' stall' : ''), dims: 'Lakeside row', desc: `${n}, stall ${i + 1} of 8 on the lakeside row.`, x: 24.6, z: -10 + i * 4.2, r: 1.6, small: true }));
COUNTERS.forEach((n, i) => POIS.push({ id: 'c' + i, name: n + ' counter', dims: 'Box office', desc: `${n} counter, ${i + 1} of 5 by the entry.`, x: -36 + i * 4, z: 32.4, r: 1.5, small: true }));

function buildVenue(scene) { const col = [], g = scene, anim = [];
  const C = (x, z, r) => col.push({ x, z, r }), B = (x, z, w, d) => col.push({ x, z, w, d });
  const plane = (w, d, x, z, c, y = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(c, { roughness: 1, metalness: 0 })); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; };
  plane(130, 130, 0, 0, 0x050505); edges(plane(36, 46, 0, 6, 0x0b0b0b, .02), .35);
  const ring = new THREE.Mesh(new THREE.RingGeometry(11.7, 12, 64), new THREE.MeshBasicMaterial({ color: W, transparent: true, opacity: .8, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(0, .05, 4); g.add(ring);
  /* Beira Lake and kerb, Lotus Road */
  const lake = plane(32, 130, 49, 0, 0x0a0f14, .03); lake.material = new THREE.MeshStandardMaterial({ color: 0x0a0f14, metalness: .95, roughness: .18, emissive: COOL, emissiveIntensity: .05 }); box(g, .6, .5, 130, 33, 0, 0, { plain: true, c: 0x222222 });
  plane(10, 130, -51, 0, 0x0e0e0e, .03); for (let z = -60; z < 62; z += 6) plane(.25, 3, -51, z, 0x9a9a9a, .05);
  anim.push(lotus(g, 0, -40)); C(0, -40, 9.5);
  /* Back of house */
  ['Green room', 'Production', 'Security', 'Crew room', 'Artist room'].forEach((n, i) => { const x = -14 + i * 7; box(g, 6, 3, 4, x, 0, -26); sign(g, n.toUpperCase(), 4.4, .8, x, 2.2, -23.95); B(x, -26, 6, 4); });
  box(g, 30, 4, .5, 0, 0, -20); sign(g, 'BACKSTAGE', 7, 1.2, 0, 2.6, -19.7); B(0, -20, 30, .5);
  box(g, .4, 4, .4, 17, 0, -20); box(g, .4, 4, .4, 21, 0, -20); box(g, 4.4, .5, .5, 19, 4, -20); sign(g, 'ARTISTS GATE', 3.6, .6, 19, 3.4, -19.7);
  anim.push(stage(g, 18, -14)); B(0, -14, 18, 8);
  /* VIP decks */
  [[-15, .35, 'VIP · GOLD', WARM], [15, -.35, 'VIP · PLATINUM', COOL]].forEach(([x, ry, name, c]) => { const d = new THREE.Group(); d.position.set(x, 0, 0); d.rotation.y = ry; g.add(d);
    box(d, 8, 1, 12, 0, 0, 0); box(d, 8.2, .1, .15, 0, 1, 6, { mat: E(c, 1.4), plain: true }); box(d, 8.2, .1, .15, 0, 1, -6, { mat: E(c, 1.4), plain: true });
    [[-4, -6], [4, -6], [-4, 6], [4, 6], [-4, 0], [4, 0]].forEach(([px, pz]) => box(d, .14, 1.1, .14, px, 1, pz, { plain: true, c: 0x555555 })); [-4, 4].forEach((px) => box(d, .08, .08, 12, px, 2, 0, { plain: true, c: 0x666666 })); box(d, 8, .08, .08, 0, 2, -6, { plain: true, c: 0x666666 });
    for (let i = 0; i < 4; i++) cyl(d, .9, .9, .12, i % 2 ? 2 : -2, 1.75, -3.5 + Math.floor(i / 2) * 6, { mat: E(c, .5) });
    sign(d, name, 5, .9, 0, 3.6, -6, 0); box(d, .12, 2.6, .12, -2.4, 1, -6, { plain: true }); box(d, .12, 2.6, .12, 2.4, 1, -6, { plain: true }); C(x, 0, 7); });
  /* 360 Bar, sound desk */
  cyl(g, 2.6, 2.6, 1.1, 0, 0, 12, { seg: 32, edged: true }); const top = new THREE.Mesh(new THREE.TorusGeometry(2.6, .09, 8, 48), E(WARM, 1.6)); top.rotation.x = Math.PI / 2; top.position.set(0, 3.1, 12); g.add(top); cyl(g, .25, .25, 3.1, 0, 0, 12, {});
  sign(g, '360 BAR', 3.6, .8, 0, 3.9, 12, 0); C(0, 12, 3.2);
  box(g, 4, 1.2, 2.4, 0, 0, 22); box(g, 3.4, .5, 1.2, 0, 1.2, 22, { mat: E(W, .25) }); [[-2.6, 0, .1, 3.6], [2.6, 0, .1, 3.6], [0, -1.8, 5.2, .1], [0, 1.8, 5.2, .1]].forEach(([fx, fz, w, d]) => box(g, w, 1, d, fx, 0, 22 + fz, { plain: true, c: 0x444444 })); B(0, 22, 5.4, 3.8);
  /* Stalls and counters */
  STALLS.forEach((n, i) => { const z = -10 + i * 4.2; box(g, 3, 2.6, 3, 27, 0, z); box(g, 3.6, .14, 3.6, 27, 2.6, z, { c: 0x242424 }); sign(g, n.toUpperCase(), 2.8, .6, 25.45, 2, z, -Math.PI / 2); B(27, z, 3, 3); });
  COUNTERS.forEach((n, i) => { const x = -36 + i * 4; box(g, 3.2, 2.4, 2.4, x, 0, 35); sign(g, n.toUpperCase(), 2.8, .55, x, 1.9, 33.75, 0); B(x, 35, 3.2, 2.4); });
  /* Fences with two gates on Lotus Road */
  const fence = (x, z, w, d) => { box(g, w, 1.5, d, x, 0, z, { plain: true, c: 0x2e2e2e }); B(x, z, Math.max(w, .5), Math.max(d, .5)); };
  fence(-3.5, -31, 73, .12); fence(-3.5, 46, 73, .12); fence(33, 7.5, .12, 77); fence(-40, -19.5, .12, 23); fence(-40, 10, .12, 28); fence(-40, 37, .12, 18);
  [['GATE 01', -6], ['GATE 02', 26]].forEach(([n, z]) => { box(g, .5, 4.4, .5, -40, 0, z - 2); box(g, .5, 4.4, .5, -40, 0, z + 2); box(g, .6, .7, 4.6, -40, 4.4, z); sign(g, n, 3.6, .7, -40.35, 4.75, z, -Math.PI / 2); });
  /* Entry: lit walkway, arch, ticket-check lanes */
  plane(12, 3, -34, 26, 0x121212, .04); [-1.6, 1.6].forEach((o) => box(g, 12, .06, .1, -34, .02, 26 + o, { mat: E(W, 1.2), plain: true }));
  box(g, .4, 4, .4, -29, 0, 23.8); box(g, .4, 4, .4, -29, 0, 28.2); box(g, .5, .9, 4.8, -29, 4, 26, { mat: E(W, .4) }); sign(g, 'ENTRY', 3.2, .7, -29.3, 4.45, 26, -Math.PI / 2);
  [24.2, 26, 27.8].forEach((z) => { box(g, 3, .9, .12, -26.5, 0, z, { plain: true, c: 0x555555 }); B(-26.5, z, 3, .3); });
  /* Restrooms, safety */
  [['M', -4], ['W', 6]].forEach(([n, x]) => { box(g, 6, 3, 4, x, 0, 42); sign(g, n, 1.2, 1.2, x, 2, 39.95, 0); B(x, 42, 6, 4); });
  box(g, 12, .2, 6, 22, 3.4, 41, { c: 0x202020 }); [[16.4, 38.4], [27.6, 38.4], [16.4, 43.6], [27.6, 43.6]].forEach(([x, z]) => box(g, .2, 3.4, .2, x, 0, z, { plain: true })); sign(g, 'AMBULANCE BAY', 5, .6, 22, 3.1, 37.95, 0);
  [18.5, 22, 25.5].forEach((x) => { box(g, 2, 1.8, 4.4, x, .3, 41, { c: 0xcfcfcf }); box(g, 1.2, .2, .3, x, 2.1, 39.6, { mat: E(W, 1), plain: true }); }); B(22, 41, 11, 5);
  box(g, 2.4, 2.2, 6, -34, .4, -24, { c: 0x3a3a3a }); box(g, 2.2, .5, 4, -34, 2.6, -23.4, { c: 0x555555 }); B(-34, -24, 2.6, 6.2);
  /* Crowd, motes */
  const clear = (x, z) => Math.hypot(x, z - 12) > 4.4 && !(Math.abs(x) < 3.6 && Math.abs(z - 22) < 3);
  anim.push(people(g, 110, () => { let x, z; do { x = (Math.random() - .5) * 20; z = -8 + Math.random() * 34; } while (!clear(x, z)); return [x, z]; }));
  const mo = motes(g, 160, 70); let last = 0; anim.push((t) => { mo(Math.min(.05, t - last)); last = t; });
  return { col, anim }; }

function flat(el, venue, o) { el.classList.add('flatmode');
  const A = [['Main stage', 50, 14], ['Food stalls', 86, 46], ['Bar', 50, 62], ['VIP deck', 16, 40], ['Entry gate', 12, 86], ['Restrooms', 62, 90]];
  el.append(h(`<div class="flat"><div class="flat-map tilt"><span>General Admission</span>${A.map(([n, x, y]) => `<button type="button" style="left:${x}%;top:${y}%" aria-pressed="false">${n}</button>`).join('')}</div><p class="flat-note">The 3D model of ${venue} is on the way.</p></div>`));
  overlay(el, { label: 'View', items: ['Fly', 'Walk'] }, []);
  const map = el.querySelector('.flat-map'); el.querySelectorAll('[data-mode]').forEach((b, i) => b.onclick = () => { el.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', x === b)); el.querySelector('.toggle').style.setProperty('--at', i); map.classList.toggle('tilt', i === 0); });
  map.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; map.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); o.info && (o.info.innerHTML = `<h3 class="h-card">${b.textContent}</h3><p class="dim">${venue}</p><p>A flat layout for now. The full 3D walk-through arrives once this venue's model is approved.</p>`); }; }

function venue(el, o = {}) { el.tabIndex = 0; el.setAttribute('role', 'application'); el.setAttribute('aria-label', '3D view of ' + (o.name || 'the venue') + '. Use the area buttons below for a text description of each place.');
  if (!o.model || !hasGL()) return flat(el, o.name || 'this venue', o);
  const k = core(el), { scene, camera } = k, { col, anim } = buildVenue(scene);
  overlay(el, { label: 'Camera mode', items: ['Fly', 'Walk'] }, [['out', 'Zoom out', '−'], ['in', 'Zoom in', '+'], ['reset', 'Reset view', 'Reset'], ['full', 'Full screen', 'Full Screen']]);
  const hint = h('<p class="v3d-hint"></p>'), label = h('<span class="v3d-label" hidden></span>'), joy = h('<div class="joy" aria-hidden="true"><i></i></div>'); el.append(hint, label, joy); if (TOUCH) el.classList.add('touch');
  const HINT = { fly: TOUCH ? 'Swipe sideways to turn · pinch to zoom · tap a place' : 'Drag to turn · Ctrl + scroll to zoom · click a place', walk: TOUCH ? 'Joystick to move · drag to look' : 'Click the view, then W A S D or arrows to move · Shift to run · drag to look' };
  /* markers */
  const marks = {}; POIS.forEach((p) => { const m = new THREE.Mesh(new THREE.RingGeometry(p.r * (p.small ? .55 : .8), p.r * (p.small ? .55 : .8) + (p.small ? .1 : .18), 40), new THREE.MeshBasicMaterial({ color: 0x777777, transparent: true, opacity: p.small ? .5 : .75, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.set(p.x, .07, p.z); scene.add(m); marks[p.id] = m; });
  const orb = orbit(camera, { th: .55, ph: .5, r: 78, x: 0, y: 2, z: 4 }); let mode = 'fly', active = null;
  const me = { x: -43, z: 26, yaw: Math.PI / 2, pitch: 0 }, keys = {}, jv = [0, 0];
  const free = (x, z) => Math.abs(x) < 63 && Math.abs(z) < 63 && x < 32.4 && !col.some((c) => c.r ? Math.hypot(x - c.x, z - c.z) < c.r + .45 : Math.abs(x - c.x) < c.w / 2 + .45 && Math.abs(z - c.z) < c.d / 2 + .45);
  const setActive = (p, quiet) => { if (active === p) return; if (active) marks[active.id].material.color.set(0x777777); active = p; if (p) marks[p.id].material.color.set(W);
    o.chips && o.chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', !!p && b.dataset.poi === p.id));
    if (o.info) o.info.innerHTML = p ? `<h3 class="h-card">${p.name}</h3><p class="dim">${p.dims}</p><p>${p.desc}</p>` : `<h3 class="h-card">Pick a place</h3><p class="dim">${o.name}</p><p>Tap a marker or an area button to hear about it.</p>`; };
  const goto = (p) => { setActive(p); if (mode === 'fly') orb.set({ x: p.x, z: p.z, y: 2, r: p.view ? p.view[1] : Math.max(22, p.r * 4), th: p.view ? p.view[0] : orb.goal.th, ph: .5 });
    else { let a = 0, x, z; do { x = p.x + Math.cos(a) * (p.r + 2.5); z = p.z + Math.sin(a) * (p.r + 2.5); a += .5; } while (!free(x, z) && a < 7); me.x = x; me.z = z; me.yaw = Math.atan2(p.x - x, -(p.z - z)); me.pitch = p.id === 'tower' ? .5 : 0; } };
  const setMode = (m) => { mode = m; el.classList.toggle('walk', m === 'walk'); el.querySelectorAll('[data-mode]').forEach((b, i) => { b.setAttribute('aria-pressed', b.dataset.mode === m); if (b.dataset.mode === m) el.querySelector('.toggle').style.setProperty('--at', i); }); hint.textContent = HINT[m]; label.hidden = true; if (m === 'walk') { me.x = -43; me.z = 26; me.yaw = Math.PI / 2; me.pitch = 0; } };
  el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  const fs = fullscreen(el, k);
  el.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => { const t = b.dataset.tool; if (t === 'in') orb.zoom(.8); if (t === 'out') orb.zoom(1.25); if (t === 'reset') { orb.reset(); setActive(null); if (mode === 'walk') setMode('walk'); } if (t === 'full') fs(); });
  const ray = new THREE.Raycaster(), gp = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), v2 = new THREE.Vector2(), hit = new THREE.Vector3();
  pointer(el, k.renderer.domElement, { drag: (dx, dy, e, rawDy) => { if (mode === 'fly') { orb.touch(); orb.goal.th -= dx * .006; orb.goal.ph += dy * .005; } else { me.yaw -= dx * .005; me.pitch = clamp(me.pitch + (e.pointerType === 'touch' ? 0 : rawDy * .004), -.6, .9); } },
    pinch: (f) => mode === 'fly' && orb.zoom(f),
    tap: (e) => { if (mode !== 'fly') return; const r = k.renderer.domElement.getBoundingClientRect(); v2.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(v2, camera); if (!ray.ray.intersectPlane(gp, hit)) return;
      let best = null, bd = 12; POIS.forEach((p) => { const d = Math.hypot(p.x - hit.x, p.z - hit.z) - (p.small ? 0 : p.r * .5); if (d < bd) { bd = d; best = p; } }); if (best) { orb.touch(); setActive(best); } } });
  /* Keys steer only while the 3D view has focus, so typing in a form never moves the camera. */
  el.addEventListener('keydown', (e) => { const c = e.code; if (/^(Key[WASD]|Arrow|Shift)/.test(c)) { keys[c] = true; if (mode === 'walk' && /^(Key[WASD]|Arrow)/.test(c)) e.preventDefault(); } });
  el.addEventListener('keyup', (e) => { keys[e.code] = false; }); el.addEventListener('blur', () => Object.keys(keys).forEach((c) => keys[c] = false));
  const knob = joy.firstChild; const jm = (e) => { const r = joy.getBoundingClientRect(); let x = (e.clientX - r.left - 54) / 40, y = (e.clientY - r.top - 54) / 40; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } jv[0] = x; jv[1] = y; knob.style.transform = `translate(${x * 30}px,${y * 30}px)`; };
  joy.addEventListener('pointerdown', (e) => { joy.setPointerCapture(e.pointerId); jm(e); }); joy.addEventListener('pointermove', (e) => e.buttons || e.pointerType === 'touch' ? jm(e) : 0);
  const je = () => { jv[0] = jv[1] = 0; knob.style.transform = ''; }; joy.addEventListener('pointerup', je); joy.addEventListener('pointercancel', je);
  const pv = new THREE.Vector3();
  k.onFrame((dt, t) => { anim.forEach((f) => f(t));
    if (mode === 'fly') { orb.step(dt); if (active) { pv.set(active.x, active.small ? 3.4 : 6, active.z).project(camera); label.hidden = pv.z > 1; label.textContent = active.name; label.style.left = (pv.x + 1) / 2 * el.clientWidth + 'px'; label.style.top = (1 - pv.y) / 2 * el.clientHeight + 'px'; } }
    else { const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - jv[1], s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + jv[0], sp = (keys.ShiftLeft || keys.ShiftRight ? 13 : 8) * dt;
      const dx = (Math.sin(me.yaw) * f + Math.cos(me.yaw) * s) * sp, dz = (-Math.cos(me.yaw) * f + Math.sin(me.yaw) * s) * sp; if (free(me.x + dx, me.z)) me.x += dx; if (free(me.x, me.z + dz)) me.z += dz;
      camera.position.set(me.x, 1.65, me.z); const cp = Math.cos(me.pitch); camera.lookAt(me.x + Math.sin(me.yaw) * cp, 1.65 + Math.sin(me.pitch), me.z - Math.cos(me.yaw) * cp);
      if (f || s) { const near = POIS.filter((p) => Math.hypot(p.x - me.x, p.z - me.z) < p.r + 1.5).sort((a, b) => a.r - b.r)[0]; if (near) setActive(near); } } });
  if (o.chips) { const AREAS = [['stage', 'Main stage'], ['gold', 'VIP deck'], ['bar', 'Bar'], ['food', 'Food stalls'], ['gate2', 'Entry gate'], ['rest', 'Restrooms'], ['tower', 'Lotus Tower']];
    o.chips.innerHTML = AREAS.map(([id, n]) => `<button type="button" data-poi="${id}" aria-pressed="false">${n}</button>`).join(''); o.chips.onclick = (e) => { const b = e.target.closest('button'); if (b) goto(POIS.find((p) => p.id === b.dataset.poi)); }; }
  setActive(null); setMode('fly'); return { goto, setMode }; }

/* ---------- B. VIP table map ---------- */
function tables(el, o) { el.tabIndex = 0; const list = o.tables, mine = o.tier;
  const tools = [['top', 'Top view', 'Top View'], ['out', 'Zoom out', '−'], ['in', 'Zoom in', '+'], ['reset', 'Reset view', 'Reset'], ['list', 'List view', 'List View']];
  let selected = o.selected || null; const state = (t) => t.tier !== mine ? 'locked' : t.id === selected ? 'selected' : t.status;
  const pick = (t) => { if (t.tier !== mine || t.status !== 'available') return false; selected = t.id; o.onSelect(t); refresh(); return true; };
  /* List view: every table as a keyboard-friendly row. Also the fallback when there is no WebGL. */
  const lv = h('<div class="tlist" hidden></div>'); const drawList = () => { lv.innerHTML = list.map((t) => { const s = state(t); return `<div><span><b>${t.id}</b> · ${t.tier === 'gold' ? 'Gold' : 'Platinum'} · ${t.seats} seats · ${V.money(t.price)}</span>${s === 'selected' ? '<span class="pill pill-ok">Selected</span>' : s === 'available' ? `<button class="btn btn-line btn-sm" data-t="${t.id}">Select</button>` : `<span class="pill pill-idle">${s === 'locked' ? 'Other tier' : s[0].toUpperCase() + s.slice(1)}</span>`}</div>`; }).join(''); };
  lv.onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) pick(list.find((t) => t.id === b.dataset.t)); };
  let refresh = drawList;
  if (!hasGL()) { el.append(h(`<div class="flat"><div class="flat-map"><span style="inset:4% 30% 78%">Stage</span>${list.map((t, i) => { const gcol = t.tier === 'gold', n = i % 8; return `<button type="button" data-t="${t.id}" style="left:${(gcol ? 14 : 72) + (n % 2) * 14}%;top:${34 + Math.floor(n / 2) * 15}%">${t.id}</button>`; }).join('')}</div></div>`));
    overlay(el, { label: '', items: [] }, [['orbit', 'Tilt the map', 'Orbit'], ['list', 'List view', 'List View']]); el.append(lv); const map = el.querySelector('.flat-map');
    refresh = () => { drawList(); map.querySelectorAll('button').forEach((b) => { const t = list.find((x) => x.id === b.dataset.t), s = state(t); b.disabled = s !== 'available' && s !== 'selected'; b.classList.toggle('sel', s === 'selected'); b.title = `${t.id} · ${s}`; }); };
    map.onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) pick(list.find((t) => t.id === b.dataset.t)); };
    el.querySelector('[data-tool=orbit]').onclick = () => map.classList.toggle('tilt'); el.querySelector('[data-tool=list]').onclick = () => { lv.hidden = !lv.hidden; }; refresh(); return; }
  const k = core(el, 60, 170), { scene, camera } = k, anim = [];
  overlay(el, { label: '', items: [] }, tools); el.append(lv); const tip = h('<span class="tip" hidden></span>'), hint = h(`<p class="v3d-hint">${TOUCH ? 'Tap a glowing table · swipe to turn' : 'Click a glowing table · drag to turn · Ctrl + scroll to zoom'}</p>`); el.append(tip, hint);
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), M(0x030303, { roughness: 1, metalness: 0 })); gr.rotation.x = -Math.PI / 2; scene.add(gr);
  box(scene, 60, .3, 44, 0, 0, 2, { c: 0x0b0b0b }); const grid = new THREE.GridHelper(60, 30, 0x2a2a2a, 0x1a1a1a); grid.position.set(0, .32, 2); grid.scale.z = 44 / 60; scene.add(grid);
  const sa = new Float32Array(1500); for (let i = 0; i < 500; i++) { const a = Math.random() * 6.283, b = Math.random() * 1.4 + .1, r = 150; sa[i * 3] = r * Math.cos(a) * Math.cos(b); sa[i * 3 + 1] = r * Math.sin(b); sa[i * 3 + 2] = r * Math.sin(a) * Math.cos(b); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sa, 3)); scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: W, size: .9, fog: false, transparent: true, opacity: .8 })));
  anim.push(lotus(scene, 0, -36, .9)); const st = new THREE.Group(); st.position.y = .3; scene.add(st); anim.push(stage(st, 16, -15));
  const fr = new THREE.Mesh(new THREE.RingGeometry(7.6, 7.9, 64), new THREE.MeshBasicMaterial({ color: W, transparent: true, opacity: .7, side: THREE.DoubleSide })); fr.rotation.x = -Math.PI / 2; fr.position.set(0, .36, -1); scene.add(fr);
  sign(scene, 'DANCE FLOOR', 9, 1.4, 0, .35, 8.6, 0, { flat: true, bare: true, opacity: .5 });
  const crowd = people(scene, 46, () => { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 7; return [Math.cos(a) * r, -1 + Math.sin(a) * r]; }); anim.push(crowd); scene.children.slice(-2).forEach((m) => m.position.y += .3);
  const T = {}, hits = [];
  [['gold', -15, .3, WARM, 'GOLD'], ['platinum', 15, -.3, COOL, 'PLATINUM']].forEach(([tier, x, ry, c, name]) => { const d = new THREE.Group(); d.position.set(x, .3, 4); d.rotation.y = ry; scene.add(d);
    box(d, 8, 1.25, 17, 0, 0, 0, { c: 0x121212 }); [[8.1, .08, .12, 0, 8.5], [8.1, .08, .12, 0, -8.5], [.12, .08, 17.1, -4, 0], [.12, .08, 17.1, 4, 0]].forEach(([w, hh, dd, px, pz]) => box(d, w, hh, dd, px, 1.25, pz, { mat: E(c, 1.5), plain: true }));
    for (let i = 0; i < 3; i++) box(d, 4, .42, .7, 0, .84 - i * .42, 8.85 + i * .7, { c: 0x161616 });
    sign(d, name, 5, 1, 0, 1.28, 0, 0, { flat: true, bare: true, opacity: .28 });
    list.filter((t) => t.tier === tier).forEach((t) => { const n = +t.id.slice(1) - 1, g = new THREE.Group(); g.position.set(n % 2 ? 2 : -2, 1.25, -6 + Math.floor(n / 2) * 4); d.add(g);
      const big = tier === 'platinum', R = big ? 1.05 : .85; cyl(g, .5, .6, .1, 0, 0, 0, { c: 0x1f1f1f }); cyl(g, .1, .1, .8, 0, .1, 0, { c: 0x333333 }); const topM = cyl(g, R, R, .1, 0, .9, 0, { mat: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, metalness: .4, roughness: .5 }) });
      const ringM = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: W, emissiveIntensity: 1 }), ring = new THREE.Mesh(new THREE.TorusGeometry(R + .04, .05, 8, 40), ringM); ring.rotation.x = Math.PI / 2; ring.position.y = 1.02; g.add(ring);
      cyl(g, .05, .05, .22, 0, 1, 0, { c: 0xdddddd }); const flame = new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), new THREE.MeshBasicMaterial({ color: WARM })); flame.position.y = 1.3; flame.scale.y = 1.6; g.add(flame);
      const stools = []; for (let i = 0; i < t.seats; i++) { const a = i / t.seats * 6.283; stools.push(cyl(g, .2, .2, .5, Math.cos(a) * (R + .55), 0, Math.sin(a) * (R + .55), { seg: 10, mat: new THREE.MeshStandardMaterial({ color: 0x2a2a2a }) })); }
      const cv = document.createElement('canvas'); cv.width = 160; cv.height = 72; const tex = new THREE.CanvasTexture(cv), pill = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); pill.scale.set(1.9, .86, 1); pill.position.y = 2.5; g.add(pill);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, 6, 20, 1, true), new THREE.MeshBasicMaterial({ color: W, transparent: true, opacity: .1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); cone.position.y = 4; cone.visible = false; g.add(cone);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 3, 12), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 1.4; hit.userData.t = t; g.add(hit); hits.push(hit);
      const drawPill = (inv, dim) => { const q = cv.getContext('2d'); q.clearRect(0, 0, 160, 72); q.globalAlpha = dim ? .35 : 1; q.fillStyle = inv ? '#fff' : 'rgba(0,0,0,.84)'; q.strokeStyle = 'rgba(255,255,255,.5)'; q.lineWidth = 3; q.beginPath(); (q.roundRect ? q.roundRect(4, 4, 152, 64, 32) : q.rect(4, 4, 152, 64)); q.fill(); q.stroke(); q.fillStyle = inv ? '#000' : '#fff'; q.font = '600 34px Inter, system-ui, sans-serif'; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText(t.id, 80, 38); tex.needsUpdate = true; };
      T[t.id] = { t, ring, ringM, flame, cone, pill, drawPill, topM, stools, flash: 0 }; }); });
  refresh = () => { drawList(); Object.values(T).forEach((x) => { const s = state(x.t); x.s = s; x.ring.position.y = 1.02; x.ring.scale.setScalar(1); x.cone.visible = s === 'selected'; x.flame.visible = s === 'available' || s === 'selected'; x.pill.visible = s !== 'locked';
    x.ringM.emissive.set(s === 'held' ? 0x777777 : s === 'reserved' ? 0x1c1c1c : s === 'locked' ? 0x101010 : W); x.ringM.emissiveIntensity = s === 'selected' ? 2 : s === 'available' ? 1 : s === 'held' ? .35 : .3;
    const fade = s === 'locked' ? .25 : 1; [x.topM, ...x.stools].forEach((m) => { m.material.transparent = true; m.material.opacity = fade; }); x.drawPill(s === 'selected', s !== 'available' && s !== 'selected'); }); };
  refresh(); document.fonts && document.fonts.ready.then(refresh);
  const home = { th: mine === 'gold' ? .5 : -.5, ph: .55, r: 30, x: mine === 'gold' ? -13 : 13, y: 1.5, z: 4 }, orb = orbit(camera, home, { r: [10, 80], ph: [.15, 1.5] });
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2(); const at = (e) => { const r = k.renderer.domElement.getBoundingClientRect(); v2.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(v2, camera); const i = ray.intersectObjects(hits)[0]; return i ? i.object.userData.t : null; };
  const cvs = k.renderer.domElement;
  pointer(el, cvs, { drag: (dx, dy) => { orb.touch(); orb.goal.th -= dx * .006; orb.goal.ph += dy * .005; }, pinch: (f) => orb.zoom(f),
    move: (e) => { const t = at(e); tip.hidden = !t; cvs.style.cursor = t ? (t.tier === mine && t.status === 'available' ? 'pointer' : 'not-allowed') : 'grab'; if (t) { const r = el.getBoundingClientRect(), s = state(t); tip.textContent = `${t.id} · ${t.tier === 'gold' ? 'Gold' : 'Platinum'} · ${t.seats} seats · ${V.money(t.price)} · ${s === 'locked' ? 'Other tier' : s[0].toUpperCase() + s.slice(1)}`; tip.style.left = Math.min(e.clientX - r.left, r.width - 280) + 'px'; tip.style.top = e.clientY - r.top + 'px'; } },
    tap: (e) => { const t = at(e); if (!t) return; orb.touch(); if (!pick(t)) { T[t.id].flash = 1; V.toast(t.tier !== mine ? `${t.id} is a ${t.tier === 'gold' ? 'Gold' : 'Platinum'} table. Go back to choose that tier.` : `${t.id} is ${t.status}. Pick a glowing table.`); } } });
  el.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => { const t = b.dataset.tool; if (t === 'in') orb.zoom(.8); if (t === 'out') orb.zoom(1.25); if (t === 'reset') orb.reset(); if (t === 'top') orb.set({ th: 0, ph: 1.45, r: 62, x: 0, z: 2, y: 0 }); if (t === 'list') { lv.hidden = !lv.hidden; b.textContent = lv.hidden ? 'List View' : '3D View'; } });
  k.onFrame((dt, t) => { anim.forEach((f) => f(t)); orb.step(dt); Object.values(T).forEach((x) => { if (x.s === 'selected' && !RM) { x.ring.position.y = 1.25 + Math.sin(t * 3) * .1; x.ring.scale.setScalar(1.06 + Math.sin(t * 3) * .04); } if (x.flame.visible && !RM) x.flame.scale.y = 1.5 + Math.sin(t * 14 + x.t.id.charCodeAt(2)) * .25;
    if (x.flash > 0) { x.flash -= dt * 2.5; x.ringM.emissive.set(x.flash > 0 && Math.sin(x.flash * 30) > 0 ? W : 0x222222); if (x.flash <= 0) refresh(); } }); });
  return { refresh }; }

/* ---------- C. Venue builder preview: each object extruded by type on the plan's own coordinates ---------- */
function preview(el, objs, dim = { w: 80, d: 60 }) { if (!hasGL()) { el.append(h('<div class="flat"><p class="flat-note" style="position:static">3D preview needs WebGL. The plan view still works.</p></div>')); return; }
  const k = core(el, 80, 260), { scene, camera } = k; const gr = new THREE.Mesh(new THREE.PlaneGeometry(dim.w, dim.d), M(0x0b0b0b, { roughness: 1 })); gr.rotation.x = -Math.PI / 2; scene.add(gr); edges(gr, .4); const gh = new THREE.GridHelper(dim.w, dim.w / 4, 0x2a2a2a, 0x161616); gh.scale.z = dim.d / dim.w; gh.position.y = .02; scene.add(gh);
  objs.forEach((o) => { const w = o.w / 100 * dim.w, d = o.h / 100 * dim.d, x = (o.x + o.w / 2) / 100 * dim.w - dim.w / 2, z = (o.y + o.h / 2) / 100 * dim.d - dim.d / 2;
    const T = { stage: () => box(scene, w, 1.2, d, x, 0, z, { mat: E(W, .12) }), dj: () => box(scene, w, 1.4, d, x, 0, z, { mat: E(W, .4) }), table: () => { cyl(scene, Math.min(w, d) / 2, Math.min(w, d) / 2, .9, x, 0, z, { edged: true, mat: E(o.tier === 'Platinum' ? COOL : WARM, .35) }); },
      stall: () => box(scene, w, 2.6, d, x, 0, z), bar: () => box(scene, w, 1.2, d, x, 0, z, { mat: E(WARM, .3) }), rest: () => box(scene, w, 3, d, x, 0, z), gate: () => { box(scene, .5, 4, d, x - w / 2, 0, z); box(scene, .5, 4, d, x + w / 2, 0, z); box(scene, w, .5, d, x, 4, z, { mat: E(W, .5) }); },
      barrier: () => box(scene, w, 1, Math.max(d, .15), x, 0, z, { plain: true, c: 0x666666 }), tree: () => { cyl(scene, .2, .25, 1.2, x, 0, z, { c: 0x333333 }); cyl(scene, 0, Math.min(w, d) / 2, 3.2, x, 1.2, z, { seg: 10, c: 0x2c2c2c, edged: true }); },
      rig: () => { box(scene, .4, 7, .4, x, 0, z); const c = new THREE.Mesh(new THREE.ConeGeometry(2, 7, 16, 1, true), new THREE.MeshBasicMaterial({ color: W, transparent: true, opacity: .08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); c.position.set(x, 3.5, z); scene.add(c); },
      zone: () => { const m = box(scene, w, .06, d, x, 0, z, { c: 0x141414, edge: .5 }); return m; }, seats: () => box(scene, w, .5, d, x, 0, z, { c: 0x222222 }) };
    (T[o.type] || T.stall)(); });
  const orb = orbit(camera, { th: .5, ph: .6, r: 90, x: 0, y: 0, z: 0 }, { r: [20, 160], ph: [.15, 1.5] });
  pointer(el, k.renderer.domElement, { drag: (dx, dy) => { orb.touch(); orb.goal.th -= dx * .006; orb.goal.ph += dy * .005; }, pinch: (f) => orb.zoom(f) }); k.onFrame((dt) => orb.step(dt)); }

window.V3D = { venue, tables, preview, hasGL, POIS };
})();
