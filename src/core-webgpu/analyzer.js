// analyzer.js (WebGPU)
// One WebGPUAnalyzer per page. Tracks all GPUDevice objects + their resources,
// drives per-frame stat flush via the shared frame ticker.

import { patchGPU, patchDevice, patchDevicePrototype } from "./instrument.js";
import { extractDevice } from "./extract.js";
import { onFrame } from "../core/frame.js";

const MAX_DRAWS_PER_FRAME = 2000;
const MAX_WARNINGS = 200;

export function idOf(record, resource, prefix) {
  if (!resource) return null;
  let id = record.ids.get(resource);
  if (!id) {
    const n = record.counters[prefix] || 0;
    record.counters[prefix] = n + 1;
    id = `${prefix}${n}`;
    record.ids.set(resource, id);
  }
  return id;
}

export function pushDraw(record, entry) {
  if (record.frame._draws.length < MAX_DRAWS_PER_FRAME) {
    record.frame._draws.push(entry);
  }
}
export function pushDispatch(record, entry) {
  if (record.frame._dispatches.length < MAX_DRAWS_PER_FRAME) {
    record.frame._dispatches.push(entry);
  }
}

// Validation messages and uncaptured errors. Newest first; capped so a
// noisy device doesn't blow up memory.
export function pushWarning(record, w) {
  if (!record) return;
  const entry = { ...w, time: Date.now() };
  // de-dupe identical consecutive messages so a per-frame error doesn't drown the list
  const last = record.warnings[0];
  if (last && last.message === entry.message && last.kind === entry.kind) {
    last.count = (last.count || 1) + 1;
    last.time = entry.time;
    return;
  }
  entry.count = 1;
  record.warnings.unshift(entry);
  if (record.warnings.length > MAX_WARNINGS) record.warnings.length = MAX_WARNINGS;
}

function makeDeviceRecord(device, adapter) {
  return {
    device, adapter,
    canvas: null, canvasFormat: null,
    adapterInfo: adapter?.info ? {
      vendor: adapter.info.vendor || null,
      architecture: adapter.info.architecture || null,
      device: adapter.info.device || null,
      description: adapter.info.description || null,
    } : null,
    ids: new Map(),
    counters: {},
    // resources
    buffers: new Map(),
    textures: new Map(),
    samplers: new Map(),
    shaderModules: new Map(),
    bindGroups: new Map(),
    bindGroupLayouts: new Map(),
    pipelineLayouts: new Map(),
    renderPipelines: new Map(),
    computePipelines: new Map(),
    querySets: new Set(),
    externalTextures: new Set(),
    // accumulating warnings/errors across the lifetime of the device
    warnings: [],
    // live per-frame stats
    frame: {
      fps: 0, frameMs: 0,
      drawCalls: 0, dispatchCalls: 0,
      vertices: 0, triangles: 0, lines: 0, points: 0,
      renderPasses: 0, computePasses: 0,
      submits: 0, copies: 0, workgroups: 0,
      writeBuffer: 0, writeTexture: 0,
      draws: [], dispatches: [], passes: [],
      // accumulators
      _drawCalls: 0, _dispatchCalls: 0,
      _vertices: 0, _triangles: 0, _lines: 0, _points: 0,
      _renderPasses: 0, _computePasses: 0,
      _submits: 0, _copies: 0, _workgroups: 0,
      _writeBuffer: 0, _writeTexture: 0,
      _bundleExecutes: 0,
      _draws: [], _dispatches: [], _passes: [],
    },
    totals: {
      drawCalls: 0, dispatchCalls: 0,
      vertices: 0, triangles: 0, lines: 0, points: 0,
      renderPasses: 0, computePasses: 0,
      submits: 0, copies: 0, workgroups: 0,
      writeBuffer: 0, writeTexture: 0,
    },
  };
}

export class WebGPUAnalyzer {
  constructor() {
    /** @type {Map<GPUDevice, object>} */
    this.records = new Map();
    this._installed = false;
    this._unsubFrame = null;
    this._frameListeners = new Set();
  }

  install() {
    if (this._installed) return this;
    if (typeof navigator === "undefined" || !navigator.gpu) return this;
    this._installed = true;
    patchGPU(
      (device, adapter, desc) => this._onDevice(device, adapter, desc),
      (device, canvas, configureDesc) => this._onContext(device, canvas, configureDesc),
    );
    patchDevicePrototype((device) => this._onDevice(device, null, null));
    this._unsubFrame = onFrame((tick) => this._onTick(tick));
    return this;
  }

  _onDevice(device, adapter) {
    if (this.records.has(device)) return;
    const record = makeDeviceRecord(device, adapter);
    this.records.set(device, record);
    patchDevice(device, record);
  }

  // Retroactive discovery for the bookmarklet case: requestAdapter /
  // requestDevice have already resolved, so install()'s patches never fired.
  // Walk window for live GPUDevice instances and adopt them. Future-created
  // resources won't be visible (they were made before patchDevice ran), but
  // anything created from now on is captured.
  scan() {
    // Prototype patch handles the closure-bound case (next createCommandEncoder
    // call adopts the device). The window-walk below catches devices stashed
    // on globals (debug helpers, library singletons).
    patchDevicePrototype((device) => this._onDevice(device, null, null));
    if (typeof globalThis === "undefined") return this;
    const found = new Set();
    const visited = new WeakSet();
    const SCAN_DEPTH = 4;
    const MAX_KEYS = 400;
    const looksLikeDevice = (o) =>
      o && typeof o === "object" && o.queue && o.features && o.limits &&
      typeof o.createBuffer === "function" && typeof o.createShaderModule === "function";
    const walk = (obj, depth) => {
      if (depth < 0 || !obj || typeof obj !== "object" || visited.has(obj)) return;
      visited.add(obj);
      let keys;
      try { keys = Object.keys(obj); } catch (_) { return; }
      if (keys.length > MAX_KEYS) keys = keys.slice(0, MAX_KEYS);
      for (const k of keys) {
        let v;
        try { v = obj[k]; } catch (_) { continue; }
        if (!v || typeof v !== "object") continue;
        if (looksLikeDevice(v)) { found.add(v); continue; }
        if (depth > 0) walk(v, depth - 1);
      }
    };
    try { walk(globalThis, SCAN_DEPTH); } catch (_) {}
    for (const device of found) this._onDevice(device, null);
    return this;
  }

  _onContext(device, canvas, configureDesc) {
    // device may be wrapped/added later. If we already track it, attach canvas info.
    const record = this.records.get(device);
    if (record) {
      record.canvas = canvas;
      record.canvasFormat = configureDesc?.format || null;
    }
  }

  data() {
    const devices = [];
    for (const [, r] of this.records) devices.push(extractDevice(r));
    return {
      timestamp: new Date().toISOString(),
      url: typeof location !== "undefined" ? location.href : null,
      devices,
    };
  }

  report() {
    const snap = this.data();
    console.log(`%c[wgpu-analyzer]%c ${snap.devices.length} device(s)`,
      "color:#f0c;font-weight:bold", "color:#888");
    for (const d of snap.devices) {
      console.groupCollapsed(`%cdevice  ${d.inventory.buffers}b ${d.inventory.textures}t ${d.inventory.renderPipelines}rp ${d.inventory.computePipelines}cp`,
        "color:#f0c;font-weight:bold");
      console.log("adapter:", d.adapterInfo);
      console.log("frame:", d.frame);
      console.log("totals:", d.totals);
      console.log("inventory:", d.inventory);
      if (d.shaderModules.length) {
        console.groupCollapsed(`shaderModules (${d.shaderModules.length})`);
        for (const s of d.shaderModules) {
          console.groupCollapsed(`${s.id} ${s.label || ""} (${s.sourceLength} chars)`);
          console.log(s.code);
          console.groupEnd();
        }
        console.groupEnd();
      }
      console.groupEnd();
    }
    return snap;
  }

  reset() {
    for (const [, r] of this.records) {
      for (const k of Object.keys(r.totals)) r.totals[k] = 0;
      r.warnings.length = 0;
      for (const [, info] of r.renderPipelines) {
        info._totalDraws = 0; info._totalVerts = 0;
      }
      for (const [, info] of r.computePipelines) {
        info._totalDispatches = 0; info._totalWorkgroups = 0;
      }
    }
  }

  onFrame(fn) {
    this._frameListeners.add(fn);
    return () => this._frameListeners.delete(fn);
  }

  _onTick(tick) {
    for (const [, r] of this.records) {
      r.frame.fps = tick.fps;
      r.frame.frameMs = tick.dt;
      r.frame.drawCalls    = r.frame._drawCalls;
      r.frame.dispatchCalls= r.frame._dispatchCalls;
      r.frame.vertices     = r.frame._vertices;
      r.frame.triangles    = r.frame._triangles;
      r.frame.lines        = r.frame._lines;
      r.frame.points       = r.frame._points;
      r.frame.renderPasses = r.frame._renderPasses;
      r.frame.computePasses= r.frame._computePasses;
      r.frame.submits      = r.frame._submits;
      r.frame.copies       = r.frame._copies;
      r.frame.workgroups   = r.frame._workgroups;
      r.frame.writeBuffer  = r.frame._writeBuffer;
      r.frame.writeTexture = r.frame._writeTexture;
      r.frame.draws        = r.frame._draws;
      r.frame.dispatches   = r.frame._dispatches;
      r.frame.passes       = r.frame._passes;
      r.frame._drawCalls = 0; r.frame._dispatchCalls = 0;
      r.frame._vertices = 0; r.frame._triangles = 0;
      r.frame._lines = 0; r.frame._points = 0;
      r.frame._renderPasses = 0; r.frame._computePasses = 0;
      r.frame._submits = 0; r.frame._copies = 0; r.frame._workgroups = 0;
      r.frame._writeBuffer = 0; r.frame._writeTexture = 0;
      r.frame._bundleExecutes = 0;
      r.frame._draws = []; r.frame._dispatches = []; r.frame._passes = [];
      // per-pipeline per-frame counters
      for (const [, info] of r.renderPipelines) { info._drawsF = 0; info._vertsF = 0; }
      for (const [, info] of r.computePipelines) { info._dispatchesF = 0; info._wgF = 0; }
    }
    for (const fn of this._frameListeners) {
      try { fn(this); } catch (_) {}
    }
  }
}

export function getWebGPUAnalyzer() {
  const KEY = "__wgpua_instance";
  if (typeof globalThis !== "undefined" && globalThis[KEY]) return globalThis[KEY];
  const a = new WebGPUAnalyzer();
  if (typeof globalThis !== "undefined") globalThis[KEY] = a;
  return a;
}
