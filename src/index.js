// Library entry. Exposes `window.WebGLAnalyzer` (and `window.WebGPUAnalyzer`
// when the platform supports it).
//
//   <script src="gpu-probe.js"></script>
//   <script>
//     WebGLAnalyzer.install();   // patches getContext (webgl, webgl2, webgpu)
//     WebGLAnalyzer.showHUD();   // tabbed live panel
//   </script>
//
// Load BEFORE the app creates its WebGL/WebGPU context for full coverage.

import { Analyzer, getAnalyzer } from "./core/analyzer.js";
import { WebGPUAnalyzer, getWebGPUAnalyzer } from "./core-webgpu/analyzer.js";
import { getSceneTracker } from "./core/scene.js";
import { mountHUD, unmountHUD } from "./ui/hud.js";

const webgl  = getAnalyzer();
const webgpu = getWebGPUAnalyzer();
const scenes = getSceneTracker();

const api = {
  version: "0.2.0",
  // analyzers
  webgl, webgpu, scenes,
  Analyzer, WebGPUAnalyzer,
  instance: webgl,   // backwards compat with v0.1

  // unified controls
  install:   () => { webgl.install(); webgpu.install(); return api; },
  uninstall: () => { webgl.uninstall(); /* webgpu is sticky */ return api; },
  scan:      () => { webgl.scan(); return api; },
  attach:    (gl, canvas, version) => webgl.attach(gl, canvas, version),
  // Three.js scene attach — backend-agnostic; works for WebGLRenderer and WebGPURenderer.
  attachScene: (scene, opts) => { scenes.attach(scene, opts); return api; },
  detachScene: (scene)        => { scenes.detach(scene); return api; },
  // Tag a loaded asset root (e.g. gltf.scene) so the Scene tab can group its
  // meshes/textures separately from procedural primitives.
  attachModel: (root, opts)   => { scenes.attachModel(root, opts); return api; },
  detachModel: (root)         => { scenes.detachModel(root); return api; },
  data:      () => ({ webgl: webgl.data(), webgpu: webgpu.data() }),
  report:    () => { webgl.report(); if (webgpu.records.size) webgpu.report(); },
  download:  (filename = "wgl-analyzer.json") => {
    const data = api.data();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  reset:     () => { webgl.reset(); webgpu.reset(); return api; },
  showHUD:   () => mountHUD({ webgl, webgpu, scenes }),
  hideHUD:   () => unmountHUD(),
};

if (typeof globalThis !== "undefined") {
  globalThis.WebGLAnalyzer = api;
  globalThis.WebGPUAnalyzer = webgpu;
}

export default api;
