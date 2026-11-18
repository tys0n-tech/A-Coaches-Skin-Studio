import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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

function scaniaSideWindowGeometry(mesh) {
  const positions = mesh.getAttribute('position');
  const normals = mesh.getAttribute('normal');
  const index = mesh.getIndex();
  if (!positions || !normals) return null;
  const vertices = [];
  const uv = [];
  for (let i = 0; i + 2 < (index?.count ?? positions.count); i += 3) {
    const face = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
    const side = Math.sign(positions.getX(face[0]));
    const isSideWindow = face.every(vertex =>
      side * positions.getX(vertex) > 1.13 && positions.getY(vertex) > 2.1 && side * normals.getX(vertex) > .55
    );
    if (!isSideWindow) continue;
    for (const vertex of face) {
      const x = positions.getX(vertex);
      const y = positions.getY(vertex);
      const z = positions.getZ(vertex);
      // Offset the decal 7 mm along the window normal to keep it clear of the glass.
      vertices.push(x + .007 * normals.getX(vertex), y + .007 * normals.getY(vertex), z + .007 * normals.getZ(vertex));
      const u = (z + 6.2) / 14;
      const v = (3.55 - y) / 1.55;
      uv.push(side > 0 ? u : 1 - u, (v + Number(side < 0)) / 2);
    }
  }
  if (!vertices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
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

function createCoach(info, skinTex) {
  const root = new THREE.Group();
  root.name = `Preview illustration — ${info.name}`;
  const L = info.len, H = info.height, W = 2.55;
  const floorY = .9, bodyCenter = floorY + (H - floorY)/2;
  const roundedBody = mesh(new RoundedBoxGeometry(L, H - floorY, W, 6, .22), mat('#f0f2f6'), 0, bodyCenter, 0);
  roundedBody.name = 'Illustrative body — not game model';
  root.add(roundedBody);
  const skinSides = [];
  for (const side of [1, -1]) {
    const z = side * (W/2 + .025);
    const skin = mesh(new THREE.PlaneGeometry(L - .36, H - floorY - .18), new THREE.MeshStandardMaterial({ color: '#ffffff', map: skinTex, side: THREE.DoubleSide, roughness: .56, metalness: .08 }), 0, bodyCenter, z);
    skin.name = `Procedural side skin ${side === 1 ? 'left' : 'right'}`;
    if (side === -1) skin.rotation.y = Math.PI;
    root.add(skin); skinSides.push(skin);
    const black = mat('#16212d', .18, .22);
    const glass = new THREE.MeshPhysicalMaterial({ color: '#18283c', metalness: .08, roughness: .19, transparent: true, opacity: .97, clearcoat: 1, clearcoatRoughness: .05, side: THREE.DoubleSide });
    const rows = info.decks === 2 ? [{ y: 2.45, h: .65 }, { y: 3.44, h: .57 }] : [{ y: H - .92, h: .88 }];
    for (const r of rows) {
      const count = info.decks === 2 ? 9 : 8;
      const zoneLength = L - 1.35;
      const segment = zoneLength / count;
      for (let i = 0; i < count; i++) {
        const x = -zoneLength / 2 + segment * (i + .5);
        const win = mesh(new THREE.PlaneGeometry(segment - .083, r.h), glass, x, r.y, side * (W / 2 + .05));
        if (side === -1) win.rotation.y = Math.PI;
        root.add(win);
      }
      root.add(mesh(new THREE.BoxGeometry(L - 1.05, .09, .085), black, 0, r.y - r.h / 2, side * (W / 2 + .055)));
    }
    // Bus door and separators (an illustrative shape, never an SCS UV map)
    const doorX = L * .34;
    const outline = mesh(new THREE.BoxGeometry(.04, 2.38, .045), black, doorX, 1.78, side * (W / 2 + .072));
    root.add(outline);
    const handle = mesh(new THREE.BoxGeometry(.13, .045, .045), mat('#a5aeb7', .7), doorX + .2, 1.6, side * (W/2+.082));
    root.add(handle);
  }
  root.add(mesh(new THREE.BoxGeometry(L - .55, .24, W - .08), mat('#ced4df'), 0, H - .12, 0));
  root.add(mesh(new THREE.BoxGeometry(L - .15, .18, W - .08), mat('#26313f'), 0, .82, 0));
  const tyre = mat('#171b22', .03, .87);
  const rim = mat('#aeb8c4', .9, .22);
  const hub = mat('#596777', .7, .35);
  const positions = info.axles === 3 ? [L * .33, -L * .22, -L * .34] : [L * .31, -L * .34];
  for (const axleX of positions) {
    for (const side of [1, -1]) {
      const wheel = mesh(new THREE.CylinderGeometry(.57, .57, .23, 28), tyre, axleX, .67, side * 1.31);
      wheel.rotation.x = Math.PI / 2;
      root.add(wheel);
      const disc = mesh(new THREE.CylinderGeometry(.39, .39, .24, 28), rim, axleX, .67, side * 1.32);
      disc.rotation.x = Math.PI/2;
      root.add(disc);
      const center = mesh(new THREE.CylinderGeometry(.13, .13, .25, 20), hub, axleX, .67, side * 1.33);
      center.rotation.x = Math.PI/2;
      root.add(center);
    }
  }
  const front = mesh(new THREE.PlaneGeometry(W - .28, info.decks === 2 ? 1.8 : 1.45), mat('#1a2a3c', .2, .17), L / 2 + .12, info.decks === 2 ? 2.53 : 2.55, 0);
  front.rotation.y = Math.PI / 2; root.add(front);
  const rear = mesh(new THREE.PlaneGeometry(W - .33, .9), mat('#243348', .1, .22), -L / 2 - .12, H - 1.18, 0);
  rear.rotation.y = -Math.PI/2; root.add(rear);
  for (const side of [-1, 1]) {
    const light = mesh(new THREE.BoxGeometry(.05, .16, .38), mat('#e3eef7', .06, .1), L/2 + .13, 1.25, side * .83);
    root.add(light);
    root.add(mesh(new THREE.BoxGeometry(.05, .18, .29), mat('#bf202c', .2, .23), -L/2 - .13, 1.35, side * .91));
    const mirror = mesh(new RoundedBoxGeometry(.28, .5, .18, 3, .06), mat('#242d39'), L/2-.55, H-1.53, side*1.48);
    root.add(mirror);
  }
  root.userData.skinSides = skinSides;
  return root;
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
    this.currentMode = 'illustration';
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
  async setGlassArtwork(file, isCurrent, supportedModel = false) {
    this.clearGlassArtwork();
    if (!file || !supportedModel) return;
    const glass = this.modelMeshes.find(slot => slot.name.endsWith(' / body_mat_0007_glass_ex_difspec'));
    if (!glass) return;
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
      map.needsUpdate = true;
      const geometry = scaniaSideWindowGeometry(glass.object.geometry);
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
    this.skinTexture.dispose();
    this.skinTexture = demoTexture();
  }
  setCoach(id) {
    const coach = COACHES.find(c => c.id === id) || COACHES[0];
    this.detachModel();
    this.currentCoach = coach; this.currentMode = 'illustration';
    this.skinTexture.flipY = true; this.skinTexture.needsUpdate = true;
    this.root = createCoach(coach, this.skinTexture);
    this.scene.add(this.root);
    this.resetCamera();
    return coach;
  }
  async importGLB(base64, isCurrent = () => true, legacyVolvo = false) {
    const bytes = Uint8Array.from(atob(base64), x => x.charCodeAt(0));
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => loader.parse(bytes.buffer, '', resolve, reject));
    if (!isCurrent()) return null;
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
      newTex.flipY = this.currentMode === 'illustration';
      newTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      newTex.needsUpdate = true;
      if (this.skinTexture) this.skinTexture.dispose();
      this.skinTexture = newTex;
      if (this.currentMode === 'illustration') {
        for (const side of this.root.userData.skinSides) { side.material.map = newTex; side.material.needsUpdate = true; }
      } else this.applyMappings(this.mappings, true);
      return { width: newTex.image?.width || newTex.image?.[0]?.width || 0, height: newTex.image?.height || 0, ext };
    } finally { URL.revokeObjectURL(url); }
  }
  resetCamera() {
    this.camera.position.set(...(this.currentMode === 'imported' ? [-16, 6.4, -9] : [18, 9.5, 19]));
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
