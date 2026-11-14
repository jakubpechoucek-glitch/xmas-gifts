// 3D Christmas scene (three.js): snowy low-poly tree, fairy lights, gold garland, glass baubles,
// 3D star topper, Filipino parol lanterns, gifts with bows, GPU snow, bloom.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import gsap from "gsap";

// ----------------------------------------------------------------------------- helpers
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function radialTexture(stops, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function starShape(R, r, n = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < n * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / n;
    const rad = i % 2 ? r : R;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function groundH(x, z) {
  const d = Math.hypot(x, z);
  const hills = 3.2 + 2.2 * Math.sin(x * 0.16 + 1.0) * Math.cos(z * 0.13) + 1.4 * Math.sin(x * 0.31 + z * 0.27);
  return smooth(11, 36, d) * hills;
}

const TIERS = [
  { y: 1.0, h: 2.7, r: 3.1 },
  { y: 2.4, h: 2.5, r: 2.65 },
  { y: 3.7, h: 2.3, r: 2.2 },
  { y: 4.9, h: 2.1, r: 1.75 },
  { y: 6.0, h: 1.9, r: 1.3 },
  { y: 7.0, h: 1.8, r: 0.9 },
];
const TREE_TOP = 8.8;

function treeRadiusAt(y) {
  let r = 0;
  for (const t of TIERS) if (y >= t.y && y <= t.y + t.h) r = Math.max(r, t.r * (1 - (y - t.y) / t.h));
  return r;
}

// a cone whose lower rim is scalloped and drooping, like fir branches
function branchCone(r, h, seg, phase, droop = 0.42, lobes = 9) {
  const g = new THREE.ConeGeometry(r, h, seg, 3, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (y + h / 2) / h; // 0 bottom .. 1 top
    const ang = Math.atan2(z, x);
    const wave = Math.sin(ang * lobes + phase) * 0.5 + 0.5;
    const low = (1 - t) * (1 - t);
    const k = 1 + (1 - t) * 0.09 * (wave - 0.5) * 2;
    p.setX(i, x * k);
    p.setZ(i, z * k);
    p.setY(i, y - low * droop * wave);
  }
  g.computeVertexNormals();
  return g;
}

// ----------------------------------------------------------------------------- shaders
const SNOW_VS = /* glsl */ `
  uniform float uTime; uniform float uPR; attribute vec4 aSeed; varying float vA;
  void main(){
    vec3 p = position;
    float H = 16.0;
    p.y = mod(p.y - uTime * (0.45 + aSeed.x * 0.9), H);
    p.x += sin(uTime * 0.4 + aSeed.y * 6.283) * 0.6;
    p.z += cos(uTime * 0.33 + aSeed.z * 6.283) * 0.6;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (0.8 + aSeed.w * 1.7) * uPR * (26.0 / -mv.z);
    vA = 0.4 + 0.55 * aSeed.w;
    gl_Position = projectionMatrix * mv;
  }`;
const SNOW_FS = /* glsl */ `
  varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d) * vA;
    gl_FragColor = vec4(vec3(0.92, 0.95, 1.0), a);
  }`;

const GLOW_VS = /* glsl */ `
  uniform float uTime; uniform float uPR; uniform float uBase;
  attribute float aPhase; attribute float aSize; attribute vec3 aColor; varying vec3 vC; varying float vA;
  void main(){
    vC = aColor;
    float tw = 0.55 + 0.45 * sin(uTime * 2.2 + aPhase * 6.283);
    vA = tw;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uBase * uPR * (30.0 / -mv.z) * (0.8 + 0.35 * tw);
    gl_Position = projectionMatrix * mv;
  }`;
const GLOW_FS = /* glsl */ `
  varying vec3 vC; varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = pow(smoothstep(0.5, 0.0, d), 1.7);
    gl_FragColor = vec4(vC * (1.0 + a * 1.2), a * vA);
  }`;

const SPARK_VS = /* glsl */ `
  uniform float uPR; attribute float aSize; attribute float aAlpha; attribute vec3 aColor; varying vec3 vC; varying float vA;
  void main(){
    vC = aColor; vA = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPR * (30.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const STAR_VS = /* glsl */ `
  uniform float uTime; uniform float uPR; attribute float aSize; attribute float aPhase; varying float vA;
  void main(){
    vA = 0.45 + 0.55 * sin(uTime * (0.6 + aPhase) + aPhase * 40.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPR;
    gl_Position = projectionMatrix * mv;
  }`;
const STAR_FS = /* glsl */ `
  varying float vA;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vA;
    gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), a);
  }`;

// ----------------------------------------------------------------------------- gift layout
const LAYOUT = {
  me: { x: 0.15, z: 4.7, w: 1.55, h: 1.45, d: 1.55, ry: -0.1, color: "#f2b01e", ribbon: "#c62828" },
  g0: { x: -3.35, z: 3.3, w: 1.15, h: 1.05, d: 1.15, ry: 0.5, color: "#d62839", ribbon: "#ffe08a" },
  g1: { x: -1.85, z: 4.5, w: 0.95, h: 0.85, d: 0.95, ry: -0.3, color: "#2f7fe0", ribbon: "#ffffff" },
  g2: { x: 2.1, z: 4.45, w: 1.0, h: 0.95, d: 1.0, ry: 0.35, color: "#2fa35b", ribbon: "#ffe08a" },
  g3: { x: 3.5, z: 3.1, w: 1.2, h: 1.1, d: 1.2, ry: -0.55, color: "#9b3fd0", ribbon: "#ffe08a" },
};
const DECOR = [
  { x: -4.3, z: 1.2, w: 1.0, h: 0.8, d: 1.0, ry: 0.9, color: "#1e9aa8", ribbon: "#ffffff" },
  { x: 4.4, z: 0.8, w: 0.9, h: 1.2, d: 0.9, ry: -0.4, color: "#e8e8f0", ribbon: "#d62839" },
  { x: -2.6, z: -3.4, w: 1.1, h: 0.9, d: 1.1, ry: 0.2, color: "#d62839", ribbon: "#ffe08a" },
  { x: 2.9, z: -3.0, w: 0.9, h: 0.8, d: 0.9, ry: -0.6, color: "#2f7fe0", ribbon: "#ffe08a" },
];

// ----------------------------------------------------------------------------- scene
export function createScene(canvas, { gifts, name, quality = "auto", reduceMotion = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x10154a, 22, 70);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const target = new THREE.Vector3(0, 4.3, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;

  // ---- lights (night: cool and dim, with warm light from the tree itself)
  scene.add(new THREE.HemisphereLight(0x6f80e0, 0x141c3c, 0.34));
  const moonLight = new THREE.DirectionalLight(0xaebfff, 0.95);
  moonLight.position.set(-12, 16, 8);
  scene.add(moonLight);
  const rim = new THREE.DirectionalLight(0xffa56b, 0.3);
  rim.position.set(10, 6, -10);
  scene.add(rim);
  const treeGlow = new THREE.PointLight(0xffb45a, 17, 13, 1.4);
  treeGlow.position.set(0, 3.4, 7.0);
  scene.add(treeGlow);

  // ---- sky, stars, moon
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color("#060822") }, mid: { value: new THREE.Color("#161b5c") }, bot: { value: new THREE.Color("#5b4b9c") } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(bot, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.18, 0.8, h)); gl_FragColor = vec4(c, 1.0); }",
    })
  );
  scene.add(sky);

  const rnd = mulberry32(1224);
  const starsN = 650;
  const sp = new Float32Array(starsN * 3), ss = new Float32Array(starsN), sph = new Float32Array(starsN);
  for (let i = 0; i < starsN; i++) {
    const u = rnd() * Math.PI * 2, y = 0.12 + 0.88 * rnd(), r = Math.sqrt(1 - y * y), R = 80;
    sp[i * 3] = Math.cos(u) * r * R; sp[i * 3 + 1] = y * R; sp[i * 3 + 2] = -Math.abs(Math.sin(u)) * r * R - 5;
    ss[i] = 1.2 + rnd() * 2.4; sph[i] = rnd();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute("aSize", new THREE.BufferAttribute(ss, 1));
  starGeo.setAttribute("aPhase", new THREE.BufferAttribute(sph, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPR: { value: 1 } }, vertexShader: STAR_VS, fragmentShader: STAR_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const skyStars = new THREE.Points(starGeo, starMat);
  skyStars.frustumCulled = false;
  scene.add(skyStars);

  const moon = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }));
  moon.position.set(-14, 15, -62);
  scene.add(moon);
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, "rgba(255,244,214,0.55)"], [0.35, "rgba(190,205,255,0.18)"], [1, "rgba(120,140,255,0)"]], 256),
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true,
  }));
  moonGlow.scale.set(40, 40, 1);
  moonGlow.position.copy(moon.position);
  scene.add(moonGlow);

  // ---- ground and background pines
  const gGeo = new THREE.PlaneGeometry(100, 100, 100, 100);
  gGeo.rotateX(-Math.PI / 2);
  {
    const p = gGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, groundH(p.getX(i), p.getZ(i)));
    gGeo.computeVertexNormals();
  }
  const ground = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ color: 0x8c9bd2, roughness: 0.95, metalness: 0 }));
  scene.add(ground);

  {
    const N = 64;
    const dummy = new THREE.Object3D();
    const lower = new THREE.InstancedMesh(new THREE.ConeGeometry(1.2, 2.6, 7), new THREE.MeshStandardMaterial({ color: 0x14402c, roughness: 0.9, flatShading: true }), N);
    const upper = new THREE.InstancedMesh(new THREE.ConeGeometry(0.85, 2.2, 7), new THREE.MeshStandardMaterial({ color: 0x1b5438, roughness: 0.9, flatShading: true }), N);
    const cap = new THREE.InstancedMesh(new THREE.ConeGeometry(0.4, 0.9, 7), new THREE.MeshStandardMaterial({ color: 0xc9d4f2, roughness: 0.9, flatShading: true }), N);
    const r2 = mulberry32(77);
    for (let i = 0; i < N; i++) {
      let x, z;
      do {
        if (i < 46) { x = (r2() * 2 - 1) * 32; z = -(10 + r2() * 24); }
        else { x = (r2() < 0.5 ? -1 : 1) * (12 + r2() * 12); z = -10 + r2() * 9; }
      } while (Math.abs(x) < 4 && z > -16); // keep the sky behind the tree clear
      const s = 0.95 + r2() * 1.0, y = groundH(x, z);
      dummy.rotation.set(0, r2() * 6, 0);
      dummy.scale.setScalar(s);
      dummy.position.set(x, y + 1.3 * s, z); dummy.updateMatrix(); lower.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, y + 2.7 * s, z); dummy.updateMatrix(); upper.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, y + 4.0 * s, z); dummy.updateMatrix(); cap.setMatrixAt(i, dummy.matrix);
    }
    scene.add(lower, upper, cap);
  }

  // ---- the tree
  const tree = new THREE.Group();
  scene.add(tree);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.6, 12), new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9 }));
  trunk.position.y = 0.7;
  tree.add(trunk);

  const needleCols = ["#0f5230", "#145f38", "#186c3e", "#1c7a45", "#208a4c", "#259653"];
  const capMat = new THREE.MeshStandardMaterial({ color: 0xe3ebff, roughness: 0.85, flatShading: true, side: THREE.DoubleSide });
  TIERS.forEach((t, i) => {
    const mat = new THREE.MeshStandardMaterial({ color: needleCols[i], roughness: 0.8, flatShading: true, side: THREE.DoubleSide });
    const cone = new THREE.Mesh(branchCone(t.r, t.h, 30, i * 1.3), mat);
    cone.position.y = t.y + t.h / 2;
    tree.add(cone);
    const capH = t.h * 0.46;
    const cap = new THREE.Mesh(branchCone(t.r * 0.46 * 1.045, capH, 30, i * 1.3 + 0.6, 0.3, 8), capMat);
    cap.position.y = t.y + t.h - capH / 2 + 0.01;
    tree.add(cap);
  });

  // fairy lights along a spiral
  {
    const N = 190;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
    const pal = ["#fff1b8", "#ffd15c", "#ff7a7a", "#8ad1ff", "#ffb3ec", "#b9ff9b"].map((c) => new THREE.Color(c));
    const r3 = mulberry32(5);
    for (let i = 0; i < N; i++) {
      const s = i / N, y = 1.5 + s * 6.9, a = s * 8.5 * Math.PI * 2 + r3() * 0.3;
      const r = treeRadiusAt(y) * 1.0 + 0.12;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y + Math.sin(a * 5) * 0.14; pos[i * 3 + 2] = Math.sin(a) * r;
      const c = pal[i % pal.length];
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      size[i] = 3.0 + r3() * 2.0; ph[i] = r3();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(ph, 1));
    var lightsMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPR: { value: 1 }, uBase: { value: 1 } }, vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, lightsMat);
    pts.frustumCulled = false;
    tree.add(pts);
  }

  // gold garland
  {
    const pts = [];
    const turns = 6.2;
    for (let i = 0; i <= 260; i++) {
      const s = i / 260, y = 1.35 + s * 6.6, a = s * turns * Math.PI * 2 + 0.7;
      const r = treeRadiusAt(y) + 0.07;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y - 0.2 * (0.5 - 0.5 * Math.cos(a * 4)), Math.sin(a) * r));
    }
    const garland = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 520, 0.042, 6, false),
      new THREE.MeshStandardMaterial({ color: 0xf0c04a, metalness: 0.95, roughness: 0.28, emissive: 0x6a4300, emissiveIntensity: 0.5 })
    );
    tree.add(garland);
  }

  // glass baubles
  {
    const N = 30;
    const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 18), new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.16 }), N);
    const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.35, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xf0c04a, metalness: 0.95, roughness: 0.3 }), N);
    const pal = ["#d62839", "#f6bd16", "#3a86ff", "#ff5d8f", "#cfd3e0", "#4bd37b", "#b04ee0"].map((c) => new THREE.Color(c));
    const r4 = mulberry32(31), d = new THREE.Object3D();
    for (let i = 0; i < N; i++) {
      const y = 1.7 + r4() * 5.8, a = r4() * Math.PI * 2, rad = 0.13 + r4() * 0.1;
      const r = treeRadiusAt(y) * 0.97 + 0.1 + rad;
      d.position.set(Math.cos(a) * r, y - rad - 0.15, Math.sin(a) * r);
      d.scale.setScalar(rad); d.rotation.set(0, 0, 0); d.updateMatrix(); balls.setMatrixAt(i, d.matrix); balls.setColorAt(i, pal[i % pal.length]);
      d.position.y += rad * 1.0; d.scale.setScalar(rad * 0.9); d.updateMatrix(); caps.setMatrixAt(i, d.matrix);
    }
    balls.instanceColor.needsUpdate = true;
    tree.add(balls, caps);
  }

  // ---- star topper
  const starGroup = new THREE.Group();
  starGroup.position.set(0, TREE_TOP + 0.35, 0);
  starGroup.userData.id = "star";
  const starGeoX = new THREE.ExtrudeGeometry(starShape(0.78, 0.34), { depth: 0.22, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 2 });
  starGeoX.center();
  const starMesh = new THREE.Mesh(starGeoX, new THREE.MeshStandardMaterial({ color: 0xffd45a, emissive: 0xffa400, emissiveIntensity: 1.1, metalness: 0.5, roughness: 0.3 }));
  starGroup.add(starMesh);
  const starHit = new THREE.Mesh(new THREE.SphereGeometry(1.25, 8, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  starGroup.add(starHit);
  const starLight = new THREE.PointLight(0xffd27a, 14, 8, 1.8);
  starGroup.add(starLight);
  const starGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, "rgba(255,230,150,0.95)"], [0.3, "rgba(255,190,80,0.35)"], [1, "rgba(255,160,40,0)"]], 256),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  starGlow.scale.set(4.2, 4.2, 1);
  starGroup.add(starGlow);
  scene.add(starGroup);

  // ---- parol lanterns
  const parols = [];
  function buildParol(x, yStar, scale, phase) {
    const yTop = 15;
    const pivot = new THREE.Group();
    pivot.position.set(x, yTop, -0.2);
    const body = new THREE.Group();
    body.position.y = yStar - yTop;
    body.scale.setScalar(scale);
    pivot.add(body);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, yTop - yStar, 4), new THREE.MeshBasicMaterial({ color: 0xcfd6ff, transparent: true, opacity: 0.55 }));
    rope.position.y = (yStar - yTop) / 2 + (yTop - yStar) / 2 - 0; // centre between pivot and body top
    rope.position.y = -((yTop - yStar) / 2);
    pivot.add(rope);
    const g1 = new THREE.ExtrudeGeometry(starShape(0.95, 0.43), { depth: 0.3, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 });
    g1.center();
    body.add(new THREE.Mesh(g1, new THREE.MeshStandardMaterial({ color: 0xff9b1f, emissive: 0xff5a00, emissiveIntensity: 1.35, roughness: 0.5 })));
    const g2 = new THREE.ExtrudeGeometry(starShape(0.58, 0.26), { depth: 0.1, bevelEnabled: false });
    g2.center();
    const inner = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({ color: 0xfff1b0 }));
    inner.position.z = 0.22;
    body.add(inner);
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0xff5a00, emissiveIntensity: 1.1, roughness: 0.6 });
    [[-0.56, -0.78, 0.9], [0.56, -0.78, 0.9], [0, -1.1, 1.3]].forEach(([tx, ty, len]) => {
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.11, len, 6), tailMat);
      tail.rotation.z = Math.PI; // wide end up
      tail.position.set(tx, ty - len / 2 + 0.1, 0);
      body.add(tail);
    });
    const light = new THREE.PointLight(0xff9a3d, 7, 8, 1.6);
    body.add(light);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture([[0, "rgba(255,200,110,0.8)"], [0.4, "rgba(255,130,40,0.25)"], [1, "rgba(255,100,20,0)"]], 256),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    glow.scale.set(3.6 * scale, 3.6 * scale, 1);
    body.add(glow);
    pivot.userData.baseX = x;
    scene.add(pivot);
    parols.push({ pivot, phase, light });
  }
  buildParol(-4.5, 6.9, 0.95, 0.0);
  buildParol(4.7, 5.5, 0.8, 1.7);
  buildParol(-7.6, 9.3, 0.62, 3.1);

  // ---- gifts
  const pickables = [];
  const layoutRoots = [];
  const giftMap = {};
  const glowTex = radialTexture([[0, "rgba(255,225,140,1)"], [0.45, "rgba(255,190,80,0.45)"], [1, "rgba(255,160,40,0)"]], 128);

  function tagTexture(text) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#fff8e6";
    g.beginPath(); g.roundRect(8, 8, 496, 240, 34); g.fill();
    g.strokeStyle = "#d9a431"; g.lineWidth = 10; g.stroke();
    g.fillStyle = "#b71c1c";
    let size = 110;
    g.font = `italic 700 ${size}px Georgia, "Times New Roman", serif`;
    while (g.measureText(text).width > 420 && size > 34) { size -= 6; g.font = `italic 700 ${size}px Georgia, "Times New Roman", serif`; }
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 256, 140);
    g.fillStyle = "#d9a431"; g.font = "36px system-ui, sans-serif"; g.fillText("★", 256, 52);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  function buildGift(id, o, { clickable, tag }) {
    const { x, z, w, h, d, ry, color, ribbon } = o;
    const root = new THREE.Group();
    root.position.set(x, groundH(x, z), z);
    root.rotation.y = ry;
    root.userData.baseX = x;
    layoutRoots.push(root);
    const inner = new THREE.Group();
    root.add(inner);
    const bodyH = h * 0.78, lidH = h * 0.22;
    const gold = ribbon === "#ffe08a";
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.08 });
    const rib = new THREE.MeshStandardMaterial({ color: ribbon, roughness: 0.32, metalness: gold ? 0.6 : 0.1, emissive: ribbon, emissiveIntensity: 0.08 });

    const body = new THREE.Mesh(new RoundedBoxGeometry(w, bodyH, d, 3, 0.05), mat);
    body.position.y = bodyH / 2;
    const rv = new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, bodyH + 0.004, d + 0.014), rib); rv.position.y = bodyH / 2;
    const rh = new THREE.Mesh(new THREE.BoxGeometry(w + 0.014, bodyH + 0.004, d * 0.16), rib); rh.position.y = bodyH / 2;
    inner.add(body, rv, rh);

    const lid = new THREE.Group();
    lid.position.y = bodyH + lidH / 2;
    const lm = new THREE.Mesh(new RoundedBoxGeometry(w + 0.12, lidH, d + 0.12, 3, 0.04), mat);
    const lv = new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, lidH + 0.004, d + 0.134), rib);
    const lh = new THREE.Mesh(new THREE.BoxGeometry(w + 0.134, lidH + 0.004, d * 0.16), rib);
    lid.add(lm, lv, lh);
    const bw = Math.min(w, d) * 0.27;
    const loopGeo = new THREE.TorusGeometry(bw, bw * 0.3, 8, 22);
    [[-1, 0.6], [1, -0.6]].forEach(([sx, rz]) => {
      const loop = new THREE.Mesh(loopGeo, rib);
      loop.position.set(sx * bw * 0.95, lidH / 2 + bw * 0.78, 0);
      loop.rotation.z = rz; loop.scale.set(1, 1, 0.65);
      lid.add(loop);
    });
    const knot = new THREE.Mesh(new THREE.SphereGeometry(bw * 0.42, 12, 10), rib);
    knot.position.y = lidH / 2 + bw * 0.3;
    lid.add(knot);
    inner.add(lid);

    // glow that appears when opened
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.1, d * 1.1), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = bodyH + 0.02;
    inner.add(glow);
    const beam = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.scale.set(w * 2.6, h * 3.2, 1); beam.position.y = bodyH + h * 0.9;
    inner.add(beam);
    const light = new THREE.PointLight(0xffd27a, 0, 7, 1.7);
    light.position.y = bodyH + 0.5;
    inner.add(light);

    let halo = null;
    if (tag) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.82, w * 0.41), new THREE.MeshBasicMaterial({ map: tagTexture(tag), transparent: true, toneMapped: false, color: 0xe8e8e8 }));
      t.position.set(0, bodyH * 0.5, d / 2 + 0.014);
      inner.add(t);
    }
    if (clickable) {
      halo = new THREE.Mesh(new THREE.PlaneGeometry(w * 3.4, d * 3.4), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.rotation.x = -Math.PI / 2; halo.position.y = 0.03;
      root.add(halo);
      root.userData.id = id;
      // glow planes, halo, beam and tag are decoration: they must never steal clicks from neighbours
      root.traverse((o) => { if (o.material && o.material.blending === THREE.AdditiveBlending) o.raycast = () => {}; });
      if (glow) glow.raycast = () => {};
      if (beam) beam.raycast = () => {};
      pickables.push(root);
    }
    scene.add(root);
    const obj = { id, root, inner, lid, glow, beam, light, halo, w, h, d, bodyH, opened: false, nudge: { v: 0 }, nudgeTween: null, lidHome: lid.position.clone(), clickable };
    return obj;
  }

  Object.entries(LAYOUT).forEach(([id, o]) => {
    if (id !== "me" && !gifts[Number(id.slice(1))]) return; // fewer gifts configured than slots
    giftMap[id] = buildGift(id, o, { clickable: true, tag: id === "me" ? name : null });
  });
  DECOR.forEach((o, i) => buildGift("decor" + i, o, { clickable: false, tag: null }));

  pickables.push(starGroup);

  // ---- snow
  const snowMax = 2200;
  const snowGeo = new THREE.BufferGeometry();
  {
    const p = new Float32Array(snowMax * 3), s = new Float32Array(snowMax * 4), r5 = mulberry32(9);
    for (let i = 0; i < snowMax; i++) {
      p[i * 3] = (r5() * 2 - 1) * 18; p[i * 3 + 1] = r5() * 16; p[i * 3 + 2] = -16 + r5() * 30;
      s[i * 4] = r5(); s[i * 4 + 1] = r5(); s[i * 4 + 2] = r5(); s[i * 4 + 3] = r5();
    }
    snowGeo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    snowGeo.setAttribute("aSeed", new THREE.BufferAttribute(s, 4));
  }
  const snowMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uPR: { value: 1 } }, vertexShader: SNOW_VS, fragmentShader: SNOW_FS, transparent: true, depthWrite: false });
  const snow = new THREE.Points(snowGeo, snowMat);
  snow.frustumCulled = false;
  scene.add(snow);

  // ---- sparks (open bursts)
  const SMAX = 520;
  const sPos = new Float32Array(SMAX * 3), sCol = new Float32Array(SMAX * 3), sSize = new Float32Array(SMAX), sAlpha = new Float32Array(SMAX);
  const sVel = new Float32Array(SMAX * 3), sLife = new Float32Array(SMAX), sMaxLife = new Float32Array(SMAX), sBase = new Float32Array(SMAX);
  const sparkGeo = new THREE.BufferGeometry();
  const sPosA = new THREE.BufferAttribute(sPos, 3), sColA = new THREE.BufferAttribute(sCol, 3), sSizeA = new THREE.BufferAttribute(sSize, 1), sAlphaA = new THREE.BufferAttribute(sAlpha, 1);
  sparkGeo.setAttribute("position", sPosA); sparkGeo.setAttribute("aColor", sColA); sparkGeo.setAttribute("aSize", sSizeA); sparkGeo.setAttribute("aAlpha", sAlphaA);
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: { uPR: { value: 1 } }, vertexShader: SPARK_VS,
    fragmentShader: "varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = pow(smoothstep(0.5, 0.0, d), 1.5) * vA; gl_FragColor = vec4(vC * 1.6, a); }",
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkCursor = 0, sparksActive = 0;
  const sparkPal = ["#ffe08a", "#ffd15c", "#ff9bd5", "#9bd9ff", "#ffffff", "#b9ff9b"].map((c) => new THREE.Color(c));
  function spawnSparks(p, n, speed, up = 2) {
    const count = reduceMotion ? Math.ceil(n / 4) : n;
    for (let k = 0; k < count; k++) {
      const i = sparkCursor++ % SMAX;
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.1, sp2 = speed * (0.4 + Math.random() * 0.8);
      sPos[i * 3] = p.x; sPos[i * 3 + 1] = p.y; sPos[i * 3 + 2] = p.z;
      sVel[i * 3] = Math.cos(a) * Math.cos(e) * sp2; sVel[i * 3 + 1] = Math.sin(e + 0.3) * sp2 + up; sVel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * sp2;
      const c = sparkPal[(Math.random() * sparkPal.length) | 0];
      sCol[i * 3] = c.r; sCol[i * 3 + 1] = c.g; sCol[i * 3 + 2] = c.b;
      sBase[i] = 5 + Math.random() * 7; sSize[i] = sBase[i];
      sMaxLife[i] = sLife[i] = 0.9 + Math.random() * 1.1; sAlpha[i] = 1;
    }
    sparksActive = SMAX;
  }
  function updateSparks(dt) {
    if (!sparksActive) return;
    let any = false;
    for (let i = 0; i < SMAX; i++) {
      if (sLife[i] <= 0) { sAlpha[i] = 0; continue; }
      any = true;
      sLife[i] -= dt;
      sVel[i * 3 + 1] -= 4.2 * dt;
      sPos[i * 3] += sVel[i * 3] * dt; sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt; sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
      const k = Math.max(0, sLife[i] / sMaxLife[i]);
      sAlpha[i] = k; sSize[i] = sBase[i] * (0.4 + 0.6 * k);
    }
    sPosA.needsUpdate = sAlphaA.needsUpdate = sSizeA.needsUpdate = sColA.needsUpdate = true;
    if (!any) sparksActive = 0;
  }

  // ---- controls and camera
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.45;
  controls.minAzimuthAngle = -0.7; controls.maxAzimuthAngle = 0.7;
  controls.minPolarAngle = 1.12; controls.maxPolarAngle = 1.55;

  let viewDist = 20;
  function fitCamera(w, h) {
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 0.8 ? 38 : 34;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // on narrow screens the gifts and parols are moved closer to the tree so it can stay big
    const k = aspect < 0.7 ? 0.74 : aspect < 1 ? 0.86 : 1;
    layoutRoots.forEach((r) => { r.position.x = r.userData.baseX * k; });
    parols.forEach((p) => { p.pivot.position.x = p.pivot.userData.baseX * k; });
    const needV = 7.3 / tanHalf;                    // tree + gifts, vertically
    const needH = 4.3 / (tanHalf * aspect);         // gift ring, horizontally
    viewDist = Math.max(needV, needH);
    const mx = Math.min(24, 85 * tanHalf * aspect * 0.55);
    moon.position.x = -mx; moonGlow.position.x = -mx;
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.42, 1);
    dir.normalize().multiplyScalar(viewDist);
    camera.position.copy(controls.target).add(dir);
    camera.updateProjectionMatrix();
  }
  {
    // start slightly above the ground, looking at the middle of the tree
    const sph = new THREE.Spherical(20, 1.32, 0);
    camera.position.setFromSpherical(sph).add(controls.target);
  }

  // ---- post-processing
  let composer = null, bloom = null, useBloom = quality !== "low";
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  function buildComposer(w, h) {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.5, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  let W = 1, H = 1;
  function resize() {
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(W, H, false);
    if (composer) { composer.setPixelRatio(pixelRatio); composer.setSize(W, H); }
    fitCamera(W, H);
    starMat.uniforms.uPR.value = pixelRatio;
    snowMat.uniforms.uPR.value = pixelRatio;
    sparkMat.uniforms.uPR.value = pixelRatio;
    lightsMat.uniforms.uPR.value = pixelRatio;
  }
  if (useBloom) buildComposer(1, 1);
  resize();
  window.addEventListener("resize", resize);

  function setLowQuality() {
    useBloom = false;
    pixelRatio = 1;
    snowGeo.setDrawRange(0, 700);
    resize();
  }
  if (quality === "low") setLowQuality();
  else snowGeo.setDrawRange(0, reduceMotion ? 500 : 1900);

  // ---- interaction
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pickCb = null;
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.id) o = o.parent;
      if (o) return o.userData.id;
    }
    return null;
  }
  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener("pointerup", (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
    down = null;
    if (moved > 10 || dt > 700) return;
    const id = pick(e.clientX, e.clientY);
    if (id && pickCb) pickCb(id);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    canvas.style.cursor = pick(e.clientX, e.clientY) ? "pointer" : "grab";
  });

  // ---- state driven by the app
  let starMode = "locked";
  const tmp = new THREE.Vector3();

  function applyOpenedLook(g) {
    g.opened = true;
    g.lid.position.set(g.lidHome.x + g.w * 0.55, g.lidHome.y + g.h * 0.9, g.lidHome.z);
    g.lid.rotation.z = -0.55;
    g.glow.material.opacity = 0.7;
    g.beam.material.opacity = 0.35;
    g.light.intensity = 3;
    if (g.halo) g.halo.material.opacity = 0;
  }

  function worldTop(g) { return tmp.set(0, g.h * 1.1, 0).applyMatrix4(g.root.matrixWorld).clone(); }

  const api = {
    onPick(cb) { pickCb = cb; },
    setOpened(ids) { ids.forEach((id) => giftMap[id] && applyOpenedLook(giftMap[id])); },
    openGift(id) {
      const g = giftMap[id];
      if (!g || g.opened) return Promise.resolve();
      g.opened = true;
      api.nudge(id, false);
      return new Promise((resolve) => {
        const tl = gsap.timeline({ onComplete: resolve });
        if (!reduceMotion) tl.to(g.root.rotation, { z: 0.1, duration: 0.06, repeat: 7, yoyo: true, ease: "sine.inOut" }).set(g.root.rotation, { z: 0 });
        tl.call(() => {
          g.root.updateMatrixWorld(true);
          const top = worldTop(g);
          spawnSparks(top, id === "me" ? 190 : 120, 3.6, 2.4);
          g.light.intensity = 16;
          gsap.to(g.light, { intensity: 3, duration: 1.4, ease: "power2.out" });
        });
        tl.to(g.lid.position, { x: g.lidHome.x + g.w * 0.55, y: g.lidHome.y + g.h * 0.9, duration: 0.55, ease: "back.out(1.7)" }, "<");
        tl.to(g.lid.rotation, { z: -0.55, duration: 0.55, ease: "power2.out" }, "<");
        tl.to(g.glow.material, { opacity: 0.7, duration: 0.5 }, "<");
        tl.to(g.beam.material, { opacity: 0.35, duration: 0.6 }, "<");
        if (g.halo) tl.to(g.halo.material, { opacity: 0, duration: 0.4 }, "<");
      });
    },
    nudge(id, on) {
      const g = giftMap[id];
      if (!g) return;
      if (g.nudgeTween) { g.nudgeTween.kill(); g.nudgeTween = null; }
      if (on && !reduceMotion) g.nudgeTween = gsap.to(g.nudge, { v: 0.4, duration: 0.3, yoyo: true, repeat: -1, repeatDelay: 0.35, ease: "power2.out" });
      else gsap.to(g.nudge, { v: 0, duration: 0.2 });
    },
    setStarMode(m) { starMode = m; },
    starBurst() {
      starGroup.updateMatrixWorld(true);
      const p = new THREE.Vector3().setFromMatrixPosition(starGroup.matrixWorld);
      spawnSparks(p, 320, 5.5, 0.5);
      starLight.intensity = 40;
      gsap.to(starLight, { intensity: 16, duration: 1.8, ease: "power2.out" });
    },
    screenPos(id) {
      const v = new THREE.Vector3();
      if (id === "star") { starGroup.updateMatrixWorld(true); v.setFromMatrixPosition(starGroup.matrixWorld); }
      else { const g = giftMap[id]; if (!g) return null; g.root.updateMatrixWorld(true); v.copy(worldTop(g)); }
      v.project(camera);
      const r = canvas.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    },
    setQuality(q) { if (q === "low") setLowQuality(); },
    get usingBloom() { return useBloom; },
  };

  // ---- loop
  let raf = 0, frames = 0, acc = 0, judged = quality !== "auto";
  let last = performance.now(), t = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const nowMs = performance.now();
    const dt = Math.min((nowMs - last) / 1000, 0.1);
    last = nowMs;
    t += dt;

    starMat.uniforms.uTime.value = t;
    snowMat.uniforms.uTime.value = reduceMotion ? 0 : t;
    lightsMat.uniforms.uTime.value = t;

    // star
    const ready = starMode === "ready";
    starGroup.rotation.y = Math.sin(t * 0.8) * 0.5;
    const pulse = ready ? 1 + 0.16 * Math.sin(t * 5) : 1 + 0.03 * Math.sin(t * 1.6);
    starGroup.scale.setScalar(pulse);
    starMesh.material.emissiveIntensity = ready ? 1.8 + 0.8 * Math.sin(t * 5) : starMode === "claimed" ? 1.5 : 1.0 + 0.2 * Math.sin(t * 1.6);
    starGlow.material.opacity = ready ? 1 : 0.8;
    if (ready && Math.random() < 0.08) {
      starGroup.updateMatrixWorld(true);
      spawnSparks(new THREE.Vector3().setFromMatrixPosition(starGroup.matrixWorld), 3, 1.2, 0.8);
    }

    // parols
    if (!reduceMotion) parols.forEach((p) => { p.pivot.rotation.z = Math.sin(t * 0.8 + p.phase) * 0.06; p.pivot.rotation.x = Math.sin(t * 0.6 + p.phase * 1.7) * 0.03; });
    parols.forEach((p) => { p.light.intensity = 6.5 + Math.sin(t * 3 + p.phase) * 1.1; });

    // gifts: gentle bob for the unopened personal gift, halo pulse, opened glow breathing
    Object.values(giftMap).forEach((g) => {
      const base = g.id === "me" && !g.opened && !reduceMotion ? 0.06 + 0.05 * Math.sin(t * 2) : 0;
      g.inner.position.y = base + g.nudge.v;
      if (g.halo && !g.opened) g.halo.material.opacity = g.id === "me" ? 0.3 + 0.15 * Math.sin(t * 2.2) : 0;
      if (g.opened) g.beam.material.opacity = 0.3 + 0.07 * Math.sin(t * 2 + g.w * 3);
    });

    treeGlow.intensity = 17 + Math.sin(t * 1.3) * 1.5;
    updateSparks(dt);
    controls.update();
    if (useBloom && composer) composer.render(); else renderer.render(scene, camera);

    // adaptive quality: judge frame time over frames 25..115
    if (!judged) {
      frames++;
      if (frames > 25) acc += dt;
      if (frames === 115) {
        judged = true;
        if (acc / 90 > 0.034) setLowQuality();
      }
    }
  }

  // one synchronous render so shader/WebGL problems surface immediately
  if (useBloom && composer) composer.render(); else renderer.render(scene, camera);
  frame();

  api.dispose = () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); renderer.dispose(); };
  return api;
}
