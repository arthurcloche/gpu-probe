// Walks window globals looking for Three.js scenes / GLTF roots and hands
// them to a target (the scene tracker, or a GPUProbe-API facade). Bookmarklets
// run after the page is up, so refs live on framework globals like window.app
// or window.__r — depth 4 catches most real apps without exploding the walk.

const SCAN_DEPTH = 4;
const MAX_KEYS = 400;

export function looksLikeScene(o) {
  return o && typeof o === "object" && o.isScene === true && typeof o.traverse === "function";
}

export function looksLikeGLTFRoot(o) {
  if (!o || typeof o !== "object" || o.isObject3D !== true) return false;
  return !!(o.userData && (o.userData.gltfExtensions || o.userData.gltfAsset));
}

// target: { attachScene(scene, opts), attachModel(root, opts) }
function walk(obj, depth, visited, target) {
  if (depth < 0 || !obj || typeof obj !== "object" || visited.has(obj)) return;
  visited.add(obj);
  let keys;
  try { keys = Object.keys(obj); } catch (_) { return; }
  if (keys.length > MAX_KEYS) keys = keys.slice(0, MAX_KEYS);
  for (const k of keys) {
    let v;
    try { v = obj[k]; } catch (_) { continue; }
    if (!v || typeof v !== "object") continue;
    if (looksLikeScene(v)) {
      target.attachScene(v, { label: v.name || k });
      try {
        for (const child of v.children || []) {
          if (looksLikeGLTFRoot(child)) {
            target.attachModel(child, { label: child.name || "gltf", kind: "glb" });
          }
        }
      } catch (_) {}
    } else if (looksLikeGLTFRoot(v)) {
      target.attachModel(v, { label: v.name || k, kind: "glb" });
    } else if (depth > 0) {
      walk(v, depth - 1, visited, target);
    }
  }
}

export function scanWindowForScenes(target) {
  try { walk(globalThis, SCAN_DEPTH, new WeakSet(), target); } catch (_) {}
}

// Scenes typically appear only after model loads resolve, well after the
// bookmarklet runs. Retry for a while, but stop once we find anything.
export function startPeriodicScan(target, hasScene) {
  let n = 0;
  const id = setInterval(() => {
    scanWindowForScenes(target);
    if (++n >= 30 || hasScene()) clearInterval(id);
  }, 1000);
  return () => clearInterval(id);
}
