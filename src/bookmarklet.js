// Bookmarklet entry. Auto-installs both analyzers, mounts the live HUD.

import { getAnalyzer } from "./core/analyzer.js";
import { getWebGPUAnalyzer } from "./core-webgpu/analyzer.js";
import { mountHUD } from "./ui/hud.js";

const webgl  = getAnalyzer().install();
const webgpu = getWebGPUAnalyzer().install();

function mount() { mountHUD({ webgl, webgpu }); }
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}

if (typeof globalThis !== "undefined") {
  globalThis.GPUProbe = {
    webgl, webgpu,
    install:  () => { webgl.install(); webgpu.install(); },
    scan:     () => webgl.scan(),
    report:   () => { webgl.report(); if (webgpu.records.size) webgpu.report(); },
    data:     () => ({ webgl: webgl.data(), webgpu: webgpu.data() }),
    reset:    () => { webgl.reset(); webgpu.reset(); },
    showHUD:  () => mountHUD({ webgl, webgpu }),
  };
}

console.log(
  "%c[gpu-probe]%c installed. Use the HUD or `GPUProbe.report()`.",
  "color:#0bf;font-weight:bold",
  "color:#888"
);
