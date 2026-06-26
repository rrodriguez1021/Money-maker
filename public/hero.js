// Qrysm hero — a holographic, iridescent QR code rendered in true 3D with three.js.
// Type a URL and it re-forges live; the code floats, refracts light (prism = the brand),
// and parallaxes to your cursor. Falls back gracefully and respects reduced-motion.
import * as THREE from 'three';

const canvas = document.getElementById('forge-canvas');
if (canvas) init();

function init() {
  const wrap = canvas.parentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, 7);

  // Prismatic environment so the metal/iridescent material has colour to refract.
  scene.environment = (() => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.0, '#070a1f');
    g.addColorStop(0.4, '#3b1d6e');
    g.addColorStop(0.7, '#7c3aed');
    g.addColorStop(1.0, '#22d3ee');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 256);
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  scene.add(new THREE.AmbientLight(0x6a6ea0, 1.4));
  const l1 = new THREE.PointLight(0x36e0ff, 140, 60); l1.position.set(5, 4, 6); scene.add(l1);
  const l2 = new THREE.PointLight(0xd44bff, 140, 60); l2.position.set(-5, -3, 4); scene.add(l2);
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(2, 3, 5); scene.add(key);

  const group = new THREE.Group(); scene.add(group);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x2a2f6e, metalness: 0.9, roughness: 0.2,
    iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [120, 560],
    emissive: 0x140a3a, emissiveIntensity: 0.6,
    envMapIntensity: 2.0, clearcoat: 1, clearcoatRoughness: 0.18,
  });

  const dummy = new THREE.Object3D();
  let mesh = null, gridSize = 0, step = 0, depths = [], assemble = 0;

  function build(matrix) {
    if (mesh) { group.remove(mesh); mesh.geometry.dispose(); mesh.dispose?.(); }
    gridSize = matrix.size;
    const idx = [];
    for (let i = 0; i < matrix.data.length; i++) if (matrix.data[i]) idx.push(i);
    step = 4.4 / gridSize;
    mesh = new THREE.InstancedMesh(geo, mat, idx.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.idx = idx;
    // A gentle dome of depth from the center — the "4D" lift.
    depths = idx.map((i) => {
      const x = i % gridSize, y = (i / gridSize) | 0;
      const dx = x / gridSize - 0.5, dy = y / gridSize - 0.5;
      return (0.5 - Math.hypot(dx, dy)) * step * 3.2;
    });
    group.add(mesh);
    assemble = 0;
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function layout(progress) {
    if (!mesh) return;
    const idx = mesh.userData.idx, n = idx.length;
    for (let k = 0; k < n; k++) {
      const i = idx[k], x = i % gridSize, y = (i / gridSize) | 0;
      const px = (x - gridSize / 2 + 0.5) * step;
      const py = (gridSize / 2 - y - 0.5) * step;
      const local = Math.min(1, Math.max(0, progress * 1.7 - (k / n) * 0.7));
      const s = easeOut(local);
      const sc = 0.9 * step * s + 0.0001;
      dummy.position.set(px, py, depths[k] * s);
      dummy.scale.set(sc, sc, sc * 1.7 + 0.0001);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Pointer parallax.
  const pointer = { x: 0, y: 0 }, rot = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => {
    const r = wrap.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
  });

  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight || 420;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(wrap); resize();

  const clock = new THREE.Clock();
  function tick() {
    const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
    if (assemble < 1) { assemble = Math.min(1, assemble + dt * 0.8); layout(assemble); }
    const spin = reduced ? 0 : t * 0.22;
    rot.y += ((pointer.x * 0.6 + spin) - rot.y) * 0.06;
    rot.x += ((-pointer.y * 0.4) - rot.x) * 0.06;
    group.rotation.set(rot.x, rot.y, 0);
    if (!reduced) { l1.position.x = Math.sin(t * 0.6) * 6; l2.position.y = Math.cos(t * 0.5) * 5; }
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  let deb;
  async function forge(text) {
    try {
      const r = await fetch('/api/demo-qr?text=' + encodeURIComponent(text || 'https://qrysm.app'));
      const m = await r.json();
      if (m && m.size) build(m);
    } catch { /* keep last */ }
  }
  const input = document.getElementById('forge-input');
  if (input) input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => forge(input.value.trim()), 220); });

  forge(input ? input.value.trim() : 'https://qrysm.app').then(tick);
}
