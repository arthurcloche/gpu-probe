// Tiny bookmarklet stub. Loads the full analyzer from jsDelivr, then mounts
// the HUD and runs the same auto-detection as the inlined bookmarklet.
//
// Why: the inlined bookmarklet is ~150 kB URL-encoded — fine for Chrome but
// fragile across browsers. This stub stays under ~2 kB so it pastes anywhere,
// and the actual code is fetched from CDN so updates ship via `git push`.

(function () {
  const CDN = "https://cdn.jsdelivr.net/gh/arthurcloche/gpu-probe@main/dist/gpu-probe.min.js";
  const SCAN_DEPTH = 4;
  const MAX_KEYS = 400;

  function boot() {
    const api = window.GPUProbe;
    if (!api) return;
    api.install();
    if (typeof api.scan === "function") api.scan();
    autoScan(api);
    api.showHUD();
    startPeriodicScan(api);
    console.log("%c[gpu-probe]%c installed via CDN. Use `GPUProbe.attachScene(scene)` if your scene isn't on window.",
      "color:#0bf;font-weight:bold", "color:#888");
  }

  function looksLikeScene(o) {
    return o && typeof o === "object" && o.isScene === true && typeof o.traverse === "function";
  }
  function looksLikeGLTFRoot(o) {
    if (!o || typeof o !== "object" || o.isObject3D !== true) return false;
    return !!(o.userData && (o.userData.gltfExtensions || o.userData.gltfAsset));
  }
  function scan(obj, depth, visited, api) {
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
        api.attachScene(v, { label: v.name || k });
        try {
          for (const child of v.children || []) {
            if (looksLikeGLTFRoot(child)) {
              api.attachModel(child, { label: child.name || "gltf", kind: "glb" });
            }
          }
        } catch (_) {}
      } else if (looksLikeGLTFRoot(v)) {
        api.attachModel(v, { label: v.name || k, kind: "glb" });
      } else if (depth > 0) {
        scan(v, depth - 1, visited, api);
      }
    }
  }
  function autoScan(api) {
    try { scan(globalThis, SCAN_DEPTH, new WeakSet(), api); } catch (_) {}
  }
  function startPeriodicScan(api) {
    let n = 0;
    const id = setInterval(() => {
      autoScan(api);
      if (++n >= 30 || (api.scenes && api.scenes.scenes && api.scenes.scenes.length > 0)) clearInterval(id);
    }, 1000);
  }

  // Already loaded? Just re-mount.
  if (window.GPUProbe && typeof window.GPUProbe.showHUD === "function") {
    boot();
    return;
  }
  const s = document.createElement("script");
  s.src = CDN;
  s.onload = boot;
  s.onerror = () => console.error("[gpu-probe] failed to load from " + CDN);
  document.head.appendChild(s);
})();
