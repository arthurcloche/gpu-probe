// Bookmarklet entry. Auto-installs both analyzers, mounts the live HUD,
// and best-effort auto-attaches any Three.js scene it can find on window.

import { getAnalyzer } from "./core/analyzer.js";
import { getWebGPUAnalyzer } from "./core-webgpu/analyzer.js";
import { getSceneTracker } from "./core/scene.js";
import { mountHUD } from "./ui/hud.js";
import { scanWindowForScenes, startPeriodicScan } from "./core/scene-scanner.js";

const webgl  = getAnalyzer().install();
const webgpu = getWebGPUAnalyzer().install();
const scenes = getSceneTracker();

// install() only patches FUTURE getContext / requestAdapter calls; the page
// already created its context before the user clicked the bookmarklet, so we
// also scan existing canvases (WebGL) and window globals (WebGPU) to find
// resources retroactively.
webgl.scan();
webgpu.scan();

const scanTarget = {
  attachScene: (s, opts) => scenes.attach(s, opts),
  attachModel: (m, opts) => scenes.attachModel(m, opts),
};

function mount() {
  scanWindowForScenes(scanTarget);
  mountHUD({ webgl, webgpu, scenes });
  startPeriodicScan(scanTarget, () => scenes.scenes.length > 0);
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
    scan:     () => { webgl.scan(); webgpu.scan(); scanWindowForScenes(scanTarget); },
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
