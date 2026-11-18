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

export async function windowArtwork(file, profile, legacyScania = false) {
  const source = await createImageBitmap(new Blob([Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))], { type: 'image/png' }));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = profile.width;
    canvas.height = profile.height;
    const context = canvas.getContext('2d');
    if (source.width === profile.width && source.height === profile.height) {
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
      throw new Error('ใช้ PNG เฟรมเต็ม 4096 × 2048 ตามผังกระจกรุ่นที่เลือก');
    }
    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const draw = mask.getContext('2d');
    draw.beginPath();
    for (let index = 0; index < profile.uv.length; index += 6) {
      draw.moveTo(profile.uv[index] * mask.width, profile.uv[index + 1] * mask.height);
      draw.lineTo(profile.uv[index + 2] * mask.width, profile.uv[index + 3] * mask.height);
      draw.lineTo(profile.uv[index + 4] * mask.width, profile.uv[index + 5] * mask.height);
      draw.closePath();
    }
    draw.fill();
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
    this.controls.enableDamping = true; this.controls.dampingFactor = .075;
    this.controls.maxPolarAngle = Math.PI/2 - .035;
    this.controls.minDistance = 6; this.controls.maxDistance = 55;
    this.controls.target.set(0, 2, 0);
    this.ambient = new THREE.HemisphereLight('#ffffff', '#aeb8c5', 2.0); this.scene.add(this.ambient);
    const key = new THREE.DirectionalLight('#ffffff', 3.1); key.position.set(-8, 16, 9); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -22; key.shadow.camera.right = 22; key.shadow.camera.top = 22; key.shadow.camera.bottom = -22; key.shadow.normalBias = .03;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#c9d9f1', 1.0); fill.position.set(9, 7, -12); this.scene.add(fill);
    const floor = mesh(new THREE.PlaneGeometry(140, 140), mat('#dce2e9', .06, .96));
    floor.rotation.x = -Math.PI/2; floor.position.y = -.02; floor.castShadow = false; this.scene.add(floor);
    const grid = new THREE.GridHelper(100, 100, '#ced5dd', '#e4e9ed'); grid.position.y = 0; grid.material.opacity = .27; grid.material.transparent = true; this.scene.add(grid);
    this.root = null;
    this.skinTexture = demoTexture();
    this.modelMeshes = [];
    this.materialBases = new Map();
    this.previewMaterials = [];
    this.previewMaps = new Map();
    this.mappings = [];
    this.textureRequest = 0;
    this.currentMode = 'loading';
    this.currentCoach = COACHES[0];
    this.setCoach(COACHES[0].id);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(200, rect.width); const height = Math.max(200, rect.height);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width/height;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
    this.renderer.setAnimationLoop(() => { this.controls.update(); this.renderer.render(this.scene, this.camera); });
  }
  restoreOriginalMaterials() {
    for (const entry of this.materialBases.values()) entry.mesh.material = entry.original;
    for (const material of this.previewMaterials) material.dispose();
    for (const texture of this.previewMaps.values()) texture.dispose();
    this.previewMaterials = [];
    this.previewMaps.clear();
  }
  detachModel() {
    if (!this.root) return;
    this.clearGlassArtwork();
    this.restoreOriginalMaterials();
    const resources = new Set();
    this.root.traverse(object => {
      if (!object.isMesh) return;
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture && value !== this.skinTexture) resources.add(value);
      }
    });
    for (const resource of resources) resource.dispose();
    this.scene.remove(this.root);
    this.root = null;
    this.modelMeshes = [];
    this.materialBases.clear();
    this.mappings = [];
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
      const material = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, alphaTest: .06, side: THREE.DoubleSide });
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
    this.restoreOriginalMaterials();
    this.skinTexture.dispose();
    this.skinTexture = demoTexture();
  }
  setCoach(id) {
    const coach = COACHES.find(c => c.id === id) || COACHES[0];
    this.clearGlassArtwork();
    this.windowProfile = null;
    this.currentCoach = coach;
    this.currentMode = 'loading';
    return coach;
  }
  async importGLB(base64, isCurrent = () => true, legacyVolvo = false) {
    const bytes = Uint8Array.from(atob(base64), x => x.charCodeAt(0));
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => loader.parse(bytes.buffer, '', resolve, reject));
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
    const factor = n(13.2 / Math.max(size.x, size.z, 1), .01, 1000);
    this.root = new THREE.Group();
    this.root.add(gltf.scene);
    this.root.position.copy(center).multiplyScalar(-factor);
    this.root.position.y += .015;
    this.root.scale.setScalar(factor);
    let meshIndex = 0;
    gltf.scene.traverse(obj => {
      if (!obj.isMesh) return;
      const channels = ['uv', 'uv1', 'uv2', 'uv3'].flatMap((attribute, index) =>
        obj.geometry.hasAttribute(attribute) ? [index] : []);
      // Keep the slot IDs used by version 1 projects.
      if (!channels.includes(0)) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      this.materialBases.set(obj.uuid, { mesh: obj, original: obj.material });
      const label = obj.name || `Mesh ${meshIndex + 1}`;
      for (let slot = 0; slot < materials.length; slot++) {
        const material = materials[slot];
        if (!material) continue;
        const preferred = obj.userData.skinUV ?? obj.parent?.userData.skinUV;
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
    this.scene.add(this.root);
    this.currentMode = 'imported';
    this.resetCamera();
    return this.modelMeshes.map(({ id, name, channels, defaultChannel }) => ({ id, name, channels, defaultChannel }));
  }
  applyMappings(mappings, hasTexture) {
    if (this.currentMode !== 'imported') return;
    this.restoreOriginalMaterials();
    const byId = new Map(mappings.map(mapping => [mapping.id, mapping.channel]));
    this.mappings = this.modelMeshes.flatMap(entry => {
      const channel = byId.get(entry.id);
      return entry.channels.includes(channel) ? [{ id: entry.id, channel }] : [];
    });
    if (!hasTexture) return;
    for (const entry of this.modelMeshes) {
      const channel = byId.get(entry.id);
      if (!entry.channels.includes(channel)) continue;
      if (!this.previewMaps.has(channel)) {
        const map = this.skinTexture.clone();
        map.channel = channel;
        map.flipY = false;
        map.needsUpdate = true;
        this.previewMaps.set(channel, map);
      }
      const { mesh, original } = this.materialBases.get(entry.object.uuid);
      const isArray = Array.isArray(original);
      const base = isArray ? original[entry.slot] : original;
      const material = base.isMeshStandardMaterial ? base.clone() : new THREE.MeshStandardMaterial({ side: base.side });
      material.color.set(0xffffff);
      material.map = this.previewMaps.get(channel);
      this.previewMaterials.push(material);
      if (isArray) {
        const slots = [...mesh.material];
        slots[entry.slot] = material;
        mesh.material = slots;
      } else mesh.material = material;
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
  setView(direction) {
    const positions = { left: [-19, 3, 0], right: [19, 3, 0], front: [0, 3, -19], rear: [0, 3, 19] };
    this.camera.position.set(...positions[direction]);
    this.controls.target.set(0, 2, 0);
    this.controls.update();
  }
  resetCamera() {
    this.camera.position.set(-16, 6.4, -9);
    this.controls.target.set(0, 2, 0);
    this.controls.update();
  }
  setLighting(value) { this.ambient.intensity = n(Number(value), .1, 5); }
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
