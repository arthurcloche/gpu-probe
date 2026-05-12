// instrument.js (WebGPU)
// Patches navigator.gpu so we instrument every adapter/device/encoder/pass
// returned by the platform. WebGPU surfaces are first-class JS objects with
// methods we can override on the instance level — much friendlier than WebGL.
//
// Patches:
//   navigator.gpu.requestAdapter        -> wraps returned adapter
//   adapter.requestDevice               -> wraps returned device
//   device.createBuffer | createTexture | createSampler |
//          createShaderModule | createBindGroup | createBindGroupLayout |
//          createPipelineLayout | createRenderPipeline(Async) |
//          createComputePipeline(Async) | createCommandEncoder |
//          createRenderBundleEncoder | createQuerySet | importExternalTexture
//   device.queue.submit | writeBuffer | writeTexture
//   commandEncoder.beginRenderPass | beginComputePass | finish | copy*
//   renderPass.setPipeline | draw | drawIndexed | drawIndirect |
//          drawIndexedIndirect | executeBundles | end
//   computePass.setPipeline | dispatchWorkgroups |
//          dispatchWorkgroupsIndirect | end
//   GPUCanvasContext.configure          -> cross-reference device <-> canvas

import { classifyDraw, bufferUsageFlags, textureUsageFlags } from "./primitives.js";
import { idOf, pushDraw, pushDispatch, pushWarning } from "./analyzer.js";

const PATCHED = "__wgpua_patched";

// Module-level WeakMaps so we can resolve back-references that WebGPU
// otherwise hides (texture views, query sets, etc.).
const VIEW_TO_TEXTURE = new WeakMap();   // GPUTextureView -> { texture, viewDesc }

function patchMethod(obj, name, factory) {
  if (!obj || typeof obj[name] !== "function") return;
  const orig = obj[name].bind(obj);
  obj[name] = function (...args) { return factory(orig, args, this); };
}

// ------------------------------------------------------------------
// Entry: patch navigator.gpu

export function patchGPU(onDevice, onContext) {
  if (typeof navigator === "undefined" || !navigator.gpu) return () => {};
  if (navigator.gpu[PATCHED]) return () => {};
  navigator.gpu[PATCHED] = true;

  const origRequestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter = async function (...args) {
    const adapter = await origRequestAdapter(...args);
    if (adapter && !adapter[PATCHED]) instrumentAdapter(adapter, onDevice);
    return adapter;
  };

  // patch HTMLCanvasElement.getContext for 'webgpu' so we associate canvas <-> ctx.
  // It coexists with the WebGL getContext patch (both wrap independently).
  if (typeof HTMLCanvasElement !== "undefined") {
    const proto = HTMLCanvasElement.prototype;
    if (!proto.__wgpua_getContext_patched) {
      const original = proto.getContext;
      proto.getContext = function (type, ...rest) {
        const ctx = original.call(this, type, ...rest);
        if (ctx && type === "webgpu" && !ctx[PATCHED]) {
          instrumentCanvasContext(ctx, this, onContext);
        }
        return ctx;
      };
      proto.__wgpua_getContext_patched = true;
    }
  }

  return () => { /* no-op restore; webgpu lifecycle is sticky */ };
}

function instrumentAdapter(adapter, onDevice) {
  adapter[PATCHED] = true;
  const origReq = adapter.requestDevice.bind(adapter);
  adapter.requestDevice = async function (...args) {
    const device = await origReq(...args);
    if (device && !device[PATCHED]) onDevice(device, adapter, args[0]);
    return device;
  };
}

function instrumentCanvasContext(ctx, canvas, onContext) {
  ctx[PATCHED] = true;
  patchMethod(ctx, "configure", (orig, args) => {
    const desc = args[0];
    if (desc && desc.device) onContext(desc.device, canvas, desc);
    return orig(...args);
  });
}

// Retroactive discovery: many WebGPU apps create the device in a closure that
// is never exposed on window, so the analyzer's window-walk scan never finds
// it. Patching GPUDevice.prototype methods lets us capture `this` the next
// time the page calls any device method (createCommandEncoder fires every
// frame in render loops), at which point we register the device.
export function patchDevicePrototype(onDevice) {
  if (typeof GPUDevice === "undefined") return;
  const proto = GPUDevice.prototype;
  if (proto.__wgpua_proto_patched) return;
  proto.__wgpua_proto_patched = true;
  const methods = [
    "createCommandEncoder", "createBuffer", "createTexture",
    "createBindGroup", "createShaderModule",
    "createRenderPipeline", "createComputePipeline",
  ];
  for (const m of methods) {
    const orig = proto[m];
    if (typeof orig !== "function") continue;
    proto[m] = function (...args) {
      if (!this[PATCHED]) {
        try { onDevice(this, null, null); } catch (_) {}
      }
      return orig.apply(this, args);
    };
  }
}

// ------------------------------------------------------------------
// Patch a GPUDevice (called by the analyzer when a device is created)

export function patchDevice(device, record) {
  if (!device || device[PATCHED]) return false;
  device[PATCHED] = true;

  // ---- error capture --------------------------------------------------
  // The single most useful debugging surface in WebGPU. Every async validation
  // failure surfaces here unless the caller pushes its own error scope.
  try {
    if (typeof device.addEventListener === "function") {
      device.addEventListener("uncapturederror", (ev) => {
        const e = ev?.error;
        pushWarning(record, {
          severity: "error",
          source: "uncapturederror",
          kind: e?.constructor?.name || "GPUError",
          message: String(e?.message || ev?.message || e || "unknown error"),
        });
      });
    }
    if (device.lost && typeof device.lost.then === "function") {
      device.lost.then((info) => {
        pushWarning(record, {
          severity: "error",
          source: "deviceLost",
          kind: "DeviceLost",
          message: `${info?.reason || "unknown"}: ${info?.message || ""}`,
        });
      }, () => {});
    }
  } catch (_) {}

  // ---- resource creation ----------------------------------------------
  patchMethod(device, "createBuffer", (orig, args) => {
    const buf = orig(...args);
    const desc = args[0] || {};
    record.buffers.set(buf, {
      label: desc.label || null,
      size: desc.size || 0,
      usage: desc.usage || 0,
      usageFlags: bufferUsageFlags(desc.usage || 0),
      mappedAtCreation: !!desc.mappedAtCreation,
    });
    idOf(record, buf, "b");
    return buf;
  });

  patchMethod(device, "createTexture", (orig, args) => {
    const tex = orig(...args);
    const desc = args[0] || {};
    const size = normalizeExtent(desc.size);
    record.textures.set(tex, {
      label: desc.label || null,
      width: size.width, height: size.height, depthOrArrayLayers: size.depthOrArrayLayers,
      format: desc.format || null,
      dimension: desc.dimension || "2d",
      mipLevelCount: desc.mipLevelCount || 1,
      sampleCount: desc.sampleCount || 1,
      usage: desc.usage || 0,
      usageFlags: textureUsageFlags(desc.usage || 0),
    });
    idOf(record, tex, "t");
    // Patch createView so we can resolve view -> texture for bind groups
    // and render-pass color attachments.
    if (typeof tex.createView === "function" && !tex[PATCHED]) {
      tex[PATCHED] = true;
      const origView = tex.createView.bind(tex);
      tex.createView = function (vdesc) {
        const v = origView(vdesc);
        try { VIEW_TO_TEXTURE.set(v, { texture: tex, viewDesc: vdesc || null }); } catch (_) {}
        return v;
      };
    }
    return tex;
  });

  patchMethod(device, "createSampler", (orig, args) => {
    const s = orig(...args);
    const desc = args[0] || {};
    record.samplers.set(s, {
      label: desc.label || null,
      magFilter: desc.magFilter || "nearest",
      minFilter: desc.minFilter || "nearest",
      mipmapFilter: desc.mipmapFilter || "nearest",
      addressModeU: desc.addressModeU || "clamp-to-edge",
      addressModeV: desc.addressModeV || "clamp-to-edge",
      addressModeW: desc.addressModeW || "clamp-to-edge",
    });
    idOf(record, s, "s");
    return s;
  });

  patchMethod(device, "createShaderModule", (orig, args) => {
    const mod = orig(...args);
    const desc = args[0] || {};
    record.shaderModules.set(mod, {
      label: desc.label || null,
      code: desc.code || "",
      sourceLength: (desc.code || "").length,
    });
    idOf(record, mod, "sh");
    return mod;
  });

  patchMethod(device, "createBindGroupLayout", (orig, args) => {
    const o = orig(...args);
    const desc = args[0] || {};
    record.bindGroupLayouts.set(o, {
      label: desc.label || null,
      explicit: true,
      entries: (desc.entries || []).map(summarizeBGLEntry),
    });
    idOf(record, o, "bgl");
    return o;
  });

  patchMethod(device, "createBindGroup", (orig, args) => {
    const o = orig(...args);
    const desc = args[0] || {};
    const entries = (desc.entries || []).map((e) => ({
      binding: e.binding,
      resource: summarizeBGResource(record, e.resource),
    }));
    // Register the layout if we haven't seen it. This catches layouts
    // produced by pipeline.getBindGroupLayout(N) (i.e. layout: "auto"),
    // which never go through createBindGroupLayout but are still very
    // much real layout objects we want to count and link to.
    if (desc.layout && !record.bindGroupLayouts.has(desc.layout)) {
      record.bindGroupLayouts.set(desc.layout, {
        label: desc.layout.label || null,
        explicit: false,
        entries: [],
      });
      idOf(record, desc.layout, "bgl");
    }
    record.bindGroups.set(o, {
      label: desc.label || null,
      layout: desc.layout || null,
      layoutId: idOf(record, desc.layout, "bgl") || null,
      entries,
    });
    const bgId = idOf(record, o, "bg");
    // Static validation: when the layout is explicit AND the entries have
    // minBindingSize, verify each buffer binding has enough bytes. Catches
    // exactly the kind of "binding size N is smaller than minimum M" warning
    // WebGPU spits out at draw time.
    validateBindGroupAgainstLayout(record, bgId, desc.label, desc.layout, desc.entries || []);
    return o;
  });

  patchMethod(device, "createPipelineLayout", (orig, args) => {
    const o = orig(...args);
    const desc = args[0] || {};
    record.pipelineLayouts.set(o, {
      label: desc.label || null,
      bindGroupLayoutIds: (desc.bindGroupLayouts || []).map((l) => idOf(record, l, "bgl") || null),
    });
    idOf(record, o, "pl");
    return o;
  });

  patchMethod(device, "createRenderPipeline", (orig, args) => {
    const p = orig(...args);
    record.renderPipelines.set(p, makeRenderPipelineInfo(record, args[0] || {}));
    idOf(record, p, "rp");
    return p;
  });

  patchMethod(device, "createRenderPipelineAsync", async (orig, args) => {
    const p = await orig(...args);
    record.renderPipelines.set(p, makeRenderPipelineInfo(record, args[0] || {}));
    idOf(record, p, "rp");
    return p;
  });

  patchMethod(device, "createComputePipeline", (orig, args) => {
    const p = orig(...args);
    record.computePipelines.set(p, makeComputePipelineInfo(record, args[0] || {}));
    idOf(record, p, "cp");
    return p;
  });

  patchMethod(device, "createComputePipelineAsync", async (orig, args) => {
    const p = await orig(...args);
    record.computePipelines.set(p, makeComputePipelineInfo(record, args[0] || {}));
    idOf(record, p, "cp");
    return p;
  });

  // Pipeline counters live alongside the pipeline info so we don't need a
  // second map. They get reset per frame in analyzer._onTick.
  // (initialised lazily in recordDraw / recordDispatch)

  patchMethod(device, "createQuerySet", (orig, args) => {
    const q = orig(...args);
    record.querySets.add(q);
    idOf(record, q, "qs");
    return q;
  });

  patchMethod(device, "importExternalTexture", (orig, args) => {
    const t = orig(...args);
    record.externalTextures.add(t);
    idOf(record, t, "et");
    return t;
  });

  // ---- command encoder ------------------------------------------------
  patchMethod(device, "createCommandEncoder", (orig, args) => {
    const enc = orig(...args);
    instrumentCommandEncoder(enc, record);
    return enc;
  });

  patchMethod(device, "createRenderBundleEncoder", (orig, args) => {
    const enc = orig(...args);
    instrumentRenderPass(enc, record, /*isBundle*/ true);
    return enc;
  });

  // ---- queue ----------------------------------------------------------
  const queue = device.queue;
  if (queue) {
    patchMethod(queue, "submit", (orig, args) => {
      const [list] = args;
      const n = list ? list.length : 0;
      record.frame._submits += n;
      record.totals.submits += n;
      return orig(...args);
    });
    patchMethod(queue, "writeBuffer", (orig, args) => {
      record.frame._writeBuffer++;
      record.totals.writeBuffer++;
      return orig(...args);
    });
    patchMethod(queue, "writeTexture", (orig, args) => {
      record.frame._writeTexture++;
      record.totals.writeTexture++;
      return orig(...args);
    });
  }

  return true;
}

// ------------------------------------------------------------------
// Encoders / passes

function instrumentCommandEncoder(enc, record) {
  if (!enc || enc[PATCHED]) return;
  enc[PATCHED] = true;

  patchMethod(enc, "beginRenderPass", (orig, args) => {
    const pass = orig(...args);
    record.frame._renderPasses++;
    record.totals.renderPasses++;
    instrumentRenderPass(pass, record, false, args[0]);
    return pass;
  });

  patchMethod(enc, "beginComputePass", (orig, args) => {
    const pass = orig(...args);
    record.frame._computePasses++;
    record.totals.computePasses++;
    instrumentComputePass(pass, record);
    return pass;
  });

  // copy ops — interesting for inventory but cheap to count
  for (const m of ["copyBufferToBuffer", "copyBufferToTexture", "copyTextureToBuffer", "copyTextureToTexture"]) {
    patchMethod(enc, m, (orig, args) => {
      record.frame._copies++;
      record.totals.copies++;
      return orig(...args);
    });
  }
}

function instrumentRenderPass(pass, record, isBundle, beginDesc) {
  if (!pass || pass[PATCHED]) return;
  pass[PATCHED] = true;
  const state = { pipeline: null, indexFormat: null };

  // Snapshot pass attachments so we can show them in the Frame tab.
  if (!isBundle && beginDesc) {
    const passEntry = describeRenderPass(record, beginDesc);
    record.frame._passes.push(passEntry);
    state.passEntry = passEntry;
  }

  patchMethod(pass, "setPipeline", (orig, args) => {
    state.pipeline = args[0];
    return orig(...args);
  });
  patchMethod(pass, "setIndexBuffer", (orig, args) => {
    state.indexFormat = args[1] || null;
    return orig(...args);
  });

  patchMethod(pass, "draw", (orig, args) => {
    const [vertexCount, instanceCount = 1] = args;
    recordDraw(record, state.pipeline, "draw", vertexCount, instanceCount, isBundle, state.passEntry);
    return orig(...args);
  });
  patchMethod(pass, "drawIndexed", (orig, args) => {
    const [indexCount, instanceCount = 1] = args;
    recordDraw(record, state.pipeline, "drawIndexed", indexCount, instanceCount, isBundle, state.passEntry);
    return orig(...args);
  });
  patchMethod(pass, "drawIndirect", (orig, args) => {
    recordDraw(record, state.pipeline, "drawIndirect", 0, 1, isBundle, state.passEntry);
    return orig(...args);
  });
  patchMethod(pass, "drawIndexedIndirect", (orig, args) => {
    recordDraw(record, state.pipeline, "drawIndexedIndirect", 0, 1, isBundle, state.passEntry);
    return orig(...args);
  });

  patchMethod(pass, "executeBundles", (orig, args) => {
    record.frame._bundleExecutes += (args[0]?.length || 0);
    return orig(...args);
  });
}

function instrumentComputePass(pass, record) {
  if (!pass || pass[PATCHED]) return;
  pass[PATCHED] = true;
  const state = { pipeline: null };

  // Mirror render passes: track compute passes for the Frame tab.
  const passEntry = { kind: "compute", label: null, draws: 0, dispatches: 0, attachments: [] };
  record.frame._passes.push(passEntry);
  state.passEntry = passEntry;

  patchMethod(pass, "setPipeline", (orig, args) => {
    state.pipeline = args[0];
    return orig(...args);
  });

  patchMethod(pass, "dispatchWorkgroups", (orig, args) => {
    const [x = 1, y = 1, z = 1] = args;
    recordDispatch(record, state.pipeline, "dispatchWorkgroups", x, y, z, state.passEntry);
    return orig(...args);
  });
  patchMethod(pass, "dispatchWorkgroupsIndirect", (orig, args) => {
    recordDispatch(record, state.pipeline, "dispatchWorkgroupsIndirect", 0, 0, 0, state.passEntry);
    return orig(...args);
  });
}

function recordDraw(record, pipeline, method, count, instances, isBundle, passEntry) {
  const info = pipeline ? record.renderPipelines.get(pipeline) : null;
  const topology = info?.topology || "triangle-list";
  const stats = classifyDraw(topology, count, instances);
  const pipelineId = pipeline ? idOf(record, pipeline, "rp") : null;

  record.frame._drawCalls++;
  record.frame._vertices += stats.vertices;
  if (stats.kind === "triangles") record.frame._triangles += stats.primitives;
  else if (stats.kind === "lines") record.frame._lines += stats.primitives;
  else if (stats.kind === "points") record.frame._points += stats.primitives;

  record.totals.drawCalls++;
  record.totals.vertices += stats.vertices;
  if (stats.kind === "triangles") record.totals.triangles += stats.primitives;
  else if (stats.kind === "lines") record.totals.lines += stats.primitives;
  else if (stats.kind === "points") record.totals.points += stats.primitives;

  // Per-pipeline counters
  if (info) {
    info._drawsF = (info._drawsF || 0) + 1;
    info._vertsF = (info._vertsF || 0) + stats.vertices;
    info._totalDraws = (info._totalDraws || 0) + 1;
    info._totalVerts = (info._totalVerts || 0) + stats.vertices;
  }
  if (passEntry) passEntry.draws++;

  pushDraw(record, {
    method, pipelineId, topology, kind: stats.kind,
    vertices: stats.vertices, primitives: stats.primitives, instances: stats.instances,
    bundle: !!isBundle,
  });
}

function recordDispatch(record, pipeline, method, x, y, z, passEntry) {
  const info = pipeline ? record.computePipelines.get(pipeline) : null;
  const pipelineId = pipeline ? idOf(record, pipeline, "cp") : null;
  const workgroups = (x | 0) * (y | 0) * (z | 0);
  record.frame._dispatchCalls++;
  record.frame._workgroups += workgroups;
  record.totals.dispatchCalls++;
  record.totals.workgroups += workgroups;

  if (info) {
    info._dispatchesF = (info._dispatchesF || 0) + 1;
    info._wgF = (info._wgF || 0) + workgroups;
    info._totalDispatches = (info._totalDispatches || 0) + 1;
    info._totalWorkgroups = (info._totalWorkgroups || 0) + workgroups;
  }
  if (passEntry) passEntry.dispatches++;

  pushDispatch(record, { method, pipelineId, x, y, z, workgroups });
}

// ------------------------------------------------------------------
// Render-pass description (for Frame tab)

function describeRenderPass(record, beginDesc) {
  const colorAttachments = [];
  for (const a of (beginDesc.colorAttachments || [])) {
    if (!a) { colorAttachments.push(null); continue; }
    const info = a.view ? VIEW_TO_TEXTURE.get(a.view) : null;
    const texId = info?.texture ? idOf(record, info.texture, "t") : null;
    const texInfo = info?.texture ? record.textures.get(info.texture) : null;
    colorAttachments.push({
      textureId: texId,
      format: texInfo?.format || null,
      loadOp: a.loadOp || null,
      storeOp: a.storeOp || null,
      isCanvas: !texId, // canvas-derived views aren't tracked, so this is a strong hint
    });
  }
  let depth = null;
  if (beginDesc.depthStencilAttachment) {
    const a = beginDesc.depthStencilAttachment;
    const info = a.view ? VIEW_TO_TEXTURE.get(a.view) : null;
    const texId = info?.texture ? idOf(record, info.texture, "t") : null;
    const texInfo = info?.texture ? record.textures.get(info.texture) : null;
    depth = {
      textureId: texId,
      format: texInfo?.format || null,
      depthLoadOp: a.depthLoadOp || null,
      depthStoreOp: a.depthStoreOp || null,
    };
  }
  return {
    kind: "render",
    label: beginDesc.label || null,
    draws: 0,
    dispatches: 0,
    attachments: colorAttachments,
    depth,
  };
}

// ------------------------------------------------------------------
// Static bind-group validation
//
// Catches "binding size N is smaller than the minimum M" before WebGPU
// would. Only fires when the bind-group layout is explicit (the user
// constructed it via createBindGroupLayout); auto layouts don't expose
// minBindingSize so the runtime uncapturederror handler is the fallback.

function validateBindGroupAgainstLayout(record, bgId, bgLabel, layout, entries) {
  if (!layout) return;
  const layoutInfo = record.bindGroupLayouts.get(layout);
  if (!layoutInfo || !layoutInfo.explicit) return;
  const byBinding = new Map();
  for (const le of layoutInfo.entries) byBinding.set(le.binding, le);
  for (const e of entries) {
    const le = byBinding.get(e.binding);
    if (!le) continue;
    if (le.kind !== "buffer") continue;
    const minBindingSize = le.detail?.minBindingSize || 0;
    if (!minBindingSize) continue;
    const res = e.resource;
    if (!res || !res.buffer) continue;
    const bufInfo = record.buffers.get(res.buffer);
    if (!bufInfo) continue;
    const offset = (res.offset | 0) || 0;
    const declared = res.size != null ? (res.size | 0) : (bufInfo.size - offset);
    if (declared < minBindingSize) {
      pushWarning(record, {
        severity: "error",
        source: "static",
        kind: "BindingSizeTooSmall",
        message: `bind group ${bgId}${bgLabel ? ` "${bgLabel}"` : ""}: entry @binding(${e.binding}) bound buffer slice is ${declared}B, layout requires minBindingSize ${minBindingSize}B`,
        refs: { bindGroup: bgId, binding: e.binding, buffer: idOf(record, res.buffer, "b") },
      });
    }
  }
}

// ------------------------------------------------------------------
// helpers

function normalizeExtent(size) {
  if (Array.isArray(size)) {
    return { width: size[0] | 0, height: (size[1] | 0) || 1, depthOrArrayLayers: (size[2] | 0) || 1 };
  }
  return {
    width: (size?.width | 0) || 1,
    height: (size?.height | 0) || 1,
    depthOrArrayLayers: (size?.depthOrArrayLayers | 0) || 1,
  };
}

function makeRenderPipelineInfo(record, desc) {
  return {
    label: desc.label || null,
    topology: desc.primitive?.topology || "triangle-list",
    cullMode: desc.primitive?.cullMode || "none",
    frontFace: desc.primitive?.frontFace || "ccw",
    layoutKind: desc.layout === "auto" ? "auto" : "explicit",
    vertex: desc.vertex ? {
      moduleId: idOf(record, desc.vertex.module, "sh") || null,
      entryPoint: desc.vertex.entryPoint || null,
      buffers: (desc.vertex.buffers || []).map((b) => ({
        arrayStride: b?.arrayStride ?? 0,
        stepMode: b?.stepMode || "vertex",
        attributes: (b?.attributes || []).map((a) => ({
          shaderLocation: a.shaderLocation, format: a.format, offset: a.offset,
        })),
      })),
    } : null,
    fragment: desc.fragment ? {
      moduleId: idOf(record, desc.fragment.module, "sh") || null,
      entryPoint: desc.fragment.entryPoint || null,
      targets: (desc.fragment.targets || []).map((t) => ({
        format: t?.format || null,
        blend: !!t?.blend,
      })),
    } : null,
    depthStencil: desc.depthStencil ? {
      format: desc.depthStencil.format || null,
      depthWriteEnabled: !!desc.depthStencil.depthWriteEnabled,
      depthCompare: desc.depthStencil.depthCompare || null,
    } : null,
    multisample: desc.multisample ? {
      count: desc.multisample.count || 1,
    } : { count: 1 },
  };
}

function makeComputePipelineInfo(record, desc) {
  return {
    label: desc.label || null,
    layoutKind: desc.layout === "auto" ? "auto" : "explicit",
    compute: desc.compute ? {
      moduleId: idOf(record, desc.compute.module, "sh") || null,
      entryPoint: desc.compute.entryPoint || null,
    } : null,
  };
}

function summarizeBGLEntry(e) {
  const t = e.buffer ? "buffer"
          : e.sampler ? "sampler"
          : e.texture ? "texture"
          : e.storageTexture ? "storageTexture"
          : e.externalTexture ? "externalTexture"
          : "unknown";
  return {
    binding: e.binding,
    visibility: visibilityFlags(e.visibility),
    kind: t,
    detail: e[t] ? { ...e[t] } : null,
  };
}

function visibilityFlags(mask) {
  const out = [];
  if (mask & 0x1) out.push("VERTEX");
  if (mask & 0x2) out.push("FRAGMENT");
  if (mask & 0x4) out.push("COMPUTE");
  return out;
}

function summarizeBGResource(record, res) {
  if (!res) return null;
  // { buffer, offset?, size? }
  if (res.buffer) {
    return {
      kind: "bufferBinding",
      buffer: res.buffer,                              // raw object, used for static validation
      bufferId: idOf(record, res.buffer, "b") || null,
      offset: res.offset || 0,
      size: res.size || null,
    };
  }
  // Texture view -> resolved back to its texture via VIEW_TO_TEXTURE
  if (typeof GPUTextureView !== "undefined" && res instanceof GPUTextureView) {
    const lineage = VIEW_TO_TEXTURE.get(res);
    return {
      kind: "textureView",
      label: res.label || null,
      textureId: lineage?.texture ? idOf(record, lineage.texture, "t") : null,
      viewDesc: lineage?.viewDesc || null,
    };
  }
  if (typeof GPUSampler !== "undefined" && res instanceof GPUSampler) {
    return { kind: "sampler", id: idOf(record, res, "s") || null };
  }
  if (typeof GPUExternalTexture !== "undefined" && res instanceof GPUExternalTexture) {
    return { kind: "externalTexture", id: idOf(record, res, "et") || null };
  }
  return { kind: "unknown" };
}
