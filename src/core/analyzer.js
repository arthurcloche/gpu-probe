// analyzer.js
// One Analyzer per page. Holds per-context records, drives the frame ticker
// (which flushes per-frame stat accumulators), and exposes the small public API
// used by the library and bookmarklet entry points.

import { patchContext, patchGetContext, scanCanvases } from "./instrument.js";
import { extractContext } from "./extract.js";
import { printSnapshot } from "./report.js";
import { onFrame } from "./frame.js";

function makeRecord(gl, canvas, version) {
  return {
    gl,
    canvas,
    version:
      version ||
      (typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext
        ? "webgl2"
        : "webgl"),
    // bookkeeping
    currentProgram: null,
    boundFb: {},          // { FRAMEBUFFER: fb, DRAW_FRAMEBUFFER: fb, READ_FRAMEBUFFER: fb }
    boundRb: null,
    // stable ids: resource -> "p0" | "b3" | ...
    ids: new Map(),
    counters: { p: 0, s: 0, b: 0, t: 0, f: 0, r: 0, v: 0 },
    // resources
    programs: new Set(),
    shaders: new Set(),
    buffers: new Map(),           // buffer -> { target, size, usage }
    textures: new Map(),          // texture -> { target, width, height, depth, internalFormat, format, type, mipmap }
    framebuffers: new Map(),      // fb -> { attachments: {[name]: {...}} }
    renderbuffers: new Map(),     // rb -> { internalFormat, width, height, samples }
    vaos: new Set(),
    samplers: new Set(),
    transformFeedbacks: new Set(),
    queries: new Set(),
    syncs: new Set(),
    // counters
    drawCalls: new Map(),         // program -> count
    useProgramCount: new Map(),   // program -> count
    drawCallsByMethod: new Map(), // method -> count
    totalDrawCalls: 0,
    totalVertices: 0,
    totalTriangles: 0,
    totalLines: 0,
    totalPoints: 0,
    // live (per-frame) — _foo are accumulators flushed each tick
    frame: {
      fps: 0, frameMs: 0,
      drawCalls: 0, vertices: 0, triangles: 0, lines: 0, points: 0,
      draws: [],     // snapshot of last completed frame
      _drawCalls: 0, _vertices: 0, _triangles: 0, _lines: 0, _points: 0,
      _draws: [],    // accumulator for current frame (capped)
    },
  };
}

/** Get-or-assign a stable id for a resource within a record. */
export function idOf(record, resource, prefix) {
  if (!resource) return null;
  let id = record.ids.get(resource);
  if (!id) {
    id = `${prefix}${record.counters[prefix]++}`;
    record.ids.set(resource, id);
  }
  return id;
}

const MAX_DRAWS_PER_FRAME = 2000;
export function pushDraw(record, entry) {
  if (record.frame._draws.length < MAX_DRAWS_PER_FRAME) {
    record.frame._draws.push(entry);
  }
}

export class Analyzer {
  constructor() {
    /** @type {Map<WebGLRenderingContext|WebGL2RenderingContext, object>} */
    this.records = new Map();
    this._installed = false;
    this._restoreGetContext = null;
    this._unsubFrame = null;
    this._frameListeners = new Set();   // external subscribers (HUD)
  }

  install() {
    if (this._installed) return this;
    this._installed = true;
    this._restoreGetContext = patchGetContext((gl, canvas, version) => {
      this.attach(gl, canvas, version);
    });
    this._unsubFrame = onFrame((tick) => this._onTick(tick));
    // NOTE: we do NOT call scan() here. scan() probes every <canvas> via
    // getContext("webgl2"), which will *claim* unclaimed canvases as WebGL2
    // and prevent them from later becoming WebGPU contexts. The getContext
    // patch above catches all contexts created AFTER install. Use scan()
    // explicitly (Scan button, bookmarklet) for late-attach cases.
    return this;
  }

  uninstall() {
    if (this._restoreGetContext) this._restoreGetContext();
    if (this._unsubFrame) this._unsubFrame();
    this._restoreGetContext = null;
    this._unsubFrame = null;
    this._installed = false;
    return this;
  }

  scan() {
    scanCanvases((gl, canvas, version) => this.attach(gl, canvas, version));
    return this;
  }

  attach(gl, canvas, version) {
    if (!gl) return null;
    let record = this.records.get(gl);
    if (!record) {
      record = makeRecord(gl, canvas, version);
      this.records.set(gl, record);
    } else if (canvas && !record.canvas) {
      record.canvas = canvas;
    }
    patchContext(gl, record);
    return record;
  }

  /** Snapshot of every attached context. Pure data, JSON-safe. */
  data() {
    const contexts = [];
    for (const [, record] of this.records) {
      contexts.push(extractContext(record.gl, record));
    }
    return {
      timestamp: new Date().toISOString(),
      url: typeof location !== "undefined" ? location.href : null,
      contexts,
    };
  }

  report() {
    const snap = this.data();
    if (!snap.contexts.length) {
      console.warn(
        "[gpu-probe] No WebGL contexts attached. Try analyzer.scan() after the scene renders."
      );
      return snap;
    }
    console.log(
      `%c[gpu-probe]%c ${snap.contexts.length} context(s) on ${snap.url}`,
      "color:#0bf;font-weight:bold",
      "color:#888"
    );
    snap.contexts.forEach((c) => printSnapshot(c));
    return snap;
  }

  download(filename = "gpu-probe.json") {
    const snap = this.data();
    const blob = new Blob([JSON.stringify(snap, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return snap;
  }

  reset() {
    for (const [, r] of this.records) {
      r.drawCalls.clear();
      r.useProgramCount.clear();
      r.drawCallsByMethod.clear();
      r.totalDrawCalls = 0;
      r.totalVertices = 0;
      r.totalTriangles = 0;
      r.totalLines = 0;
      r.totalPoints = 0;
    }
    return this;
  }

  /** Subscribe to per-frame updates. Returns unsubscribe fn. */
  onFrame(fn) {
    this._frameListeners.add(fn);
    return () => this._frameListeners.delete(fn);
  }

  _onTick(tick) {
    // flush per-frame accumulators for each context
    for (const [, r] of this.records) {
      r.frame.fps = tick.fps;
      r.frame.frameMs = tick.dt;
      r.frame.drawCalls = r.frame._drawCalls;
      r.frame.vertices  = r.frame._vertices;
      r.frame.triangles = r.frame._triangles;
      r.frame.lines     = r.frame._lines;
      r.frame.points    = r.frame._points;
      r.frame.draws     = r.frame._draws;
      r.frame._drawCalls = 0;
      r.frame._vertices = 0;
      r.frame._triangles = 0;
      r.frame._lines = 0;
      r.frame._points = 0;
      r.frame._draws = [];
    }
    for (const fn of this._frameListeners) {
      try { fn(this); } catch (_) {}
    }
  }
}

/** Get-or-create the page-global Analyzer instance. */
export function getAnalyzer() {
  const KEY = "__wgla_instance";
  if (typeof globalThis !== "undefined" && globalThis[KEY]) {
    return globalThis[KEY];
  }
  const a = new Analyzer();
  if (typeof globalThis !== "undefined") globalThis[KEY] = a;
  return a;
}
