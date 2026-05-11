# webgl-analyzer

A drop-in analyzer for WebGL2 **and** WebGPU scenes. Inspect every program /
pipeline, shader / module, active uniform, buffer, texture, framebuffer, and
per-frame draw call on a page — from a bookmarklet, a `<script>` tag, or a
one-liner pasted in DevTools.

> WebGL2 is the primary WebGL target (WebGL1 is best-effort). The WebGPU side
> is its own analyzer with its own data model — same UI shell.

## What it reports

**Live (per frame, via our own rAF loop)**
- FPS / frame ms
- Draw calls / frame · triangles / lines / points / vertices / frame
- WebGPU: dispatch calls, render passes, compute passes, queue submits, copies

**Totals since attach** — draws, vertices, triangles, lines, points, broken down by draw method.

**Per-frame draw list** — every draw call captured this frame with its program/pipeline, mode/topology, primitives, vertices, instances. Click any row to jump to its program/pipeline detail.

**WebGL inventory**
- Programs · shaders · buffers (target-classified) · textures · framebuffers · renderbuffers · VAOs · samplers · transform feedbacks · queries · sync objects
- Buffers: target (`ARRAY_BUFFER` / `ELEMENT_ARRAY_BUFFER` / `UNIFORM_BUFFER` / `TRANSFORM_FEEDBACK_BUFFER` / pixel pack/unpack / copy r/w), size, usage hint
- Textures: target, size (incl. depth for 3D / array), internalFormat, mipmap
- Framebuffers: attachments (color N / depth / stencil) cross-referenced to texture or renderbuffer ids
- Renderbuffers: format, size, samples
- Per program: live uniform values, active attributes with locations, full vertex + fragment shader source

**WebGPU inventory**
- Buffers (size + decoded usage flags: `VERTEX` / `INDEX` / `UNIFORM` / `STORAGE` / `INDIRECT` / `MAP_*` / `COPY_*` / `QUERY_RESOLVE`)
- Textures (format, dimension, size, mip levels, sample count, decoded usage flags)
- Samplers (filter/address modes)
- Shader modules (full WGSL source)
- Render pipelines (topology, cull, front-face, multisample, vertex/fragment entry points and buffer layouts, depth/stencil format)
- Compute pipelines (entry point + module link)
- Bind groups + bind group layouts (entries summarized)
- Query sets · external textures

## Layout

```
src/
  core/
    primitives.js   draw mode → (kind, primCount, vertCount, instances)
    frame.js        own rAF loop driving per-frame stat flush
    instrument.js   patches HTMLCanvasElement.getContext + per-context method patches
    extract.js      snapshot a context → plain JSON-safe object
    report.js       pretty console.group printer
    gl-types.js     GLenum → human name
    analyzer.js     WebGL Analyzer + record shape + stable id helper
  core-webgpu/
    primitives.js   topology → primitive math + usage-flag decoding
    instrument.js   patches navigator.gpu + device + encoders + passes + queue
    extract.js      snapshot a device → plain JSON-safe object
    analyzer.js     WebGPUAnalyzer (sibling to WebGL Analyzer)
  ui/
    hud.js          tabbed floating panel (Live / Frame / Programs / Resources / GPU)
  index.js          library entry → window.WebGLAnalyzer (+ window.WebGPUAnalyzer)
  bookmarklet.js    bookmarklet entry — auto-install + HUD
build.mjs           esbuild build (library + bookmarklet + javascript: URL)
demo/
  index.html        WebGL2 demo — indexed mesh → FBO → post-process
  webgpu.html       WebGPU demo — render pipeline + compute pipeline
```

## Build

```sh
pnpm install
pnpm build
pnpm serve            # http://localhost:8080/demo/
```

| file                       | what                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `dist/webgl-analyzer.js`     | readable IIFE, exposes `WebGLAnalyzer` + `WebGPUAnalyzer`     |
| `dist/webgl-analyzer.min.js` | minified IIFE                                                 |
| `dist/bookmarklet.js`        | minified IIFE, auto-runs on load                              |
| `dist/bookmarklet.url.txt`   | `javascript:` URL — paste as a bookmark URL                   |

## Use as a library

```html
<script src="dist/webgl-analyzer.js"></script>
<script>WebGLAnalyzer.install(); WebGLAnalyzer.showHUD();</script>
<!-- your scene script(s) here -->
```

Console:
```js
WebGLAnalyzer.report();              // pretty console output for both
WebGLAnalyzer.data();                // { webgl, webgpu } JSON-safe snapshot
WebGLAnalyzer.download();            // save snapshot
WebGLAnalyzer.reset();               // clear counters, keep resources
```

## Use as a bookmarklet

1. `pnpm build`
2. Copy contents of `dist/bookmarklet.url.txt` → new bookmark URL.
3. Click on any page. HUD appears top-right.

Re-clicking re-scans and re-mounts the HUD. If the scene was already running when you clicked, the analyzer captures currently-bound resources on attach and picks up the rest as the app re-binds them on subsequent frames.

## API

```ts
WebGLAnalyzer.install()              // patches getContext for webgl/webgl2/webgpu
WebGLAnalyzer.scan()                 // re-walk DOM for canvases
WebGLAnalyzer.attach(gl, canvas?)    // manual attach to a known WebGL context
WebGLAnalyzer.report()               // pretty console output
WebGLAnalyzer.data()                 // { webgl, webgpu } snapshot
WebGLAnalyzer.download(filename?)    // save snapshot as JSON
WebGLAnalyzer.reset()                // clear counters
WebGLAnalyzer.showHUD() / hideHUD()  // tabbed live panel
WebGLAnalyzer.webgl                  // the underlying WebGL Analyzer (.onFrame, .records)
WebGLAnalyzer.webgpu                 // the underlying WebGPUAnalyzer
```

The HUD is a tabbed panel:

- **Live** — FPS, frame ms, draws/tris/verts/frame, inventory counts, totals. WebGPU summary at the bottom when present.
- **Frame** — every draw call captured this frame. Click a row → jump to its program/pipeline detail.
- **Programs** — list of WebGL programs. Click → live uniforms + attribs + shader sources.
- **Resources** — buffers / textures / framebuffers / renderbuffers. Click → detail view (framebuffer attachments link to their texture/renderbuffer rows).
- **GPU** — WebGPU device summary, render & compute pipelines, buffers, textures, shader modules. Click → detail view (pipeline → click module → WGSL source).

## Snapshot shape

```jsonc
{
  "webgl": {
    "timestamp": "…", "url": "…",
    "contexts": [{
      "version": "webgl2",
      "frame":     { "fps": 60, "drawCalls": 2, "triangles": 3201,
                     "draws": [{ "method": "drawElements", "programId": "p0",
                                 "mode": "TRIANGLES", "primitives": 3200,
                                 "vertices": 9600, "instances": 1 }] },
      "totals":    { "drawCalls": 1200, "triangles": 1920800, "…": "…" },
      "inventory": { "programs": 2, "buffers": 4, "textures": 2, "framebuffers": 1, "…": "…" },
      "buffers":   [{ "id": "b0", "target": "ARRAY_BUFFER", "size": 13448, "usage": "STATIC_DRAW" }],
      "textures":  [{ "id": "t0", "target": "TEXTURE_2D", "width": 256, "height": 256, "internalFormat": "RGBA" }],
      "framebuffers": [{ "id": "f0", "attachments": { "COLOR0": { "kind": "texture", "texture": "t1", "level": 0 },
                                                       "DEPTH":  { "kind": "renderbuffer", "renderbuffer": "r0" } } }],
      "programs":  [{ "id": "p0", "active": true, "linked": true, "drawCalls": 600,
                      "uniforms": [{ "name": "uColor", "type": "FLOAT_VEC3", "value": [0.2, 0.7, 1.0] }],
                      "attribs":  [{ "name": "aPos",   "type": "FLOAT_VEC2", "location": 0 }],
                      "shaders":  [{ "type": "VERTEX_SHADER", "source": "…", "compiled": true }] }]
    }]
  },
  "webgpu": {
    "timestamp": "…", "url": "…",
    "devices": [{
      "adapterInfo": { "vendor": "…", "architecture": "…" },
      "frame":     { "drawCalls": 1, "dispatchCalls": 1, "renderPasses": 1, "computePasses": 1,
                     "draws":     [{ "method": "drawIndexed", "pipelineId": "rp0",
                                     "topology": "triangle-list", "primitives": 1, "vertices": 3 }],
                     "dispatches":[{ "method": "dispatchWorkgroups", "pipelineId": "cp0",
                                     "x": 256, "y": 1, "z": 1, "workgroups": 256 }] },
      "inventory": { "buffers": 4, "textures": 0, "renderPipelines": 1, "computePipelines": 1,
                     "shaderModules": 2, "buffersByKind": { "VERTEX": 1, "INDEX": 1, "UNIFORM": 1, "STORAGE": 1 } },
      "buffers":   [{ "id": "b0", "label": "triangle-vbo", "size": 60, "usageFlags": ["COPY_DST", "VERTEX"] }],
      "renderPipelines": [{
        "id": "rp0", "topology": "triangle-list",
        "vertex":   { "moduleId": "sh0", "entryPoint": "vs", "buffers": [{ "arrayStride": 20, "attributes": [{ "shaderLocation": 0, "format": "float32x2", "offset": 0 }] }] },
        "fragment": { "moduleId": "sh0", "entryPoint": "fs", "targets": [{ "format": "bgra8unorm" }] }
      }],
      "computePipelines": [{ "id": "cp0", "compute": { "moduleId": "sh1", "entryPoint": "main" } }],
      "shaderModules":    [{ "id": "sh0", "label": "triangle-shader", "code": "/* WGSL */" }]
    }]
  }
}
```

## Caveats

- Best results when loaded **before** the WebGL/WebGPU context is created. Late attach still works — we capture currently-bound resources at attach time and pick the rest up as the app re-binds them on subsequent frames.
- FPS is measured from our own rAF loop, so it approximates display refresh rate. If the app stops rendering, FPS stays at refresh rate but `draws/frame` drops to 0 — watch that to know whether the scene is live.
- WebGPU has no synchronous reflection for bind group resources or buffer contents. Live uniform values are a WebGL-only feature; for WebGPU you see pipeline/module descriptors, not runtime bindings.
- Bookmarklet URL is ~90 kB minified. Chrome/Safari handle this fine; older Firefox versions truncate at 64 kB — use the `<script src>` form there.

## Roadmap

- **Shader source de-dup + diffing** across programs / modules
- **Export shaders** as individual `.vert` / `.frag` / `.wgsl` files
- **Per-draw uniform diff** (cheap state-change tracking between draws in a frame)
- **Frame timeline** — visualize the order of passes/draws within a frame
- **GPU resource graph** — render-pipeline → bind-group → buffer/texture topology view
- **Bind group resource backref** — track GPUTextureView → GPUTexture cross-references for the WebGPU side
