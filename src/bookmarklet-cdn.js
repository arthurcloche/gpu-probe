// Tiny bookmarklet stub. Loads the full analyzer from jsDelivr, then mounts
// the HUD and runs the same auto-detection as the inlined bookmarklet.
//
// Why: the inlined bookmarklet is ~150 kB URL-encoded — fine for Chrome but
// fragile across browsers. This stub stays under ~2 kB so it pastes anywhere,
// and the actual code is fetched from CDN so updates ship via `git push`.

import { scanWindowForScenes, startPeriodicScan } from "./core/scene-scanner.js";

const CDN = "https://cdn.jsdelivr.net/gh/arthurcloche/gpu-probe@main/dist/gpu-probe.min.js";

function boot() {
  const api = window.GPUProbe;
  if (!api) return;
  api.install();
  // install() only catches contexts created AFTER it runs; scan() patches
  // canvases the page already created before the bookmarklet fired.
  api.scan();
  const target = {
    attachScene: (s, opts) => api.attachScene(s, opts),
    attachModel: (m, opts) => api.attachModel(m, opts),
  };
  scanWindowForScenes(target);
  api.showHUD();
  startPeriodicScan(target, () => api.scenes?.scenes?.length > 0);
  console.log("%c[gpu-probe]%c installed via CDN. Use `GPUProbe.attachScene(scene)` if your scene isn't on window.",
    "color:#0bf;font-weight:bold", "color:#888");
}

if (window.GPUProbe && typeof window.GPUProbe.showHUD === "function") {
  boot();
} else {
  const s = document.createElement("script");
  s.src = CDN;
  s.onload = boot;
  s.onerror = () => console.error("[gpu-probe] failed to load from " + CDN);
  document.head.appendChild(s);
}
