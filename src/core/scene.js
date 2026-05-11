// scene.js
// Backend-agnostic Three.js scene tracker.
//
// Three.js objects are plain JS — no `import THREE` needed. We rely on
// duck-typed flags (isMesh, isInstancedMesh, isLight, …) which Three sets
// on every object. Works for both WebGLRenderer and WebGPURenderer scenes.
//
// Usage:
//   WebGLAnalyzer.attachScene(scene, { label: "main", renderer });
//   WebGLAnalyzer.detachScene(scene);
//
//   // Optional — register loaded asset roots so the Scene tab can group
//   // their meshes/textures separately from procedural content.
//   WebGLAnalyzer.attachModel(gltf.scene, { label: "bag", source: "bag.glb", kind: "glb" });
//   // (or pass an array via attachScene({ models: […] }))

const TEXTURE_MAP_KEYS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap",
  "aoMap", "alphaMap", "bumpMap", "displacementMap", "envMap",
  "lightMap", "specularMap", "gradientMap", "matcap", "clearcoatMap",
  "clearcoatNormalMap", "clearcoatRoughnessMap", "sheenColorMap",
  "sheenRoughnessMap", "transmissionMap", "thicknessMap",
  "iridescenceMap", "iridescenceThicknessMap",
];

export class SceneTracker {
  constructor() {
    /** @type {Array<{ scene: any, label: string, renderer: any }>} */
    this.scenes = [];
    /** @type {Array<{ root: any, label: string, source: string|null, kind: string }>} */
    this.models = [];
  }
  attach(scene, opts = {}) {
    if (!scene || this.scenes.find((s) => s.scene === scene)) return this;
    this.scenes.push({
      scene,
      label: opts.label || scene.name || `scene${this.scenes.length}`,
      renderer: opts.renderer || null,
    });
    if (Array.isArray(opts.models)) {
      for (const m of opts.models) this.attachModel(m.root || m.scene, m);
    }
    return this;
  }
  detach(scene) {
    const i = this.scenes.findIndex((s) => s.scene === scene);
    if (i >= 0) this.scenes.splice(i, 1);
    return this;
  }
  // Register a loaded asset root (e.g. gltf.scene) so the Scene tab can
  // group its meshes/textures separately from procedural primitives.
  attachModel(root, opts = {}) {
    if (!root || this.models.find((m) => m.root === root)) return this;
    this.models.push({
      root,
      label: opts.label || root.name || `model${this.models.length}`,
      source: opts.source || null,
      kind: opts.kind || guessModelKind(opts.source),
    });
    return this;
  }
  detachModel(root) {
    const i = this.models.findIndex((m) => m.root === root);
    if (i >= 0) this.models.splice(i, 1);
    return this;
  }
  has() { return this.scenes.length > 0; }
}

function guessModelKind(source) {
  if (!source) return "model";
  const s = String(source).toLowerCase();
  if (s.endsWith(".glb"))  return "glb";
  if (s.endsWith(".gltf")) return "gltf";
  if (s.endsWith(".obj"))  return "obj";
  if (s.endsWith(".fbx"))  return "fbx";
  if (s.endsWith(".usdz")) return "usdz";
  if (s.endsWith(".ply"))  return "ply";
  if (s.endsWith(".stl"))  return "stl";
  return "model";
}

// Walks a scene once, returning a snapshot. Cheap enough to call per frame
// on a few-hundred-node scene.
//
// `models` is an optional list of registered model roots (Object3Ds). Any
// renderable found under one of those roots is tagged with `modelIndex`,
// the snapshot returns a `modelStats[i]` rollup per model, and the same
// mesh entry stays in the flat `meshes` array so existing UI code keeps
// working.
export function snapshotScene(scene, models = []) {
  const meshes = [];
  const lights = [];
  const cameras = [];
  const geometries = new Set();
  const materials = new Set();
  const textures = new Map();   // texture -> { count, refKeys: Set }
  let nodeCount = 0;
  let totalVerts = 0;
  let totalTris = 0;
  let totalInstances = 0;
  let drawCallEstimate = 0;

  // Per-model accumulators (parallel to `models`).
  const modelStats = models.map((m) => ({
    label: m.label, source: m.source, kind: m.kind,
    rootName: m.root?.name || null,
    visible: m.root ? !!m.root.visible : true,
    nodes: 0, meshes: 0, instancedMeshes: 0, instances: 0,
    vertices: 0, triangles: 0,
    geometries: new Set(), materials: new Set(), textures: new Map(),
    meshList: [],
  }));

  // Pre-build a map root -> index for fast model attribution.
  const modelRoots = models.map((m) => m.root);

  // For each node, find which model (if any) it belongs to by walking up
  // the parent chain. Cached on the object so we only pay it once.
  function modelIndexOf(o) {
    if (!modelRoots.length) return -1;
    if (o.__wgla_modelIdx != null) return o.__wgla_modelIdx;
    let p = o;
    while (p) {
      const i = modelRoots.indexOf(p);
      if (i >= 0) { o.__wgla_modelIdx = i; return i; }
      p = p.parent;
    }
    o.__wgla_modelIdx = -1;
    return -1;
  }

  scene.traverse((o) => {
    nodeCount++;
    const mi = modelIndexOf(o);
    if (mi >= 0) modelStats[mi].nodes++;
    if (o.isLight) lights.push(o);
    if (o.isCamera) cameras.push(o);
    if (!(o.isMesh || o.isPoints || o.isLine || o.isLineSegments || o.isSkinnedMesh)) return;
    const geo = o.geometry;
    if (geo) geometries.add(geo);
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      materials.add(m);
      for (const k of TEXTURE_MAP_KEYS) {
        const t = m[k];
        if (t && t.isTexture) {
          let entry = textures.get(t);
          if (!entry) { entry = { count: 0, refKeys: new Set() }; textures.set(t, entry); }
          entry.count++;
          entry.refKeys.add(k);
        }
      }
    }
    const isInstanced = !!o.isInstancedMesh;
    const instanceCount = isInstanced ? (o.count || 0) : 1;
    const verts = geo?.attributes?.position?.count || 0;
    const tris = computeTriangleCount(o);
    totalVerts += verts;
    totalTris += tris * instanceCount;
    totalInstances += isInstanced ? instanceCount : 0;
    drawCallEstimate += mats.length || 1;
    const meshEntry = {
      object: o,
      name: o.name || "(unnamed)",
      kind: o.isPoints ? "points"
          : o.isLineSegments ? "lineSegments"
          : o.isLine ? "line"
          : o.isSkinnedMesh ? "skinnedMesh"
          : isInstanced ? "instancedMesh" : "mesh",
      isInstanced,
      instanceCount,
      vertices: verts,
      triangles: tris,
      materialCount: mats.length,
      materials: mats,
      geometryUuid: geo?.uuid || null,
      attributeKeys: geo ? Object.keys(geo.attributes || {}) : [],
      hasIndex: !!geo?.index,
      visible: !!o.visible,
      modelIndex: mi,
    };
    meshes.push(meshEntry);
    if (mi >= 0) {
      const ms = modelStats[mi];
      ms.meshes++;
      if (isInstanced) ms.instancedMeshes++;
      ms.instances += isInstanced ? instanceCount : 0;
      ms.vertices  += verts;
      ms.triangles += tris * instanceCount;
      if (geo) ms.geometries.add(geo);
      for (const m of mats) {
        ms.materials.add(m);
        for (const k of TEXTURE_MAP_KEYS) {
          const t = m[k];
          if (t && t.isTexture) {
            let entry = ms.textures.get(t);
            if (!entry) { entry = { count: 0, refKeys: new Set() }; ms.textures.set(t, entry); }
            entry.count++;
            entry.refKeys.add(k);
          }
        }
      }
      ms.meshList.push(meshEntry);
    }
  });

  return {
    nodeCount,
    meshes,
    lights,
    cameras,
    uniqueGeometries: geometries.size,
    uniqueMaterials: materials.size,
    uniqueTextures: textures.size,
    totalVerts,
    totalTris,
    totalInstances,
    drawCallEstimate,
    textures: [...textures.entries()].map(([t, info]) => textureSummary(t, info)),
    models: modelStats.map((ms) => ({
      label: ms.label,
      source: ms.source,
      kind: ms.kind,
      rootName: ms.rootName,
      visible: ms.visible,
      nodes: ms.nodes,
      meshes: ms.meshes,
      instancedMeshes: ms.instancedMeshes,
      instances: ms.instances,
      vertices: ms.vertices,
      triangles: ms.triangles,
      uniqueGeometries: ms.geometries.size,
      uniqueMaterials: ms.materials.size,
      uniqueTextures: ms.textures.size,
      meshList: ms.meshList,
      textures: [...ms.textures.entries()].map(([t, info]) => textureSummary(t, info)),
    })),
  };
}

function textureSummary(t, info) {
  return {
    texture: t,
    count: info.count,
    refKeys: [...info.refKeys],
    width:  t.image?.width  || t.source?.data?.width  || 0,
    height: t.image?.height || t.source?.data?.height || 0,
    format: textureFormatLabel(t),
    colorSpace: t.colorSpace || null,
    flipY: !!t.flipY,
    generateMipmaps: !!t.generateMipmaps,
    anisotropy: t.anisotropy || 1,
    isCompressed: !!t.isCompressedTexture,
    name: t.name || "",
  };
}

function computeTriangleCount(o) {
  const geo = o.geometry;
  if (!geo) return 0;
  if (o.isPoints || o.isLine || o.isLineSegments) return 0;
  if (geo.index) return (geo.index.count / 3) | 0;
  const pos = geo.attributes?.position;
  return pos ? (pos.count / 3) | 0 : 0;
}

function textureFormatLabel(t) {
  // Three.js texture format codes vary by renderer; surface what's available.
  // Numeric codes are kept as-is (different in WebGL vs WebGPU enums).
  return t.type != null && t.format != null ? `${t.format}/${t.type}` : (t.format ?? "?");
}

// Singleton-style accessor mirroring the rest of the API.
export function getSceneTracker() {
  const KEY = "__wgla_scene_tracker";
  if (typeof globalThis !== "undefined" && globalThis[KEY]) return globalThis[KEY];
  const t = new SceneTracker();
  if (typeof globalThis !== "undefined") globalThis[KEY] = t;
  return t;
}
