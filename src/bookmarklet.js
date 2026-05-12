// Bookmarklet entry. Auto-installs both analyzers, mounts the live HUD,
// and best-effort auto-attaches any Three.js scene it can find on window.

import { getAnalyzer } from "./core/analyzer.js";
import { getWebGPUAnalyzer } from "./core-webgpu/analyzer.js";
import { getSceneTracker } from "./core/scene.js";
import { mountHUD } from "./ui/hud.js";

const webgl  = getAnalyzer().install();
const webgpu = getWebGPUAnalyzer().install();
const scenes = getSceneTracker();

// Bookmarklets run AFTER the page created its context — install() only
// patches FUTURE getContext calls, so we also need to scan() existing
// canvases and instrument their gl methods retroactively. Without this the
// Programs / Resources tabs are empty until the user clicks Scan manually.
webgl.scan();

// ─── auto-detect Three.js scenes/models on the page ──────────────────────
// We can't see bundled `THREE`, but Three sets duck-typed flags (.isScene,
// .isObject3D, .userData.gltfExtensions). Walk a handful of likely globals
// and harvest anything that looks like a scene or a gltf root.
// Scenes can live anywhere on window.*. We walk wider/deeper than feels
// strictly comfortable because real-world apps stash refs on framework
// globals (window.app, window.__r, etc.) — depth 4 catches most of them.
const SCAN_DEPTH = 4;
const MAX_KEYS = 400;

function looksLikeScene(o) {
  return o && typeof o === "object" && o.isScene === true && typeof o.traverse === "function";
}
function looksLikeGLTFRoot(o) {
  if (!o || typeof o !== "object") return false;
  if (o.isObject3D !== true) return false;
  if (o.userData && (o.userData.gltfExtensions || o.userData.gltfAsset)) return true;
  // gltf.scene returned by GLTFLoader is an Object3D/Group with .name === "Scene" by convention,
  // but that's flimsy — only count it if its parent is a real Scene.
  return false;
}

function scan(obj, depth, visited) {
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
      scenes.attach(v, { label: v.name || k });
      // walk this scene's children once for gltf-like roots.
      try {
        for (const child of v.children || []) {
          if (looksLikeGLTFRoot(child)) {
            scenes.attachModel(child, { label: child.name || "gltf", kind: "glb" });
          }
        }
      } catch (_) {}
    } else if (looksLikeGLTFRoot(v)) {
      scenes.attachModel(v, { label: v.name || k, kind: "glb" });
    } else if (depth > 0) {
      scan(v, depth - 1, visited);
    }
  }
}

function autoScan() {
  // Use a fresh WeakSet each pass so re-scans pick up newly-assigned globals.
  try { scan(globalThis, SCAN_DEPTH, new WeakSet()); } catch (_) {}
}

// Three.js scenes usually appear only after model loads resolve, which can be
// well after the bookmarklet runs. Keep retrying for a while.
function startPeriodicScan() {
  let n = 0;
  const id = setInterval(() => {
    autoScan();
    if (++n >= 30 || scenes.scenes.length > 0) clearInterval(id);
  }, 1000);
}

function mount() {
  autoScan();
  mountHUD({ webgl, webgpu, scenes });
  startPeriodicScan();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}

if (typeof globalThis !== "undefined") {
  globalThis.GPUProbe = {
    webgl, webgpu, scenes,
    install:  () => { webgl.install(); webgpu.install(); },
    scan:     () => { webgl.scan(); autoScan(); },
    report:   () => { webgl.report(); if (webgpu.records.size) webgpu.report(); },
    data:     () => ({ webgl: webgl.data(), webgpu: webgpu.data() }),
    reset:    () => { webgl.reset(); webgpu.reset(); },
    showHUD:  () => mountHUD({ webgl, webgpu, scenes }),
    attachScene: (scene, opts) => scenes.attach(scene, opts),
    detachScene: (scene)        => scenes.detach(scene),
    attachModel: (root, opts)   => scenes.attachModel(root, opts),
    detachModel: (root)         => scenes.detachModel(root),
  };
}

console.log(
  "%c[gpu-probe]%c installed. Use the HUD or `GPUProbe.report()`.\n" +
  "  · Three.js scenes are auto-detected from window globals.\n" +
  "  · If your scene isn't on window, call `GPUProbe.attachScene(scene)`.",
  "color:#0bf;font-weight:bold",
  "color:#888"
);
