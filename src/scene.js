import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';

export const COACHES = [
  { id: 'scania', name: 'Scania Touring', descriptor: 'Standard coach · reference geometry', len: 13.5, height: 3.65, axles: 2, decks: 1 },
  { id: 'volvo', name: 'Volvo 9700 DD', descriptor: 'Double-decker · reference geometry', len: 14.4, height: 4.2, axles: 3, decks: 2 },
  { id: 'man', name: "MAN Lion’s Coach", descriptor: 'Touring coach · reference geometry', len: 13.35, height: 3.75, axles: 3, decks: 1 }
];
const n = (x, min, max) => Math.min(max, Math.max(min, x));

function readDDS(bytes) {
  if (bytes.length < 128) throw new Error('ไฟล์ DDS ไม่สมบูรณ์');
  const header = new DataView(bytes.buffer);
  if (header.getUint32(84, true) === 0x30315844) {
    if (bytes.length < 148) throw new Error('ไฟล์ DDS ไม่สมบูรณ์');
    const format = header.getUint32(128, true);
    const fourCC = { 71: 'DXT1', 72: 'DXT1', 74: 'DXT3', 75: 'DXT3', 77: 'DXT5', 78: 'DXT5' }[format];
    if (!fourCC || header.getUint32(132, true) !== 3 ||
        header.getUint32(136, true) & 4 || header.getUint32(140, true) !== 1) {
      throw new Error('โปรแกรมรองรับ DDS แบบ BC1, BC2 และ BC3 สำหรับลายรถ');
    }
    const legacy = new Uint8Array(bytes.length - 20);
    legacy.set(bytes.subarray(0, 128));
    legacy.set(new TextEncoder().encode(fourCC), 84);
    legacy.set(bytes.subarray(148), 128);
    bytes = legacy;
  }
  const data = new DDSLoader().parse(bytes.buffer, true);
  if (!data.width || !data.height || !data.mipmaps.length || data.isCubemap) {
    throw new Error('เปิดภาพ DDS นี้ในพรีวิวไม่ได้');
  }
  const texture = new THREE.CompressedTexture(data.mipmaps, data.width, data.height, data.format);
  if (data.mipmapCount === 1) texture.minFilter = THREE.LinearFilter;
  return texture;
}

function glassMask(profile, width, height) {
  const mask = document.createElement('canvas');
  mask.width = width; mask.height = height;
  const draw = mask.getContext('2d');
  draw.beginPath();
  for (let index = 0; index < profile.uv.length; index += 6) {
    draw.moveTo(profile.uv[index] * width, profile.uv[index + 1] * height);
    draw.lineTo(profile.uv[index + 2] * width, profile.uv[index + 3] * height);
    draw.lineTo(profile.uv[index + 4] * width, profile.uv[index + 5] * height);
    draw.closePath();
  }
  draw.fill();
  return mask;
}

function bitmapPNG(file) {
  return createImageBitmap(new Blob([Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))], { type: 'image/png' }));
}

// A full-frame window design may cross the sill. Paint the portion outside
// the window islands onto the body, using the same normalized atlas coordinates.
export async function bodyArtwork(body, glass, profile) {
  const images = [];
  try {
    images.push(await bitmapPNG(body));
    images.push(await bitmapPNG(glass));
    const [base, overlay] = images;
    for (const image of images) {
      if (![4096,8192].includes(image.width) || image.height*2 !== image.width) throw new Error('ใช้ PNG ตัวถังและกระจกแบบเฟรมเต็ม 4K หรือ 8K');
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(base.width, overlay.width);
    canvas.height = canvas.width/2;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(base,0,0,canvas.width,canvas.height);
    const spill = document.createElement('canvas');
    spill.width = canvas.width; spill.height = canvas.height;
    const draw = spill.getContext('2d');
    draw.drawImage(overlay,0,0,spill.width,spill.height);
    draw.globalCompositeOperation='destination-out';
    draw.drawImage(glassMask(profile,spill.width,spill.height),0,0);
    ctx.drawImage(spill,0,0);
    return canvas.toDataURL('image/png');
  } finally { for (const image of images) image.close(); }
}

export async function windowArtwork(file, profile, legacyScania = false) {
  const source = await bitmapPNG(file);
  try {
    const canvas = document.createElement('canvas');
    const fullFrame = [4096, 8192].includes(source.width) && source.height * 2 === source.width;
    canvas.width = fullFrame ? source.width : profile.width;
    canvas.height = fullFrame ? source.height : profile.height;
    const context = canvas.getContext('2d');
    if (fullFrame) {
      context.drawImage(source, 0, 0);
    } else if (legacyScania && source.width === source.height * 4) {
      const sides = [
        {uScale: .05138158, uOffset: .32312149, vScale: .1024625, vOffset: -.00507171},
        {uScale: .05145338, uOffset: .32334534, vScale: -.10246321, vOffset: 1.00640998}
      ];
      for (const [index, side] of sides.entries()) {
        const sign = index === 0 ? 1 : -1;
        const center = index === 0 ? 6.2 / 14 : 1 - 6.2 / 14;
        const verticalCenter = index / 2 + 3.55 / 3.1;
        const xScale = 14 * side.uScale / sign * canvas.width;
        const yScale = -3.1 * side.vScale * canvas.height;
        context.save();
        context.beginPath();
        context.rect(0, index === 0 ? 0 : canvas.height / 2, canvas.width, canvas.height / 2);
        context.clip();
        context.setTransform(xScale / source.width, 0, 0, yScale / source.height,
          side.uOffset * canvas.width - xScale * center, side.vOffset * canvas.height - yScale * verticalCenter);
        context.drawImage(source, 0, 0);
        context.restore();
      }
    } else {
      throw new Error('ใช้ PNG เฟรมเต็ม 4096 × 2048 หรือ 8192 × 4096 ตามผังกระจกรุ่นที่เลือก');
    }
    const mask = glassMask(profile, canvas.width, canvas.height);
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(mask, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    source.close();
  }
}
const mat = (color, metalness = .1, roughness = .52, opacity = 1) => new THREE.MeshStandardMaterial({ color, metalness, roughness, transparent: opacity < 1, opacity });

function demoTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 2048, 0);
  grad.addColorStop(0, '#ebf0f5');
  grad.addColorStop(.56, '#f9fbff');
  grad.addColorStop(1, '#e4ebf1');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 2048, 512);
  ctx.fillStyle = '#171e2b'; ctx.beginPath(); ctx.moveTo(0, 365); ctx.lineTo(2048, 280); ctx.lineTo(2048, 510); ctx.lineTo(0, 510); ctx.fill();
  ctx.fillStyle = '#6c8ba7'; ctx.beginPath(); ctx.moveTo(110, 360); ctx.lineTo(2048, 245); ctx.lineTo(2048, 295); ctx.lineTo(110, 412); ctx.fill();
  ctx.fillStyle = '#233144'; ctx.font = '700 105px Arial, sans-serif'; ctx.fillText('COACHES', 520, 235);
  ctx.fillStyle = '#63748b'; ctx.font = '600 33px Arial, sans-serif'; ctx.fillText('SKIN STUDIO · DEMO LIVERY', 540, 293);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export class CoachViewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(32, 1, .08, 350);
    this.camera.position.set(18, 10, 19);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = .065;
    this.controls.rotateSpeed = .72; this.controls.zoomSpeed = .88; this.controls.panSpeed = .8;
    this.controls.maxPolarAngle = Math.PI/2 - .035;
    this.controls.minDistance = 6; this.controls.maxDistance = 55;
    this.controls.target.set(0, 2, 0);
    this.cameraAnim = null;
    this.modelRevealAnim = null;
    this.glbBufferCache = new Map();
    this.controls.addEventListener('start', () => { this.cameraAnim = null; });
    this.ambient = new THREE.HemisphereLight('#ffffff', '#c5ccd6', 2.1); this.scene.add(this.ambient);
    const key = new THREE.DirectionalLight('#ffffff', 2.95); key.position.set(-8, 16, 9); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -22; key.shadow.camera.right = 22; key.shadow.camera.top = 22; key.shadow.camera.bottom = -22; key.shadow.normalBias = .03;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#dce8f8', 1.15); fill.position.set(10, 8, -12); this.scene.add(fill);
    const floor = mesh(new THREE.PlaneGeometry(140, 140), mat('#eceef2', .04, .96));
    floor.rotation.x = -Math.PI/2; floor.position.y = -.02; floor.castShadow = false; this.scene.add(floor);
    const grid = new THREE.GridHelper(100, 100, '#d5dae2', '#e6e9ef'); grid.position.y = 0; grid.material.opacity = .22; grid.material.transparent = true; this.scene.add(grid);
    this.floor = floor;
    this.grid = grid;
    this.root = null;
    this.modelBounds = null;
    this.modelPreviewInfo = null;
    this.skinTexture = demoTexture();
    this.modelMeshes = [];
    this.materialBases = new Map();
    this.previewMaterials = [];
    this.previewMaps = new Map();
    this.mappings = [];
    this.textureRequest = 0;
    this.hasUserTexture = false;
    this.accessoryTextures = new Map();
    this.accessoryRequests = new Map();
    this.accessoryColor = null;
    this.currentMode = 'loading';
    this.currentCoach = COACHES[0];
    this.setCoach(COACHES[0].id);
    const host = canvas.parentElement || canvas;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(200, Math.floor(rect.width));
      const height = Math.max(200, Math.floor(rect.height));
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(host);
    resize();
    this.renderer.setAnimationLoop((now) => {
      if (this.cameraAnim) {
        const anim = this.cameraAnim;
        const elapsed = (now - anim.startTime) / anim.duration;
        const rawT = Math.min(1, Math.max(0, elapsed));
        // Smooth Apple ease-in-out cubic curve
        const t = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
        const target = anim.scratchTarget.lerpVectors(anim.fromTarget, anim.toTarget, t);
        const radius = anim.fromSph.radius + (anim.toSph.radius - anim.fromSph.radius) * t;
        const phi = anim.fromSph.phi + (anim.toSph.phi - anim.fromSph.phi) * t;
        const theta = anim.fromSph.theta + anim.deltaTheta * t;
        anim.scratchSph.set(radius, phi, theta);
        anim.scratchOffset.setFromSpherical(anim.scratchSph);
        this.controls.target.copy(target);
        this.camera.position.copy(target).add(anim.scratchOffset);
        this.camera.lookAt(target);
        if (rawT >= 1) {
          this.cameraAnim = null;
          const prevDamp = this.controls.enableDamping;
          this.controls.enableDamping = false;
          this.controls.update();
          this.controls.enableDamping = prevDamp;
        }
      } else {
        this.controls.update();
      }
      if (this.modelRevealAnim && this.root) {
        const rev = this.modelRevealAnim;
        const rawT = Math.min(1, Math.max(0, (now - rev.startTime) / rev.duration));
        const t = 1 - Math.pow(1 - rawT, 3);
        const s = rev.fromScale + (rev.toScale - rev.fromScale) * t;
        this.root.scale.setScalar(s);
        if (rawT >= 1) {
          this.root.scale.setScalar(rev.toScale);
          this.modelRevealAnim = null;
        }
      }
      this.renderer.render(this.scene, this.camera);
    });
  }
  restoreOriginalMaterials() {
    for (const entry of this.materialBases.values()) entry.mesh.material = entry.original;
    for (const material of this.previewMaterials) material.dispose();
    for (const texture of this.previewMaps.values()) texture.dispose();
    this.previewMaterials = [];
    this.previewMaps.clear();
  }
  detachModel() {
    this.modelRevealAnim = null;
    if (!this.root) return;
    this.clearGlassArtwork();
    this.clearAllAccessoryTextures(false);
    this.accessoryColor = null;
    this.hasUserTexture = false;
    this.restoreOriginalMaterials();
    const resources = new Set();
    const keptTextures = new Set([this.skinTexture, ...this.accessoryTextures.values()]);
    this.root.traverse(object => {
      if (!object.isMesh) return;
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture && !keptTextures.has(value)) resources.add(value);
      }
    });
    for (const resource of resources) resource.dispose();
    this.scene.remove(this.root);
    this.root = null;
    this.modelBounds = null;
    this.modelPreviewInfo = null;
    this.modelMeshes = [];
    this.materialBases.clear();
    this.mappings = [];
  }
  clearAllAccessoryTextures(reapply = true) {
    for (const [key, tex] of this.accessoryTextures.entries()) {
      this.accessoryRequests.set(key, (this.accessoryRequests.get(key) || 0) + 1);
      tex.dispose();
    }
    this.accessoryTextures.clear();
    if (reapply && this.currentMode === 'imported') this.applyMappings(this.mappings, this.hasUserTexture);
  }
  clearAccessoryTexture(slotKey, reapply = true) {
    this.accessoryRequests.set(slotKey, (this.accessoryRequests.get(slotKey) || 0) + 1);
    const existing = this.accessoryTextures.get(slotKey);
    if (existing) {
      existing.dispose();
      this.accessoryTextures.delete(slotKey);
    }
    if (reapply && this.currentMode === 'imported') this.applyMappings(this.mappings, this.hasUserTexture);
  }
  clearSideskirtTexture(reapply = true) {
    this.clearAccessoryTexture('sideskirt', reapply);
  }
  setAccessoryColor(hex) {
    this.accessoryColor = typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex : null;
    if (this.currentMode === 'imported') this.applyMappings(this.mappings, this.hasUserTexture);
  }
  async setAccessoryTexture(slotKey, file) {
    if (!file) {
      this.clearAccessoryTexture(slotKey, true);
      return null;
    }
    const ext = file.filename.toLowerCase().split('.').pop();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', dds: 'application/octet-stream' }[ext];
    if (!mime) throw new Error('Unsupported texture format');
    const request = (this.accessoryRequests.get(slotKey) || 0) + 1;
    this.accessoryRequests.set(slotKey, request);
    const raw = Uint8Array.from(atob(file.base64), x => x.charCodeAt(0));
    const blob = new Blob([raw], { type: mime });
    const url = URL.createObjectURL(blob);
    try {
      let newTex = ext === 'dds' ? readDDS(raw) : await new THREE.TextureLoader().loadAsync(url);
      if (request !== this.accessoryRequests.get(slotKey)) {
        newTex.dispose();
        return null;
      }
      if (ext !== 'dds') {
        const canvas = document.createElement('canvas');
        canvas.width = newTex.image.width;
        canvas.height = newTex.image.height;
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = this.accessoryColor || '#f2f4f7';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(newTex.image, 0, 0);
        newTex.dispose();
        newTex = new THREE.CanvasTexture(canvas);
      }
      newTex.colorSpace = THREE.SRGBColorSpace;
      newTex.flipY = false;
      newTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      newTex.needsUpdate = true;
      const old = this.accessoryTextures.get(slotKey);
      if (old) old.dispose();
      this.accessoryTextures.set(slotKey, newTex);
      this.applyMappings(this.mappings, this.hasUserTexture);
      return { width: newTex.image?.width || newTex.image?.[0]?.width || 0, height: newTex.image?.height || 0, ext };
    } finally { URL.revokeObjectURL(url); }
  }
  async setSideskirtTexture(file) {
    return this.setAccessoryTexture('sideskirt', file);
  }
  clearGlassArtwork() {
    if (!this.windowOverlay) return;
    this.windowOverlay.removeFromParent();
    this.windowOverlay.geometry.dispose();
    this.windowOverlay.material.map.dispose();
    this.windowOverlay.material.dispose();
    this.windowOverlay = null;
  }
  makeSideWindowGeometry() {
    if (!this.windowProfile) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.windowProfile.position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.windowProfile.uv, 2));
    return geometry;
  }
  exportSideWindowUV() {
    const geometry = this.makeSideWindowGeometry();
    if (!geometry) throw new Error('เลือกรุ่นรถที่มีผังกระจกก่อน');
    const canvas = document.createElement('canvas');
    canvas.width = 4096;
    canvas.height = 2048;
    const context = canvas.getContext('2d');
    const uv = geometry.getAttribute('uv');
    context.beginPath();
    for (let vertex = 0; vertex < uv.count; vertex += 3) {
      context.moveTo(uv.getX(vertex) * canvas.width, uv.getY(vertex) * canvas.height);
      for (let offset = 1; offset < 3; offset++) {
        context.lineTo(uv.getX(vertex + offset) * canvas.width, uv.getY(vertex + offset) * canvas.height);
      }
      context.closePath();
    }
    context.fillStyle = '#63aadc55';
    context.fill();
    context.strokeStyle = '#33668899';
    context.lineWidth = 1;
    context.stroke();
    geometry.dispose();
    return canvas.toDataURL('image/png');
  }
  exportModelUV(width = 4096, height = 2048) {
    const selected = new Map(this.mappings.map(({ id, channel }) => [id, channel]));
    if (!selected.size) throw new Error('เลือกวัสดุและ UV ของตัวถังก่อนบันทึกผัง');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.strokeStyle = '#385f85';
    context.lineWidth = Math.max(1, Math.min(width, height) / 2048);
    context.beginPath();
    const attributes = ['uv', 'uv1', 'uv2', 'uv3'];
    for (const entry of this.modelMeshes) {
      const channel = selected.get(entry.id);
      if (!Number.isInteger(channel)) continue;
      const uv = entry.object.geometry.getAttribute(attributes[channel]);
      if (!uv) continue;
      const geometry = entry.object.geometry;
      const index = geometry.getIndex();
      const groups = geometry.groups.length ? geometry.groups.filter(group => group.materialIndex === entry.slot) :
        (entry.slot === 0 ? [{ start: 0, count: index ? index.count : uv.count }] : []);
      for (const group of groups) {
        const end = Math.min(group.start + group.count, index ? index.count : uv.count);
        for (let offset = group.start; offset + 2 < end; offset += 3) {
          const a = index ? index.getX(offset) : offset;
          const b = index ? index.getX(offset + 1) : offset + 1;
          const c = index ? index.getX(offset + 2) : offset + 2;
          context.moveTo(uv.getX(a) * width, uv.getY(a) * height);
          context.lineTo(uv.getX(b) * width, uv.getY(b) * height);
          context.lineTo(uv.getX(c) * width, uv.getY(c) * height);
          context.closePath();
        }
      }
    }
    context.stroke();
    return canvas.toDataURL('image/png');
  }
  async setGlassArtwork(file, isCurrent, supportedModel = false) {
    this.clearGlassArtwork();
    if (!file || !supportedModel) return;
    const isDDS = /\.dds$/i.test(file.filename);
    const bytes = Uint8Array.from(atob(file.base64), value => value.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: isDDS ? 'application/octet-stream' : 'image/png' }));
    try {
      const map = isDDS ? readDDS(bytes) : await new THREE.TextureLoader().loadAsync(url);
      if (!isCurrent()) {
        map.dispose();
        return;
      }
      map.flipY = false;
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      map.needsUpdate = true;
      const geometry = this.makeSideWindowGeometry();
      if (!geometry) {
        map.dispose();
        return;
      }
      const material = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, alphaTest: .06, side: THREE.FrontSide });
      this.windowOverlay = new THREE.Mesh(geometry, material);
      this.windowOverlay.renderOrder = 5;
      this.root.add(this.windowOverlay);
      return true;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  clearTexture() {
    this.textureRequest++;
    this.hasUserTexture = false;
    this.restoreOriginalMaterials();
    this.skinTexture.dispose();
    this.skinTexture = demoTexture();
    if (this.currentMode === 'imported' && (this.accessoryTextures.size > 0 || this.accessoryColor)) {
      this.applyMappings(this.mappings, false);
    }
  }
  setCoach(id) {
    const coach = COACHES.find(c => c.id === id) || COACHES[0];
    this.clearGlassArtwork();
    this.windowProfile = null;
    this.currentCoach = coach;
    this.currentMode = 'loading';
    return coach;
  }
  async importGLB(base64, isCurrent = () => true, legacyVolvo = false, truckMode = false) {
    const cacheKey = `${base64.length}:${base64.slice(0, 48)}:${base64.slice(-48)}`;
    let buffer = this.glbBufferCache.get(cacheKey);
    if (!buffer) {
      try {
        const res = await fetch(`data:application/octet-stream;base64,${base64}`);
        buffer = await res.arrayBuffer();
      } catch {
        buffer = Uint8Array.from(atob(base64), x => x.charCodeAt(0)).buffer;
      }
      if (this.glbBufferCache.size >= 6) {
        const oldest = this.glbBufferCache.keys().next().value;
        this.glbBufferCache.delete(oldest);
      }
      this.glbBufferCache.set(cacheKey, buffer);
    }
    if (!isCurrent()) return null;
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => loader.parse(buffer.slice(0), '', resolve, reject));
    if (!isCurrent()) {
      const resources = new Set();
      gltf.scene.traverse(object => {
        if (!object.isMesh) return;
        resources.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          resources.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
        }
      });
      for (const resource of resources) resource.dispose();
      return null;
    }
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    if (bounds.isEmpty()) throw new Error('No mesh found in GLB');

    this.detachModel();
    const center = bounds.getCenter(new THREE.Vector3());
    center.y = bounds.min.y;
    const size = bounds.getSize(new THREE.Vector3());
    // ETS2 truck GLBs exported from SCS Blender Tools are already in metres.
    // Do not stretch a cab component to coach length; coach references retain legacy normalization.
    const factor = truckMode ? 1 : n(13.2 / Math.max(size.x, size.z, 1), .01, 1000);
    this.root = new THREE.Group();
    this.root.add(gltf.scene);
    this.root.position.copy(center).multiplyScalar(-factor);
    this.root.position.y += .015;
    this.root.scale.setScalar(factor);
    const meshNames = [];
    const strippedMaps = new Set();
    let hasUntexturedMaterial = false;
    let meshIndex = 0;
    gltf.scene.traverse(obj => {
      if (!obj.isMesh) return;
      meshNames.push(obj.name || '');
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      const preferred = obj.userData.skinUV ?? obj.parent?.userData.skinUV;
      const objLabel = obj.name || `Mesh ${meshIndex + 1}`;
      for (const material of materials) {
        if (!material) continue;
        // Strip baked sample bus liveries so coaches start clean blank white like blank trucks
        const legacyBody = legacyVolvo && objLabel === 'piece_12' && /carpaint_base_tile_difspec|PREVIEW_white_coach_paint/i.test(material.name);
        if (!truckMode && (Number.isInteger(preferred) || legacyBody)) {
          if (material.map) {
            strippedMaps.add(material.map);
            material.map = null;
          }
          material.color.set('#f4f6f9');
          material.roughness = 0.36;
          material.metalness = 0.06;
          material.needsUpdate = true;
          continue;
        }
        if (!material.map) hasUntexturedMaterial = true;
        if (!truckMode || material.map || material.color.r + material.color.g + material.color.b > .06) continue;
        const name = material.name.toLowerCase();
        const fallback = name.includes('glass') ? '#263d4a'
          : name.includes('plain_grey') || name.includes('white') || /paint|body|cab/.test(name) ? '#e0e4e8'
            : /steel|galvanized|chrome|metal/.test(name) ? '#87939c'
              : /lamp|light/.test(name) ? '#e8cf9b'
                : /darkgray|dark_grey/.test(name) ? '#3a3e42'
                  : '#30353a';
        material.color.set(fallback);
        material.roughness = name.includes('glass') ? .22 : .55;
        material.metalness = /steel|galvanized|chrome|metal/.test(name) ? .62 : .08;
        material.needsUpdate = true;
      }
      const channels = ['uv', 'uv1', 'uv2', 'uv3'].flatMap((attribute, index) =>
        obj.geometry.hasAttribute(attribute) ? [index] : []);
      // Keep the slot IDs used by version 1 projects.
      if (!channels.includes(0)) return;
      this.materialBases.set(obj.uuid, { mesh: obj, original: obj.material });
      const label = objLabel;
      for (let slot = 0; slot < materials.length; slot++) {
        const material = materials[slot];
        if (!material) continue;
        const legacyBody = legacyVolvo && label === 'piece_12' && /carpaint_base_tile_difspec|PREVIEW_white_coach_paint/i.test(material.name);
        const defaultChannel = Number.isInteger(preferred) ? preferred : legacyBody ? 1 : null;
        this.modelMeshes.push({
          id: `mesh-${meshIndex}-material-${slot}`,
          name: `${label} / ${material.name || `Material ${slot + 1}`}`,
          channels, defaultChannel: channels.includes(defaultChannel) ? defaultChannel : null,
          object: obj, slot
        });
      }
      meshIndex++;
    });
    for (const tex of strippedMaps) tex.dispose();
    this.scene.add(this.root);
    this.currentMode = 'imported';
    this.root.updateMatrixWorld(true);
    this.modelBounds = new THREE.Box3().setFromObject(this.root);
    const rootNames = gltf.scene.children.map(child => child.name).filter(Boolean);
    this.modelPreviewInfo = {
      cabOnly: truckMode && !rootNames.some(name => /chassis|wheel/i.test(name)) && rootNames.some(name => /^cab(?:in)?[_-]/i.test(name)),
      rootName: rootNames[0] || '',
      missingTextures: truckMode && hasUntexturedMaterial,
      meshCount: meshNames.length
    };
    this.fitCameraToBounds(this.modelBounds, 'reveal');
    this.modelRevealAnim = {
      startTime: performance.now(),
      duration: 420,
      fromScale: factor * 0.965,
      toScale: factor
    };
    this.root.scale.setScalar(factor * 0.965);
    return this.modelMeshes.map(({ id, name, channels, defaultChannel }) => ({ id, name, channels, defaultChannel }));
  }
  applyMappings(mappings, hasTexture) {
    if (this.currentMode !== 'imported') return;
    this.hasUserTexture = Boolean(hasTexture);
    this.restoreOriginalMaterials();
    const byId = new Map(mappings.map(mapping => [mapping.id, mapping.channel]));
    this.mappings = this.modelMeshes.flatMap(entry => {
      const channel = byId.get(entry.id);
      return entry.channels.includes(channel) ? [{ id: entry.id, channel }] : [];
    });
    const legacyAccessoryPrefix = /^(doorhndl|f_bumper|f_fender|f_fendr_chs|f_fender_chs|f_light_chs|f_light_top|f_logo|f_mirror|mirror|r_bumper|r_chs_cover|r_fender|r_fendr_top|s_mirror|sideskirt|sunshld)_/i;
    for (const entry of this.modelMeshes) {
      const channel = byId.get(entry.id);
      const { mesh, original } = this.materialBases.get(entry.object.uuid);
      const isArray = Array.isArray(original);
      const base = isArray ? original[entry.slot] : original;
      const objName = entry.object.name || '';
      const matName = base?.name || '';
      let accSlot = entry.object.userData?.accessorySlot || entry.object.parent?.userData?.accessorySlot || null;
      if (!accSlot && /plain_grey/i.test(matName)) {
        const m = legacyAccessoryPrefix.exec(objName);
        if (m) accSlot = m[1].toLowerCase() === 'f_fendr_chs' ? 'f_fender_chs' : m[1].toLowerCase();
      }
      const accTex = accSlot ? this.accessoryTextures.get(accSlot) : null;
      const accUV = Number.isInteger(entry.object.userData?.accessoryUV) ? entry.object.userData.accessoryUV : 0;

      if (hasTexture && entry.channels.includes(channel)) {
        if (!this.previewMaps.has(channel)) {
          const map = this.skinTexture.clone();
          map.channel = channel;
          map.flipY = false;
          map.needsUpdate = true;
          this.previewMaps.set(channel, map);
        }
        const material = base.isMeshStandardMaterial ? base.clone() : new THREE.MeshStandardMaterial({ side: base.side });
        material.color.set(0xffffff);
        material.map = this.previewMaps.get(channel);
        this.previewMaterials.push(material);
        if (isArray) {
          const slots = [...mesh.material];
          slots[entry.slot] = material;
          mesh.material = slots;
        } else mesh.material = material;
      } else if (accTex) {
        const map = accTex.clone();
        map.channel = entry.channels.includes(accUV) ? accUV : 0;
        map.flipY = false;
        map.needsUpdate = true;
        this.previewMaps.set(`acc-${accSlot}-${entry.id}`, map);
        const material = base.isMeshStandardMaterial ? base.clone() : new THREE.MeshStandardMaterial({ side: base.side });
        material.color.set(0xffffff);
        material.map = map;
        this.previewMaterials.push(material);
        if (isArray) {
          const slots = [...mesh.material];
          slots[entry.slot] = material;
          mesh.material = slots;
        } else mesh.material = material;
      } else if (this.accessoryColor && accSlot) {
        const material = base.isMeshStandardMaterial ? base.clone() : new THREE.MeshStandardMaterial({ side: base.side });
        material.color.set(this.accessoryColor);
        material.map = null;
        material.needsUpdate = true;
        this.previewMaterials.push(material);
        if (isArray) {
          const slots = [...mesh.material];
          slots[entry.slot] = material;
          mesh.material = slots;
        } else mesh.material = material;
      }
    }
  }
  async updateTexture(file) {
    const ext = file.filename.toLowerCase().split('.').pop();
    const mime = { png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',dds:'application/octet-stream' }[ext];
    if (!mime) throw new Error('Unsupported texture format');
    const request = ++this.textureRequest;
    const raw = Uint8Array.from(atob(file.base64), x => x.charCodeAt(0));
    const blob = new Blob([raw], { type:mime });
    const url = URL.createObjectURL(blob);
    try {
      let newTex = ext === 'dds' ? readDDS(raw) : await new THREE.TextureLoader().loadAsync(url);
      if (request !== this.textureRequest) {
        newTex.dispose();
        return null;
      }
      if (ext !== 'dds') {
        const canvas = document.createElement('canvas');
        canvas.width = newTex.image.width;
        canvas.height = newTex.image.height;
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(newTex.image, 0, 0);
        newTex.dispose();
        newTex = new THREE.CanvasTexture(canvas);
      }
      newTex.colorSpace = THREE.SRGBColorSpace;
      newTex.flipY = false;
      newTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      newTex.needsUpdate = true;
      if (this.skinTexture) this.skinTexture.dispose();
      this.skinTexture = newTex;
      this.applyMappings(this.mappings, true);
      return { width: newTex.image?.width || newTex.image?.[0]?.width || 0, height: newTex.image?.height || 0, ext };
    } finally { URL.revokeObjectURL(url); }
  }
  animateCameraTo(toPos, toTarget, baseDuration = 460) {
    const fromTarget = this.controls.target.clone();
    const fromOffset = this.camera.position.clone().sub(fromTarget);
    const toOffset = toPos.clone().sub(toTarget);
    const fromSph = new THREE.Spherical().setFromVector3(fromOffset);
    const toSph = new THREE.Spherical().setFromVector3(toOffset);
    // Shortest orbital path around the vehicle; for exact 180° flips (front↔rear, left↔right) sweep cleanly around the outside
    let deltaTheta = toSph.theta - fromSph.theta;
    while (deltaTheta > Math.PI) deltaTheta -= Math.PI * 2;
    while (deltaTheta < -Math.PI) deltaTheta += Math.PI * 2;
    if (Math.abs(Math.abs(deltaTheta) - Math.PI) < 0.001) deltaTheta = Math.PI;
    const duration = Math.round(baseDuration + (Math.abs(deltaTheta) / Math.PI) * 260);
    this.cameraAnim = {
      fromTarget,
      toTarget: toTarget.clone(),
      fromSph,
      toSph,
      deltaTheta,
      startTime: performance.now(),
      duration,
      scratchTarget: new THREE.Vector3(),
      scratchOffset: new THREE.Vector3(),
      scratchSph: new THREE.Spherical()
    };
  }
  setView(direction) {
    const target = this.modelBounds?.getCenter(new THREE.Vector3()) || new THREE.Vector3(0, 2, 0);
    const directions = { left: [-1, .16, 0], right: [1, .16, 0], front: [0, .16, -1], rear: [0, .16, 1] };
    const offset = new THREE.Vector3(...(directions[direction] || directions.left)).normalize();
    const radius = this.modelBounds?.getBoundingSphere(new THREE.Sphere()).radius || 7;
    const distance = this.cameraDistanceForRadius(radius);
    this.animateCameraTo(target.clone().addScaledVector(offset, distance), target, 460);
  }
  resetCamera() {
    if (this.modelBounds && !this.modelBounds.isEmpty()) {
      this.fitCameraToBounds(this.modelBounds, true);
      return;
    }
    this.animateCameraTo(new THREE.Vector3(-16, 6.4, -9), new THREE.Vector3(0, 2, 0), 460);
  }
  cameraDistanceForRadius(radius) {
    const aspect = Math.max(.25, this.camera.aspect || 1);
    const vertical = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
    return Math.max(radius * 1.6, radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.14);
  }
  fitCameraToBounds(bounds, animate = false) {
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, .25);
    const direction = new THREE.Vector3(-1, .34, -.72).normalize();
    const distance = this.cameraDistanceForRadius(radius);
    const targetPos = sphere.center.clone().addScaledVector(direction, distance);
    this.camera.near = Math.max(.01, distance / 500);
    this.camera.far = distance + radius * 12;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(.2, radius * .2);
    this.controls.maxDistance = Math.max(40, distance * 5);
    if (animate === 'reveal') {
      // Silky Apple Keynote entrance: start 14deg aside & 7% farther, glide into hero 3/4 view
      const startSph = new THREE.Spherical().setFromVector3(targetPos.clone().sub(sphere.center));
      startSph.theta -= 0.24;
      startSph.radius *= 1.07;
      const startPos = sphere.center.clone().add(new THREE.Vector3().setFromSpherical(startSph));
      this.controls.target.copy(sphere.center);
      this.camera.position.copy(startPos);
      this.camera.lookAt(sphere.center);
      this.animateCameraTo(targetPos, sphere.center, 580);
    } else if (animate) {
      this.animateCameraTo(targetPos, sphere.center, 440);
    } else {
      this.cameraAnim = null;
      this.controls.target.copy(sphere.center);
      this.camera.position.copy(targetPos);
      this.controls.update();
    }
  }
  setLighting(value) { this.ambient.intensity = n(Number(value), .1, 5); }
  captureShopIcon(badgeText = 'STUDIO') {
    const out = document.createElement('canvas');
    out.width = 256;
    out.height = 64;
    const ctx = out.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 256, 64);
    bg.addColorStop(0, '#0d1b34');
    bg.addColorStop(0.55, '#193561');
    bg.addColorStop(1, '#0c203d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 64);

    // Subtle radial spotlight behind vehicle
    const glow = ctx.createRadialGradient(164, 34, 6, 164, 34, 92);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 256, 64);

    // Render vehicle cleanly without studio floor/grid and crop tightly to vehicle bounds
    if (this.root && this.modelBounds && !this.modelBounds.isEmpty()) {
      if (this.modelRevealAnim) {
        this.root.scale.setScalar(this.modelRevealAnim.toScale);
        this.modelRevealAnim = null;
      }
      const prevFloor = this.floor.visible;
      const prevGrid = this.grid.visible;
      const prevPos = this.camera.position.clone();
      const prevTarget = this.controls.target.clone();
      try {
        this.floor.visible = false;
        this.grid.visible = false;
        const sphere = this.modelBounds.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 0.5);
        const dir = new THREE.Vector3(-1, 0.24, -0.62).normalize();
        const dist = this.cameraDistanceForRadius(radius) * 0.88;
        this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
        this.camera.lookAt(sphere.center);
        this.camera.updateMatrixWorld(true);
        this.renderer.render(this.scene, this.camera);

        // Compute tight 2D crop of model bounding box on rendered WebGL canvas
        const src = this.renderer.domElement;
        const min = this.modelBounds.min;
        const max = this.modelBounds.max;
        let minX = 1, maxX = -1, minY = 1, maxY = -1;
        for (const x of [min.x, max.x]) {
          for (const y of [min.y, max.y]) {
            for (const z of [min.z, max.z]) {
              const p = new THREE.Vector3(x, y, z).project(this.camera);
              minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
              minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
          }
        }
        const pad = 0.06;
        const sx = Math.max(0, Math.floor(((minX - pad) * 0.5 + 0.5) * src.width));
        const sy = Math.max(0, Math.floor(((1 - (maxY + pad)) * 0.5) * src.height));
        const sw = Math.max(16, Math.min(src.width - sx, Math.ceil(((maxX - minX + pad * 2) * 0.5) * src.width)));
        const sh = Math.max(16, Math.min(src.height - sy, Math.ceil(((maxY - minY + pad * 2) * 0.5) * src.height)));
        const boxW = 178, boxH = 58;
        const scale = Math.min(boxW / sw, boxH / sh);
        const dw = sw * scale, dh = sh * scale;
        ctx.drawImage(src, sx, sy, sw, sh, 74 + (boxW - dw) / 2, (64 - dh) / 2, dw, dh);
      } finally {
        this.floor.visible = prevFloor;
        this.grid.visible = prevGrid;
        this.camera.position.copy(prevPos);
        this.controls.target.copy(prevTarget);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
      }
    }

    // High-visibility gold accent stripe + STUDIO pill badge so it stands out immediately in ETS2
    ctx.fillStyle = '#f5b800';
    ctx.fillRect(0, 0, 6, 64);

    ctx.fillStyle = '#f5b800';
    ctx.beginPath();
    ctx.roundRect(14, 10, 56, 17, 4);
    ctx.fill();
    ctx.fillStyle = '#0d1b34';
    ctx.font = '800 9px "SF Pro", "SF Pro TH", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(badgeText || 'STUDIO').slice(0, 8), 42, 19);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 10px "SF Pro", "SF Pro TH", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('CUSTOM', 14, 41);
    ctx.fillStyle = '#9ec4ff';
    ctx.font = '600 8px "SF Pro", "SF Pro TH", sans-serif';
    ctx.fillText('SKIN', 14, 52);

    ctx.strokeStyle = 'rgba(245, 184, 0, 0.72)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 254, 62);
    return out.toDataURL('image/png');
  }
  setWireframe(on) {
    if (!this.root) return;
    this.root.traverse(obj => {
      if (obj.isMesh) {
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          if (m && 'wireframe' in m) { m.wireframe = on; m.needsUpdate = true; }
        }
      }
    });
  }
}
