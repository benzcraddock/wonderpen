import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ─── Constants ──────────────────────────────────────────────────────
const MATERIALS = [
  { name: 'Onyx', color: '#1A1A1A', roughness: 0.85, metalness: 0.1 },
  { name: 'Bone', color: '#F0F0F0', roughness: 0.85, metalness: 0.1 },
];

const DARK_BG = '#0A0A0A';
const LIGHT_BG = '#FAFAFA';

// ─── Pen Geometry Builder (Apple Pencil Gen 2 style) ────────────────
function createPenBody(radius, length, segments, flatDepth) {
  // Custom geometry: cylinder with one flat edge, like Apple Pencil Gen 2
  const radialSegs = segments;
  const heightSegs = 1;
  const vertices = [];
  const indices = [];
  const normals = [];
  const uvs = [];

  for (let hy = 0; hy <= heightSegs; hy++) {
    const y = (hy / heightSegs - 0.5) * length;
    for (let i = 0; i <= radialSegs; i++) {
      const angle = (i / radialSegs) * Math.PI * 2;
      let x = Math.cos(angle) * radius;
      let z = Math.sin(angle) * radius;

      // Flatten one side — smooth blend for the flat edge
      if (z < -flatDepth) {
        z = -flatDepth;
      }

      vertices.push(x, y, z);

      // Approximate normals
      const nx = Math.cos(angle);
      const nz = z <= -flatDepth + 0.01 ? -1 : Math.sin(angle);
      const nl = Math.sqrt(nx * nx + nz * nz) || 1;
      normals.push(nx / nl, 0, nz / nl);

      uvs.push(i / radialSegs, hy / heightSegs);
    }
  }

  // Side faces
  const ringCount = radialSegs + 1;
  for (let hy = 0; hy < heightSegs; hy++) {
    for (let i = 0; i < radialSegs; i++) {
      const a = hy * ringCount + i;
      const b = hy * ringCount + i + 1;
      const c = (hy + 1) * ringCount + i + 1;
      const d = (hy + 1) * ringCount + i;
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  // Top and bottom caps
  const addCap = (yPos, flip) => {
    const centerIdx = vertices.length / 3;
    vertices.push(0, yPos, 0);
    normals.push(0, flip ? -1 : 1, 0);
    uvs.push(0.5, 0.5);

    for (let i = 0; i <= radialSegs; i++) {
      const angle = (i / radialSegs) * Math.PI * 2;
      let x = Math.cos(angle) * radius;
      let z = Math.sin(angle) * radius;
      if (z < -flatDepth) z = -flatDepth;
      vertices.push(x, yPos, z);
      normals.push(0, flip ? -1 : 1, 0);
      uvs.push(x / radius * 0.5 + 0.5, z / radius * 0.5 + 0.5);
    }

    for (let i = 0; i < radialSegs; i++) {
      const ci = centerIdx;
      const a = centerIdx + 1 + i;
      const b = centerIdx + 1 + i + 1;
      if (flip) {
        indices.push(ci, b, a);
      } else {
        indices.push(ci, a, b);
      }
    }
  };

  addCap(length / 2, false);   // top cap
  addCap(-length / 2, true);   // bottom cap

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

function createPenTip(bodyRadius, flatDepth) {
  // Apple Pencil Gen 2 style: straight conical taper with a small rounded end
  const tipLength = 10;
  const tipProfile = [];
  const tipSteps = 24;
  const nibRadius = 0.6;

  for (let i = 0; i <= tipSteps; i++) {
    const t = i / tipSteps;
    // Straight linear taper from body radius down to nib
    const r = bodyRadius * (1 - t) + nibRadius * t;
    const y = -t * tipLength;
    tipProfile.push(new THREE.Vector2(r, y));
  }
  // Small rounded nub at the end
  tipProfile.push(new THREE.Vector2(nibRadius * 0.5, -tipLength - 0.3));
  tipProfile.push(new THREE.Vector2(0.001, -tipLength - 0.5));

  const latheGeo = new THREE.LatheGeometry(tipProfile, 48);

  // Flatten the same side as the body
  const pos = latheGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z < -flatDepth) {
      pos.setZ(i, -flatDepth);
    }
  }
  latheGeo.computeVertexNormals();

  return latheGeo;
}

function createPenGroup() {
  const group = new THREE.Group();

  const bodyRadius = 4.5;
  const bodyLength = 170;
  const flatDepth = bodyRadius * 0.72;

  // Main body
  const bodyGeometry = createPenBody(bodyRadius, bodyLength, 48, flatDepth);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: MATERIALS[0].color,
    roughness: 0.85,
    metalness: 0.02,
    envMapIntensity: 0.4,
    side: THREE.DoubleSide,
    clearcoat: 0.15,
    clearcoatRoughness: 0.6,
    sheen: 0.1,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0x222222),
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = 'body';
  group.add(body);

  // Tip
  const tipGeometry = createPenTip(bodyRadius, flatDepth);
  const tipMaterial = new THREE.MeshPhysicalMaterial({
    color: MATERIALS[0].color,
    roughness: 0.85,
    metalness: 0.02,
    envMapIntensity: 0.4,
    side: THREE.DoubleSide,
    clearcoat: 0.15,
    clearcoatRoughness: 0.6,
    sheen: 0.1,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0x222222),
  });
  const tip = new THREE.Mesh(tipGeometry, tipMaterial);
  tip.name = 'tip';
  tip.position.y = -bodyLength / 2;
  group.add(tip);

  // Thin silver band where tip meets body — flush, barely visible
  const seamGeometry = new THREE.TorusGeometry(bodyRadius * 0.97, 0.12, 16, 64);
  // Flatten the same side as the body
  const seamPos = seamGeometry.getAttribute('position');
  for (let i = 0; i < seamPos.count; i++) {
    const y = seamPos.getY(i);
    if (y < -flatDepth) {
      seamPos.setY(i, -flatDepth);
    }
  }
  seamGeometry.computeVertexNormals();

  const seamMaterial = new THREE.MeshStandardMaterial({
    color: '#666670',
    roughness: 0.3,
    metalness: 0.7,
    envMapIntensity: 0.5,
    side: THREE.DoubleSide,
  });
  const seam = new THREE.Mesh(seamGeometry, seamMaterial);
  seam.name = 'seam';
  seam.position.y = -bodyLength / 2;
  seam.rotation.x = Math.PI / 2;
  group.add(seam);

  // Wonderstruck logo branding — SVG drawn onto canvas texture
  const brandCanvas = document.createElement('canvas');
  brandCanvas.width = 512;
  brandCanvas.height = 290;
  const ctx = brandCanvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 290);

  // Draw the Wonderstruck logo SVG paths
  // Scale and center the 61x34 SVG into the canvas
  ctx.save();
  ctx.translate(256 - 61 * 3.5 / 2, 145 - 34 * 3.5 / 2);
  ctx.scale(3.5, 3.5);

  // Logo fill: slightly lighter/darker than base for subtle contrast
  const baseMat = MATERIALS[0];
  const baseColor = new THREE.Color(baseMat.color);
  const luminance = baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
  const logoAlpha = 0.9;
  const logoFill = luminance > 0.5
    ? `rgba(10, 10, 15, ${logoAlpha})`
    : `rgba(200, 200, 215, ${logoAlpha})`;

  ctx.fillStyle = logoFill;

  // Path 1 — W letterform
  const p1 = new Path2D('M35.5312 13.4258C34.4346 14.5864 33.2923 15.8327 32.0996 17.1689C31.1814 18.2009 30.2802 19.1922 29.3965 20.1416L28.3008 16.9443C28.0372 16.1927 27.7743 15.326 27.7383 14.4248H27.5498C27.4743 15.325 27.2116 16.1927 26.9863 16.9443L24.0215 25.5254C20.6867 28.5765 17.5531 30.8078 14.4873 31.9912H10.9863L6.25586 18.125C7.72067 16.2867 9.58894 14.398 11.8203 12.4824C12.3054 12.0627 12.7869 11.6592 13.2646 11.2725L15.8438 20.2891C16.1073 21.2669 16.3701 22.2079 16.3701 23.1475H16.5625C16.638 22.2079 17.0127 21.1915 17.3506 20.2891L22.334 5.88867C23.0395 5.66513 23.7654 5.4636 24.4463 5.28125H32.7119L35.5312 13.4258ZM44.2734 31.9912H33.459L30.2734 22.6982C31.6427 21.3381 33.0411 19.8482 34.4639 18.2217C35.1311 17.4545 35.7824 16.7091 36.418 15.9854L37.9082 20.2891C38.2461 21.1892 38.623 22.2079 38.6963 23.1475H38.8848C38.8848 22.2079 39.1485 21.2669 39.4121 20.2891L42.5723 9.25586C44.0595 7.73316 45.4656 6.40286 46.8125 5.28125H53.3867L44.2734 31.9912ZM12.7158 9.35449C12.0295 9.86065 11.3434 10.4048 10.6641 10.9912C8.55769 12.8318 6.91434 14.6226 5.64258 16.3271L1.875 5.28125H11.5518L12.7158 9.35449ZM44.2676 5.28125C44.0307 5.46298 43.7908 5.64887 43.5498 5.8418L43.7109 5.28125H44.2676Z');
  ctx.fill(p1);

  // Path 2 — swoosh
  const p2 = new Path2D('M26.4613 4.18621C22.7664 4.27512 16.5482 6.39306 10.1069 11.9512C4.95658 16.3796 1.74045 20.6537 0.95866 24.507C0.112664 28.7496 2.14035 31.5585 5.7057 32.2281C13.4233 33.6911 20.9381 27.2619 30.386 16.6451C41.2927 4.42479 47.9368 -0.32088 54.823 0.0167304C56.5443 0.101133 59.1262 0.72121 59.9643 2.73224C60.1389 3.18239 60.1322 4.31788 59.4011 4.28074C59.0541 4.31338 58.9325 3.76645 58.6644 3.21052C57.7361 1.04644 56.0284 0.668318 54.5527 0.595169C48.3074 0.287944 42.1612 6.88034 32.7562 17.7007C22.3046 29.6454 13.2926 34.3235 5.72034 32.9168C1.66497 32.0773 -0.602659 29.1581 0.1397 24.1221C0.711958 20.5052 2.97057 15.6908 8.94774 10.4658C15.7777 4.56996 23.3319 2.96632 27.1857 4.18396');
  ctx.fill(p2);

  ctx.restore();

  const brandTexture = new THREE.CanvasTexture(brandCanvas);
  brandTexture.needsUpdate = true;
  const brandGeometry = new THREE.PlaneGeometry(18, 10);
  const brandMaterial = new THREE.MeshStandardMaterial({
    map: brandTexture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    metalness: 0.9,
    roughness: 0.15,
    envMapIntensity: 1.5,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const brand = new THREE.Mesh(brandGeometry, brandMaterial);
  brand.name = 'brand';
  brand.userData.canvas = brandCanvas;
  brand.userData.texture = brandTexture;
  // Place on the flat surface (the clamped -Z side), logo reads horizontally
  brand.position.set(0, bodyLength / 2 - 12, -(flatDepth + 0.3));
  brand.rotation.z = -Math.PI / 2;
  group.add(brand);

  // Rotate pen to horizontal orientation, flat/logo side facing camera, tip left
  group.rotation.z = -Math.PI / 2;
  group.rotation.x = Math.PI;

  return group;
}

// ─── Update brand logo fill based on pen material ──────────────────
function updateBrandLogo(pen, mat) {
  let brand = null;
  pen.traverse((child) => {
    if (child.name === 'brand') brand = child;
  });
  if (!brand || !brand.userData.canvas || !brand.userData.texture) return;

  const canvas = brand.userData.canvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const baseColor = new THREE.Color(mat.color);
  const luminance = baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
  const logoAlpha = 0.9;
  const logoFill = luminance > 0.5
    ? `rgba(10, 10, 15, ${logoAlpha})`
    : `rgba(200, 200, 215, ${logoAlpha})`;

  ctx.save();
  ctx.translate(256 - 61 * 3.5 / 2, 145 - 34 * 3.5 / 2);
  ctx.scale(3.5, 3.5);
  ctx.fillStyle = logoFill;

  const p1 = new Path2D('M35.5312 13.4258C34.4346 14.5864 33.2923 15.8327 32.0996 17.1689C31.1814 18.2009 30.2802 19.1922 29.3965 20.1416L28.3008 16.9443C28.0372 16.1927 27.7743 15.326 27.7383 14.4248H27.5498C27.4743 15.325 27.2116 16.1927 26.9863 16.9443L24.0215 25.5254C20.6867 28.5765 17.5531 30.8078 14.4873 31.9912H10.9863L6.25586 18.125C7.72067 16.2867 9.58894 14.398 11.8203 12.4824C12.3054 12.0627 12.7869 11.6592 13.2646 11.2725L15.8438 20.2891C16.1073 21.2669 16.3701 22.2079 16.3701 23.1475H16.5625C16.638 22.2079 17.0127 21.1915 17.3506 20.2891L22.334 5.88867C23.0395 5.66513 23.7654 5.4636 24.4463 5.28125H32.7119L35.5312 13.4258ZM44.2734 31.9912H33.459L30.2734 22.6982C31.6427 21.3381 33.0411 19.8482 34.4639 18.2217C35.1311 17.4545 35.7824 16.7091 36.418 15.9854L37.9082 20.2891C38.2461 21.1892 38.623 22.2079 38.6963 23.1475H38.8848C38.8848 22.2079 39.1485 21.2669 39.4121 20.2891L42.5723 9.25586C44.0595 7.73316 45.4656 6.40286 46.8125 5.28125H53.3867L44.2734 31.9912ZM12.7158 9.35449C12.0295 9.86065 11.3434 10.4048 10.6641 10.9912C8.55769 12.8318 6.91434 14.6226 5.64258 16.3271L1.875 5.28125H11.5518L12.7158 9.35449ZM44.2676 5.28125C44.0307 5.46298 43.7908 5.64887 43.5498 5.8418L43.7109 5.28125H44.2676Z');
  ctx.fill(p1);

  const p2 = new Path2D('M26.4613 4.18621C22.7664 4.27512 16.5482 6.39306 10.1069 11.9512C4.95658 16.3796 1.74045 20.6537 0.95866 24.507C0.112664 28.7496 2.14035 31.5585 5.7057 32.2281C13.4233 33.6911 20.9381 27.2619 30.386 16.6451C41.2927 4.42479 47.9368 -0.32088 54.823 0.0167304C56.5443 0.101133 59.1262 0.72121 59.9643 2.73224C60.1389 3.18239 60.1322 4.31788 59.4011 4.28074C59.0541 4.31338 58.9325 3.76645 58.6644 3.21052C57.7361 1.04644 56.0284 0.668318 54.5527 0.595169C48.3074 0.287944 42.1612 6.88034 32.7562 17.7007C22.3046 29.6454 13.2926 34.3235 5.72034 32.9168C1.66497 32.0773 -0.602659 29.1581 0.1397 24.1221C0.711958 20.5052 2.97057 15.6908 8.94774 10.4658C15.7777 4.56996 23.3319 2.96632 27.1857 4.18396');
  ctx.fill(p2);

  ctx.restore();
  brand.userData.texture.needsUpdate = true;
}

// ─── Point-in-Polygon (ray casting) ────────────────────────────────
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > point[1]) !== (yj > point[1])) &&
      (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ─── Path length utility ───────────────────────────────────────────
function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

// ─── Component ──────────────────────────────────────────────────────
export default function WonderPen() {
  const containerRef = useRef(null);
  const canvasOverlayRef = useRef(null);
  const threeCanvasRef = useRef(null);
  const sceneRef = useRef({});
  const scrollStateRef = useRef({ progress: 0 });
  const drawStateRef = useRef({ drawing: false, points: [] });
  const orbScreenPositions = useRef([]);
  const orbButtonRefs = useRef([]);

  const [activeMaterial, setActiveMaterial] = useState(0);
  const [section, setSection] = useState('hero'); // hero | transition | interactive
  const [showHint, setShowHint] = useState(false);
  const [hintFading, setHintFading] = useState(false);
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const [scrollY, setScrollY] = useState(0);

  // ─── Three.js Setup ─────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(LIGHT_BG);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(0, 0, 260);

    // Renderer — high quality
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);
    threeCanvasRef.current = renderer.domElement;

    // Lighting — studio-style 3-point setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambientLight);

    // Key light — warm, slightly above and to the right
    const keyLight = new THREE.DirectionalLight(0xfff8f0, 2.0);
    keyLight.position.set(100, 80, 180);
    scene.add(keyLight);

    // Fill light — cool, opposite side, softer
    const fillLight = new THREE.DirectionalLight(0xe8eeff, 0.6);
    fillLight.position.set(-150, 20, 120);
    scene.add(fillLight);

    // Rim/back light — for edge definition
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.8);
    rimLight.position.set(-30, 40, -200);
    scene.add(rimLight);

    // Top-down soft light to fill the barrel
    const topLight = new THREE.DirectionalLight(0xffffff, 0.3);
    topLight.position.set(0, 200, 0);
    scene.add(topLight);

    // Environment map — richer studio HDRI simulation
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();

    // Gradient background sphere — warm top, cool bottom
    const envGeo = new THREE.SphereGeometry(50, 32, 32);
    const envVertColors = [];
    const envPos = envGeo.getAttribute('position');
    for (let i = 0; i < envPos.count; i++) {
      const y = envPos.getY(i);
      const t = (y / 50 + 1) * 0.5; // 0 at bottom, 1 at top
      // Warm white at top, cool grey at bottom
      const r = 0.75 + t * 0.25;
      const g = 0.73 + t * 0.25;
      const b = 0.72 + t * 0.28;
      envVertColors.push(r, g, b);
    }
    envGeo.setAttribute('color', new THREE.Float32BufferAttribute(envVertColors, 3));
    const envMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    envScene.add(new THREE.Mesh(envGeo, envMat));

    // Softbox-style rectangular lights for studio reflections
    const addSoftbox = (w, h, x, y, z, intensity) => {
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(intensity, intensity, intensity),
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, 0);
      envScene.add(mesh);
    };

    // Large soft key reflection (right)
    addSoftbox(30, 40, 35, 15, -40, 1.0);
    // Smaller fill reflection (left)
    addSoftbox(20, 25, -30, -5, -35, 0.7);
    // Subtle top strip
    addSoftbox(40, 8, 0, 40, -30, 0.5);
    // Rim catch light
    addSoftbox(15, 30, 0, 0, 45, 0.3);

    const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
    scene.environment = envMap;
    pmremGenerator.dispose();

    // No separate contact shadow — handled via CSS

    // Pen — position below headline
    const pen = createPenGroup();
    pen.scale.set(1.125, 1.125, 1.125); // Start zoomed in
    pen.position.y = -20;
    scene.add(pen);

    // Orb group placeholder (no 3D orbs, using UI buttons only)
    const orbGroup = new THREE.Group();
    orbGroup.visible = false;
    const orbs = [];

    // OrbitControls (disabled initially)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI / 2 - THREE.MathUtils.degToRad(25);
    controls.maxPolarAngle = Math.PI / 2 + THREE.MathUtils.degToRad(25);
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.5;
    controls.enabled = false;

    // Store refs
    sceneRef.current = { scene, camera, renderer, pen, controls, orbs, orbGroup, envMap };

    // Hero load-in animation — physics-based drop with bounce
    const startTime = performance.now();
    let heroLoadedFlag = false;
    let heroAnimDone = false;
    const dropStartY = 110;
    const dropEndY = -20;
    const restitution = 0.3;

    let dropY = dropStartY;
    let dropVelocity = 0;
    const gravity = 900;
    let bounceCount = 0;
    let settled = false;
    let impactWobble = 0;
    let wobbleDecay = 0;
    let lastDropTime = startTime;

    pen.position.y = dropStartY;
    pen.scale.set(0.9, 0.9, 0.9);

    const heroAnim = () => {
      const nowMs = performance.now();
      const dt = Math.min((nowMs - lastDropTime) / 1000, 0.033);
      lastDropTime = nowMs;
      const elapsed = (nowMs - startTime) / 1000;

      if (elapsed > 0.5 && !heroLoadedFlag) {
        heroLoadedFlag = true;
        setHeroLoaded(true);
        setTimeout(() => setShowScrollHint(true), 600);
      }

      if (!settled) {
        const substeps = 4;
        const subDt = dt / substeps;
        for (let s = 0; s < substeps && !settled; s++) {
          dropVelocity += gravity * subDt;
          dropY -= dropVelocity * subDt;

          if (dropY <= dropEndY) {
            dropY = dropEndY;
            bounceCount++;

            if (Math.abs(dropVelocity) > 10 && bounceCount < 4) {
              dropVelocity = -dropVelocity * restitution;
              impactWobble = (0.03 / bounceCount) * (Math.random() > 0.5 ? 1 : -1);
              wobbleDecay = 0;
            } else {
              dropVelocity = 0;
              dropY = dropEndY;
              settled = true;
              heroAnimDone = true;
            }
          }
        }

        if (impactWobble !== 0) {
          wobbleDecay += dt * 6;
          const wobble = impactWobble * Math.sin(wobbleDecay * 12) * Math.exp(-wobbleDecay * 3);
          pen.rotation.z = -Math.PI / 2 + wobble;
        }

        pen.position.y = dropY;
        requestAnimationFrame(heroAnim);
      } else {
        pen.position.y = dropEndY;
        pen.rotation.z = -Math.PI / 2;
      }
    };
    requestAnimationFrame(heroAnim);

    // Ambient rotation — eases to pause on hover, supports flick-to-spin
    let heroRotY = 0;
    let returnFromInteractiveTime = 0;
    let lastTime = performance.now();
    let prevProgress = 0;
    let hoveringPen = false;
    let rotationSpeed = 1; // 0 = paused, 1 = full speed
    let angularVelocity = 0; // user-applied spin velocity (rad/s)
    let isDraggingPen = false;
    let lastDragX = 0;
    const dragHistory = []; // track recent drag deltas for smooth release velocity
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onMouseMove = (e) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      if (isDraggingPen) {
        const dx = e.clientX - lastDragX;
        lastDragX = e.clientX;
        // Store recent deltas for averaged release velocity
        dragHistory.push({ dx, t: performance.now() });
        // Keep only last 80ms of history
        const cutoff = performance.now() - 80;
        while (dragHistory.length > 0 && dragHistory[0].t < cutoff) dragHistory.shift();
      }
    };
    renderer.domElement.addEventListener('mousemove', onMouseMove);

    const onMouseDown = (e) => {
      if (hoveringPen && scrollStateRef.current.progress < 0.05) {
        isDraggingPen = true;
        lastDragX = e.clientX;
        renderer.domElement.style.cursor = 'grabbing';
      }
    };
    const onMouseUp = () => {
      if (isDraggingPen) {
        isDraggingPen = false;
        renderer.domElement.style.cursor = hoveringPen ? 'grab' : 'default';
        // Average recent drag deltas for smooth release velocity
        if (dragHistory.length > 1) {
          const totalDx = dragHistory.reduce((sum, d) => sum + d.dx, 0);
          const avgDx = totalDx / dragHistory.length;
          angularVelocity = Math.max(-0.15, Math.min(0.15, avgDx * 0.004)); // capped
        }
        dragHistory.length = 0;
      }
    };
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);

    // Animation loop
    let animFrame;
    const clock = new THREE.Clock();
    const animate = () => {
      animFrame = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const now = performance.now();
      const wallDelta = (now - lastTime) / 1000;
      lastTime = now;

      const progress = scrollStateRef.current.progress;

      if (progress < 1) {
        // Hero / transition state
        controls.enabled = false;
        orbGroup.visible = false;

        // Scroll-driven transforms
        const rotZ = -Math.PI / 2 + THREE.MathUtils.degToRad(15) * progress;
        const scale = 0.9 - 0.13 * progress;
        const yOffset = -20 + 20 * progress;

        pen.rotation.z = rotZ;
        pen.rotation.x = Math.PI;
        if (heroAnimDone) {
          pen.position.y = yOffset;
          pen.scale.set(scale, scale, scale);
        }

        // Ambient rotation only in hero — hover pause + flick-to-spin
        if (progress < 0.05) {
          raycaster.setFromCamera(mouse, camera);
          const intersects = raycaster.intersectObjects(pen.children, true);
          hoveringPen = intersects.length > 0;
          if (!isDraggingPen) {
            renderer.domElement.style.cursor = hoveringPen ? 'grab' : 'default';
          }

          const dt = Math.min(wallDelta, 0.033);
          const timeSinceLoad = (now - startTime) / 1000;
          const rotationDelay = 2.0; // approx drop settle time
          const rotRampUp = Math.max(0, Math.min((timeSinceLoad - rotationDelay) / 0.5, 1));
          // Also ease in after returning from interactive section
          const timeSinceReturn = returnFromInteractiveTime > 0 ? (now - returnFromInteractiveTime) / 1000 : 999;
          const returnRampUp = Math.max(0, Math.min(timeSinceReturn / 1.5, 1));
          const ambientRate = -THREE.MathUtils.degToRad(8.0) * dt * rotRampUp * returnRampUp;

          if (isDraggingPen) {
            // While dragging — directly follow mouse via accumulated deltas
            const totalDx = dragHistory.reduce((sum, d) => sum + d.dx, 0);
            const smoothDx = totalDx / Math.max(dragHistory.length, 1);
            heroRotY += smoothDx * 0.004;
          } else {
            // Frame-rate independent friction: decay per second, not per frame
            const friction = Math.pow(0.3, dt); // ~70% decay per second
            angularVelocity *= friction;

            // Smoothly blend user velocity toward ambient speed
            const ambientVel = hoveringPen ? 0 : ambientRate;
            const blendRate = 1 - Math.pow(0.1, dt); // smooth convergence
            const effectiveVel = angularVelocity + ambientVel;

            // Once user velocity is negligible, fully use ambient
            if (Math.abs(angularVelocity) < 0.0005) {
              angularVelocity = 0;
              const targetSpeed = hoveringPen ? 0 : 1;
              rotationSpeed += (targetSpeed - rotationSpeed) * 0.04;
              heroRotY += ambientRate * rotationSpeed;
            } else {
              heroRotY += effectiveVel;
            }
          }

          pen.rotation.y = heroRotY;
        }

        // When returning from interactive, capture pen rotation and reset controls
        if (prevProgress >= 1 && progress < 1) {
          heroRotY = pen.rotation.y;
          controls.reset();
          returnFromInteractiveTime = now;
        }

        // Always set Y rotation during transition so it doesn't stick at OrbitControls value
        if (progress >= 0.05) {
          pen.rotation.y = heroRotY;
        }

        // Background color lerp — accelerated so grey zone is brief
        const bgProgress = Math.min(progress * 1.5, 1);
        const bgEase = bgProgress * bgProgress;
        const bgColor = new THREE.Color(LIGHT_BG).lerp(new THREE.Color(DARK_BG), bgEase);
        scene.background = bgColor;
      } else {
        // Interactive state
        controls.enabled = true;
        controls.autoRotate = true;
        orbGroup.visible = true;

        // Center pen in viewport for interactive section
        pen.position.y = 0;
        pen.rotation.z = -Math.PI / 2 + THREE.MathUtils.degToRad(15);
        const interactiveScale = 0.77;
        pen.scale.set(interactiveScale, interactiveScale, interactiveScale);

        scene.background = new THREE.Color(DARK_BG);

        // Update orb screen positions from DOM buttons for draw detection
        orbScreenPositions.current = orbButtonRefs.current.map(el => {
          if (!el) return [0, 0];
          const rect = el.getBoundingClientRect();
          return [rect.left + rect.width / 2, rect.top + rect.height / 2];
        });

      }

      prevProgress = progress;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animFrame);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // ─── Scroll Handler ─────────────────────────────────────────────
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const pinHeight = window.innerHeight * 1.5;

      // Progress 0–1 over the pin distance
      const progress = Math.min(Math.max(scrollY / pinHeight, 0), 1);
      scrollStateRef.current.progress = progress;
      setScrollY(progress);

      // Check if scrolled past interactive into CTA
      const interactiveEnd = window.innerHeight * 3.5;
      // Track progress within interactive section (0-1)
      const interactiveStart = pinHeight;
      const interactiveProgress = Math.min(Math.max((scrollY - interactiveStart) / (interactiveEnd - interactiveStart), 0), 1);
      scrollStateRef.current.interactiveProgress = interactiveProgress;

      if (progress < 0.01) {
        setSection('hero');
      } else if (progress < 1) {
        setSection('transition');
      } else if (scrollY < interactiveEnd) {
        setSection('interactive');
      } else {
        setSection('cta');
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // ─── Show hint on entering interactive section ──────────────────
  useEffect(() => {
    if (section === 'interactive' && !showHint) {
      setShowHint(true);
      setTimeout(() => setHintFading(true), 3000);
      setTimeout(() => {
        setShowHint(false);
        setHintFading(false);
      }, 4000);
    }
  }, [section]);

  // ─── Material Switching ─────────────────────────────────────────
  const switchMaterial = useCallback((index) => {
    if (index === activeMaterial) return;
    setActiveMaterial(index);

    const { pen, orbs } = sceneRef.current;
    if (!pen) return;

    const mat = MATERIALS[index];
    const targetColor = new THREE.Color(mat.color);

    // Update logo immediately
    updateBrandLogo(pen, mat);

    // Animate material transition + shimmer
    const startTime = performance.now();
    const duration = 600;

    // Get current colors from pen parts
    const parts = [];
    pen.traverse((child) => {
      if (child.isMesh && child.name !== 'seam' && child.name !== 'brand') {
        parts.push({
          mesh: child,
          startColor: child.material.color.clone(),
          startRoughness: child.material.roughness,
          startMetalness: child.material.metalness,
        });
      }
    });

    const animateSwitch = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      // ease-in-out
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      parts.forEach(({ mesh, startColor, startRoughness, startMetalness }) => {
        mesh.material.color.copy(startColor).lerp(targetColor, ease);
        mesh.material.roughness = startRoughness + (mat.roughness - startRoughness) * ease;
        mesh.material.metalness = startMetalness + (mat.metalness - startMetalness) * ease;

        // Shimmer effect: pulse emissive
        const shimmer = Math.sin(t * Math.PI) * 0.4;
        mesh.material.emissive = new THREE.Color(0xffffff);
        mesh.material.emissiveIntensity = shimmer;
      });

      if (t < 1) {
        requestAnimationFrame(animateSwitch);
      } else {
        parts.forEach(({ mesh }) => {
          mesh.material.emissiveIntensity = 0;
        });
      }
    };
    requestAnimationFrame(animateSwitch);
  }, [activeMaterial]);

  // ─── Draw-to-Select Canvas ─────────────────────────────────────
  useEffect(() => {
    const canvas = canvasOverlayRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e) => {
      if (section !== 'interactive') return;
      // Check if we're clicking on an orb position (fallback click-to-select)
      const orbPositions = orbScreenPositions.current;
      for (let i = 0; i < orbPositions.length; i++) {
        const [ox, oy] = orbPositions[i];
        const dx = e.clientX - ox;
        const dy = e.clientY - oy;
        if (Math.sqrt(dx * dx + dy * dy) < 40) {
          switchMaterial(i);
          return;
        }
      }

      smoothX = e.clientX;
      smoothY = e.clientY;
      initialized = true;
      // Start a new stroke without clearing previous ones
      if (!drawStateRef.current.strokes) drawStateRef.current.strokes = [];
      drawStateRef.current.drawing = true;
      drawStateRef.current.currentStroke = [[e.clientX, e.clientY, performance.now(), 0.5]];
      drawStateRef.current.points = drawStateRef.current.currentStroke;
      lastVelX = e.clientX;
      lastVelY = e.clientY;
    };

    // Smoothed cursor position for laggy feel
    let smoothX = 0, smoothY = 0, initialized = false;
    let lastVelX = 0, lastVelY = 0;
    let smoothPressure = 0.5;

    const onPointerMove = (e) => {
      // Check if hovering near a selector — change cursor
      const orbPositions = orbScreenPositions.current;
      let nearOrb = false;
      for (let i = 0; i < orbPositions.length; i++) {
        const [ox, oy] = orbPositions[i];
        const dx = e.clientX - ox;
        const dy = e.clientY - oy;
        if (Math.sqrt(dx * dx + dy * dy) < 40) {
          nearOrb = true;
          break;
        }
      }
      canvas.style.cursor = nearOrb ? 'pointer' : 'crosshair';

      if (!drawStateRef.current.drawing) return;

      // Lerp toward cursor for smooth, slightly laggy feel
      if (!initialized) {
        smoothX = e.clientX;
        smoothY = e.clientY;
        initialized = true;
      }
      const lerp = 0.3;
      smoothX += (e.clientX - smoothX) * lerp;
      smoothY += (e.clientY - smoothY) * lerp;

      // Pressure: use pen pressure if available, otherwise derive from speed
      let pressure;
      if (e.pressure > 0 && e.pressure < 1 && e.pointerType !== 'mouse') {
        pressure = e.pressure;
      } else {
        // Velocity-based: slower = more pressure, faster = lighter
        const dx = e.clientX - lastVelX;
        const dy = e.clientY - lastVelY;
        const speed = Math.sqrt(dx * dx + dy * dy);
        pressure = Math.max(0.15, Math.min(1, 1 - speed / 80));
        lastVelX = e.clientX;
        lastVelY = e.clientY;
      }
      // Smooth the pressure to avoid jitter
      smoothPressure += (pressure - smoothPressure) * 0.2;

      const now = performance.now();
      drawStateRef.current.currentStroke.push([smoothX, smoothY, now, smoothPressure]);

      // Rendering handled by redrawTrail loop
    };

    // Continuous redraw for all strokes with fading
    let drawAnimFrame;
    const fadeDuration = 2000; // 2 seconds before fully faded

    const drawStroke = (stroke, now) => {
      const points = stroke.points || stroke;
      const matColor = stroke.color || MATERIALS[activeMaterial].color;
      if (points.length < 2) return;

      // Fade whole stroke based on when drawing stopped (last point age)
      const last = points[points.length - 1];
      const age = now - last[2];
      const alpha = Math.max(0, 1 - age / fadeDuration);
      if (alpha <= 0) return;

      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);

      for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i][0] + points[i + 1][0]) / 2;
        const midY = (points[i][1] + points[i + 1][1]) / 2;
        ctx.quadraticCurveTo(points[i][0], points[i][1], midX, midY);
      }
      ctx.lineTo(last[0], last[1]);

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = matColor;
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    };

    const redrawTrail = () => {
      drawAnimFrame = requestAnimationFrame(redrawTrail);
      if (!drawStateRef.current.strokes) drawStateRef.current.strokes = [];

      const strokes = drawStateRef.current.strokes;
      const currentStroke = drawStateRef.current.currentStroke;
      const now = performance.now();

      // Remove fully faded strokes (all points expired)
      while (strokes.length > 0) {
        const s = strokes[0];
        const pts = s.points || s;
        if (pts.length === 0 || (now - pts[pts.length - 1][2]) > fadeDuration) {
          strokes.shift();
        } else {
          break;
        }
      }

      const hasContent = strokes.length > 0 || (currentStroke && currentStroke.length >= 2);
      if (!hasContent) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw completed strokes
      for (const stroke of strokes) {
        drawStroke(stroke, now);
      }

      // Draw current active stroke
      if (currentStroke && currentStroke.length >= 2) {
        drawStroke(currentStroke, now);
      }

      ctx.globalAlpha = 1;
    };
    drawAnimFrame = requestAnimationFrame(redrawTrail);

    const onPointerUp = () => {
      if (!drawStateRef.current.drawing) return;
      drawStateRef.current.drawing = false;

      const currentStroke = drawStateRef.current.currentStroke;
      if (!currentStroke || currentStroke.length < 3 || pathLength(currentStroke) < 15) {
        drawStateRef.current.currentStroke = null;
        return;
      }

      // Save completed stroke with its color
      if (!drawStateRef.current.strokes) drawStateRef.current.strokes = [];
      drawStateRef.current.strokes.push({
        points: [...currentStroke],
        color: MATERIALS[activeMaterial].color,
      });

      // Check for selection
      if (currentStroke.length >= 10 && pathLength(currentStroke) >= 100) {
        const orbPositions = orbScreenPositions.current;
        let selected = -1;
        for (let i = 0; i < orbPositions.length; i++) {
          if (pointInPolygon(orbPositions[i], currentStroke)) {
            selected = i;
            break;
          }
        }
        if (selected >= 0) {
          switchMaterial(selected);
        }
      }

      drawStateRef.current.currentStroke = null;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);

    return () => {
      cancelAnimationFrame(drawAnimFrame);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerUp);
    };
  }, [section, activeMaterial, switchMaterial]);

  // ─── Computed styles ────────────────────────────────────────────
  const scrollProgress = scrollY;
  const isInteractive = section === 'interactive';
  const isCta = section === 'cta';
  const heroOpacity = section === 'hero' ? 1 : Math.max(0, 1 - scrollProgress * 5);
  const interactiveOpacity = isInteractive ? 1 : Math.max(0, (scrollProgress - 0.85) * 6.67);
  // Nav color transition — only changes once fully in interactive/dark
  const navProgress = isInteractive || isCta ? 1 : Math.min(Math.max((scrollProgress - 0.85) * 6.67, 0), 1);

  return (
    <div style={{ position: 'relative' }}>
      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 40px',
        background: isInteractive || isCta ? 'rgba(10, 10, 10, 0.6)' : 'transparent',
        backdropFilter: isInteractive || isCta ? 'blur(20px)' : 'none',
        WebkitBackdropFilter: isInteractive || isCta ? 'blur(20px)' : 'none',
        transition: isInteractive || isCta ? 'background 0.6s ease' : 'background 0s',
      }}>
        <svg width="61" height="34" viewBox="0 0 61 34" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M35.5312 13.4258C34.4346 14.5864 33.2923 15.8327 32.0996 17.1689C31.1814 18.2009 30.2802 19.1922 29.3965 20.1416L28.3008 16.9443C28.0372 16.1927 27.7743 15.326 27.7383 14.4248H27.5498C27.4743 15.325 27.2116 16.1927 26.9863 16.9443L24.0215 25.5254C20.6867 28.5765 17.5531 30.8078 14.4873 31.9912H10.9863L6.25586 18.125C7.72067 16.2867 9.58894 14.398 11.8203 12.4824C12.3054 12.0627 12.7869 11.6592 13.2646 11.2725L15.8438 20.2891C16.1073 21.2669 16.3701 22.2079 16.3701 23.1475H16.5625C16.638 22.2079 17.0127 21.1915 17.3506 20.2891L22.334 5.88867C23.0395 5.66513 23.7654 5.4636 24.4463 5.28125H32.7119L35.5312 13.4258ZM44.2734 31.9912H33.459L30.2734 22.6982C31.6427 21.3381 33.0411 19.8482 34.4639 18.2217C35.1311 17.4545 35.7824 16.7091 36.418 15.9854L37.9082 20.2891C38.2461 21.1892 38.623 22.2079 38.6963 23.1475H38.8848C38.8848 22.2079 39.1485 21.2669 39.4121 20.2891L42.5723 9.25586C44.0595 7.73316 45.4656 6.40286 46.8125 5.28125H53.3867L44.2734 31.9912ZM12.7158 9.35449C12.0295 9.86065 11.3434 10.4048 10.6641 10.9912C8.55769 12.8318 6.91434 14.6226 5.64258 16.3271L1.875 5.28125H11.5518L12.7158 9.35449ZM44.2676 5.28125C44.0307 5.46298 43.7908 5.64887 43.5498 5.8418L43.7109 5.28125H44.2676Z" fill={`rgb(${Math.round(10 + 240 * navProgress)}, ${Math.round(10 + 240 * navProgress)}, ${Math.round(10 + 240 * navProgress)})`} />
          <path d="M26.4613 4.18621C22.7664 4.27512 16.5482 6.39306 10.1069 11.9512C4.95658 16.3796 1.74045 20.6537 0.95866 24.507C0.112664 28.7496 2.14035 31.5585 5.7057 32.2281C13.4233 33.6911 20.9381 27.2619 30.386 16.6451C41.2927 4.42479 47.9368 -0.32088 54.823 0.0167304C56.5443 0.101133 59.1262 0.72121 59.9643 2.73224C60.1389 3.18239 60.1322 4.31788 59.4011 4.28074C59.0541 4.31338 58.9325 3.76645 58.6644 3.21052C57.7361 1.04644 56.0284 0.668318 54.5527 0.595169C48.3074 0.287944 42.1612 6.88034 32.7562 17.7007C22.3046 29.6454 13.2926 34.3235 5.72034 32.9168C1.66497 32.0773 -0.602659 29.1581 0.1397 24.1221C0.711958 20.5052 2.97057 15.6908 8.94774 10.4658C15.7777 4.56996 23.3319 2.96632 27.1857 4.18396" fill={`rgb(${Math.round(10 + 240 * navProgress)}, ${Math.round(10 + 240 * navProgress)}, ${Math.round(10 + 240 * navProgress)})`} />
        </svg>
        <div style={{
          fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
          fontWeight: 500,
          fontSize: '14px',
          letterSpacing: '1px',
          color: `rgb(${Math.round(102 + 51 * navProgress)}, ${Math.round(102 + 51 * navProgress)}, ${Math.round(102 + 51 * navProgress)})`,
        }}>
          WonderPen by Ben
        </div>
      </nav>

      {/* Three.js Container (pinned) */}
      <div
        ref={containerRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 1,
          pointerEvents: isCta ? 'none' : 'auto',
        }}
      />

      {/* Draw Canvas Overlay */}
      <canvas
        ref={canvasOverlayRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: isInteractive ? 200 : -1,
          pointerEvents: isInteractive ? 'auto' : 'none',
          cursor: isInteractive ? 'crosshair' : 'default',
        }}
      />

      {/* Hero Content Overlay */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        alignItems: 'center',
        paddingTop: '18vh',
        zIndex: 5,
        pointerEvents: 'none',
        opacity: heroOpacity,
        transition: 'opacity 0.1s linear',
      }}>
        <h1 style={{
          fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
          fontSize: 'clamp(48px, 8vw, 96px)',
          fontWeight: 500,
          color: '#0A0A0A',
          letterSpacing: '-2px',
          marginBottom: '12px',
          opacity: heroLoaded ? 1 : 0,
          transform: heroLoaded ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
        }}>
          Designed to design.
        </h1>
        <p style={{
          fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
          fontSize: '18px',
          fontWeight: 400,
          color: '#666',
          letterSpacing: '3px',
          textTransform: 'uppercase',
          opacity: heroLoaded ? 1 : 0,
          transition: 'opacity 0.6s ease-out 0.2s',
        }}>
          From the team at Wonderstruck Studio
        </p>
      </div>

      {/* Scroll Indicator */}
      <div style={{
        position: 'fixed',
        bottom: '40px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 5,
        opacity: showScrollHint ? Math.max(0, 1 - scrollProgress * 3) : 0,
        transition: 'opacity 1s ease-out',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span style={{
          fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
          fontSize: '13px',
          fontWeight: 500,
          letterSpacing: '4px',
          textTransform: 'uppercase',
          color: '#777',
        }}>Scroll to draw</span>
        <div style={{
          width: '2px',
          height: '40px',
          borderRadius: '1px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: `${Math.min(scrollProgress * 5, 1) * 100}%`,
            background: 'linear-gradient(to bottom, #888, #555)',
            borderRadius: '1px',
            transition: 'height 0.05s linear',
          }} />
        </div>
      </div>

      {/* Interactive Section UI */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 5,
        pointerEvents: 'none',
        opacity: interactiveOpacity,
        transition: 'opacity 0.6s ease-out',
      }}>
        {/* Section Title */}
        <div style={{
          position: 'absolute',
          top: '12vh',
          width: '100%',
          textAlign: 'center',
        }}>
          <h2 style={{
            fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
            fontSize: 'clamp(36px, 5vw, 56px)',
            fontWeight: 500,
            color: '#FAFAFA',
            letterSpacing: '-1px',
          }}>
            Make it yours.
          </h2>
        </div>

        {/* Material Orbs Labels */}
        <div style={{
          position: 'absolute',
          bottom: '10vh',
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          gap: '60px',
        }}>
          {MATERIALS.map((mat, i) => (
            <button
              key={mat.name}
              ref={el => orbButtonRefs.current[i] = el}
              onClick={() => switchMaterial(i)}
              style={{
                pointerEvents: isInteractive ? 'auto' : 'none',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                padding: '8px',
              }}
            >
              {/* Orb preview */}
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: mat.color,
                border: i === activeMaterial
                  ? '2px solid rgba(255,255,255,0.5)'
                  : '2px solid rgba(255,255,255,0.1)',
                boxShadow: 'none',
                transition: 'border 0.3s ease',
              }} />
              <span style={{
                fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
                fontSize: '13px',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                color: i === activeMaterial ? '#FAFAFA' : '#666',
                transition: 'color 0.3s ease',
              }}>
                {mat.name}
              </span>
            </button>
          ))}
        </div>

        {/* Hint Animation */}
        {showHint && (
          <div style={{
            position: 'absolute',
            bottom: 'calc(10vh + 120px)',
            width: '100%',
            textAlign: 'center',
            opacity: hintFading ? 0 : 1,
            transition: 'opacity 1s ease-out',
          }}>
            <p style={{
              fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
              fontSize: '13px',
              color: '#666',
              letterSpacing: '1px',
            }}>
              Circle your style
            </p>
          </div>
        )}
      </div>

      {/* Spacer for scroll distance — hero transition + interactive section */}
      <div style={{ height: '400vh', position: 'relative', zIndex: 0, pointerEvents: 'none' }} />

      {/* CTA Section */}
      <div style={{
        position: 'relative',
        zIndex: 20,
        background: DARK_BG,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '40px',
        textAlign: 'center',
      }}>
        <h2 style={{
          fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
          fontSize: 'clamp(32px, 5vw, 56px)',
          fontWeight: 500,
          color: '#FAFAFA',
          letterSpacing: '-1px',
          marginBottom: '16px',
        }}>
          Build something delightful.
        </h2>
        <p style={{
          fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
          fontSize: '16px',
          color: '#666',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          marginBottom: '40px',
        }}>
          Coming soon. Be the first to know.
        </p>
        <button
          style={{
            fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
            fontSize: '14px',
            fontWeight: 500,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: '#FAFAFA',
            background: 'transparent',
            border: '1px solid rgba(250, 250, 250, 0.3)',
            padding: '16px 40px',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
          }}
          onMouseEnter={(e) => {
            e.target.style.background = '#FAFAFA';
            e.target.style.color = '#0A0A0A';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = 'transparent';
            e.target.style.color = '#FAFAFA';
          }}
        >
          Pre-order WonderPen
        </button>
      </div>

      {/* Footer */}
      <footer style={{
        position: 'relative',
        zIndex: 20,
        background: DARK_BG,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '40px',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
          fontWeight: 700,
          fontSize: '12px',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          color: '#444',
          marginBottom: '16px',
        }}>
          Wonderstruck Studio
        </div>
        <p style={{
          fontFamily: "'PP Neue Montreal', 'Inter', sans-serif",
          fontSize: '12px',
          color: '#333',
          marginBottom: '12px',
        }}>
          &copy; 2026 Wonderstruck Studio. All rights reserved.
        </p>
      </footer>

      {/* CSS Animations */}
      <style>{`
        @keyframes drawLine {
          0% { opacity: 0; transform: scaleY(0); transform-origin: top; }
          20% { opacity: 1; transform: scaleY(1); transform-origin: top; }
          60% { opacity: 1; transform: scaleY(1); transform-origin: top; }
          80% { opacity: 0; transform: scaleY(1); transform-origin: top; }
          100% { opacity: 0; transform: scaleY(0); transform-origin: top; }
        }
      `}</style>
    </div>
  );
}
