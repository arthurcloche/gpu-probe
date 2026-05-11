// instrument.js
// Patches a WebGL/WebGL2 context to observe:
//   - program lifecycle (useProgram / linkProgram)
//   - draw calls (with primitive accounting)
//   - resource creation/deletion (buffers, textures, framebuffers, renderbuffers,
//     vaos, samplers, transform feedbacks, queries, sync)
//   - resource binding (so we can learn buffer/texture targets)
//   - resource sizing (bufferData, texImage*, texStorage*, renderbufferStorage*)
//   - framebuffer attachments (framebufferTexture2D / framebufferRenderbuffer /
//     framebufferTextureLayer)
//
// All wrappers are idempotent: re-patching the same context is a no-op.

import { classifyDraw } from "./primitives.js";
import { idOf, pushDraw } from "./analyzer.js";

const PATCHED = "__wgla_patched";
const ORIGINALS = "__wgla_originals";

const DRAW_METHODS = [
  "drawArrays",
  "drawElements",
  "drawArraysInstanced",
  "drawElementsInstanced",
  "drawRangeElements",
];

// --- helpers --------------------------------------------------------------

function wrap(gl, name, fn, originals) {
  if (typeof gl[name] !== "function") return;
  const orig = gl[name].bind(gl);
  originals[name] = orig;
  gl[name] = function (...args) {
    return fn(orig, args);
  };
}

function bufferTargetName(gl, target) {
  if (target === gl.ARRAY_BUFFER) return "ARRAY_BUFFER";
  if (target === gl.ELEMENT_ARRAY_BUFFER) return "ELEMENT_ARRAY_BUFFER";
  if (target === gl.UNIFORM_BUFFER) return "UNIFORM_BUFFER";
  if (target === gl.COPY_READ_BUFFER) return "COPY_READ_BUFFER";
  if (target === gl.COPY_WRITE_BUFFER) return "COPY_WRITE_BUFFER";
  if (target === gl.PIXEL_PACK_BUFFER) return "PIXEL_PACK_BUFFER";
  if (target === gl.PIXEL_UNPACK_BUFFER) return "PIXEL_UNPACK_BUFFER";
  if (target === gl.TRANSFORM_FEEDBACK_BUFFER) return "TRANSFORM_FEEDBACK_BUFFER";
  return `0x${target.toString(16)}`;
}

function textureTargetName(gl, target) {
  if (target === gl.TEXTURE_2D) return "TEXTURE_2D";
  if (target === gl.TEXTURE_CUBE_MAP) return "TEXTURE_CUBE_MAP";
  if (target === gl.TEXTURE_2D_ARRAY) return "TEXTURE_2D_ARRAY";
  if (target === gl.TEXTURE_3D) return "TEXTURE_3D";
  // Cube map face targets (0x8515..0x851A) -> normalize to CUBE_MAP
  if (target >= 0x8515 && target <= 0x851a) return "TEXTURE_CUBE_MAP";
  return `0x${target.toString(16)}`;
}

function fbTargetName(gl, target) {
  if (target === gl.FRAMEBUFFER) return "FRAMEBUFFER";
  if (target === gl.DRAW_FRAMEBUFFER) return "DRAW_FRAMEBUFFER";
  if (target === gl.READ_FRAMEBUFFER) return "READ_FRAMEBUFFER";
  return `0x${target.toString(16)}`;
}

function attachmentName(gl, attachment) {
  if (attachment === gl.DEPTH_ATTACHMENT) return "DEPTH";
  if (attachment === gl.STENCIL_ATTACHMENT) return "STENCIL";
  if (attachment === gl.DEPTH_STENCIL_ATTACHMENT) return "DEPTH_STENCIL";
  if (attachment >= gl.COLOR_ATTACHMENT0 && attachment <= gl.COLOR_ATTACHMENT0 + 31) {
    return `COLOR${attachment - gl.COLOR_ATTACHMENT0}`;
  }
  return `0x${attachment.toString(16)}`;
}

function sourceDimensions(source) {
  if (!source) return null;
  if (typeof source.width === "number" && typeof source.height === "number") {
    // HTMLImageElement uses naturalWidth/Height pre-load; fall back to width/height.
    const w = source.naturalWidth || source.videoWidth || source.width;
    const h = source.naturalHeight || source.videoHeight || source.height;
    if (w && h) return { width: w, height: h };
  }
  return null;
}

// --- main entry -----------------------------------------------------------

export function patchContext(gl, record) {
  if (!gl || gl[PATCHED]) return false;
  const originals = {};

  // ---------- programs & draws ----------

  wrap(gl, "useProgram", (orig, [program]) => {
    if (program) {
      record.programs.add(program);
      idOf(record, program, "p");
      record.useProgramCount.set(
        program,
        (record.useProgramCount.get(program) || 0) + 1
      );
      record.currentProgram = program;
    } else {
      record.currentProgram = null;
    }
    return orig(program);
  }, originals);

  wrap(gl, "linkProgram", (orig, args) => {
    const [program] = args;
    if (program) {
      record.programs.add(program);
      idOf(record, program, "p");
    }
    return orig(...args);
  }, originals);

  wrap(gl, "createShader", (orig, args) => {
    const s = orig(...args);
    if (s) { record.shaders.add(s); idOf(record, s, "s"); }
    return s;
  }, originals);

  wrap(gl, "deleteShader", (orig, args) => {
    record.shaders.delete(args[0]); record.ids.delete(args[0]);
    return orig(...args);
  }, originals);

  wrap(gl, "deleteProgram", (orig, args) => {
    const p = args[0];
    record.programs.delete(p);
    record.drawCalls.delete(p);
    record.useProgramCount.delete(p);
    record.ids.delete(p);
    return orig(...args);
  }, originals);

  // ---------- draw calls (with primitive accounting) ----------

  for (const method of DRAW_METHODS) {
    if (typeof gl[method] !== "function") continue;
    wrap(gl, method, (orig, args) => {
      // (mode, first, count [, instanceCount])         drawArrays / drawArraysInstanced
      // (mode, count, type, offset [, instanceCount])  drawElements / drawElementsInstanced
      // (mode, start, end, count, type, offset)        drawRangeElements
      let mode, count, instances = 1;
      if (method === "drawArrays") {
        mode = args[0]; count = args[2];
      } else if (method === "drawArraysInstanced") {
        mode = args[0]; count = args[2]; instances = args[3];
      } else if (method === "drawElements") {
        mode = args[0]; count = args[1];
      } else if (method === "drawElementsInstanced") {
        mode = args[0]; count = args[1]; instances = args[4];
      } else if (method === "drawRangeElements") {
        mode = args[0]; count = args[3];
      }
      const stats = classifyDraw(mode, count, instances);

      const prog = record.currentProgram || gl.getParameter(gl.CURRENT_PROGRAM);
      let programId = null;
      if (prog) {
        record.programs.add(prog);
        programId = idOf(record, prog, "p");
        record.drawCalls.set(prog, (record.drawCalls.get(prog) || 0) + 1);
      }
      record.drawCallsByMethod.set(
        method,
        (record.drawCallsByMethod.get(method) || 0) + 1
      );

      // totals
      record.totalDrawCalls++;
      record.totalVertices += stats.vertices;
      if (stats.kind === "triangles") record.totalTriangles += stats.primitives;
      else if (stats.kind === "lines") record.totalLines += stats.primitives;
      else if (stats.kind === "points") record.totalPoints += stats.primitives;

      // current-frame accumulators (flushed by frame ticker in analyzer.js)
      record.frame._drawCalls++;
      record.frame._vertices += stats.vertices;
      if (stats.kind === "triangles") record.frame._triangles += stats.primitives;
      else if (stats.kind === "lines") record.frame._lines += stats.primitives;
      else if (stats.kind === "points") record.frame._points += stats.primitives;

      // per-draw entry (for the Frame tab)
      pushDraw(record, {
        method,
        programId,
        mode: stats.modeName,
        kind: stats.kind,
        vertices: stats.vertices,
        primitives: stats.primitives,
        instances: stats.instances,
      });

      return orig(...args);
    }, originals);
  }

  // ---------- buffers ----------

  wrap(gl, "createBuffer", (orig, args) => {
    const b = orig(...args);
    if (b) {
      record.buffers.set(b, { target: null, size: 0, usage: null });
      idOf(record, b, "b");
    }
    return b;
  }, originals);

  wrap(gl, "deleteBuffer", (orig, args) => {
    record.buffers.delete(args[0]); record.ids.delete(args[0]);
    return orig(...args);
  }, originals);

  wrap(gl, "bindBuffer", (orig, args) => {
    const [target, buffer] = args;
    if (buffer) {
      let info = record.buffers.get(buffer);
      if (!info) {
        info = { target: null, size: 0, usage: null };
        record.buffers.set(buffer, info);
      }
      idOf(record, buffer, "b");
      // keep the first non-null target sticky — buffers rarely change role
      if (!info.target) info.target = bufferTargetName(gl, target);
    }
    return orig(...args);
  }, originals);

  wrap(gl, "bindBufferBase", (orig, args) => {
    const [target, , buffer] = args;
    if (buffer) {
      let info = record.buffers.get(buffer);
      if (!info) {
        info = { target: null, size: 0, usage: null };
        record.buffers.set(buffer, info);
      }
      idOf(record, buffer, "b");
      if (!info.target) info.target = bufferTargetName(gl, target);
    }
    return orig(...args);
  }, originals);

  wrap(gl, "bufferData", (orig, args) => {
    const [target, dataOrSize, usage] = args;
    const buffer = gl.getParameter(bufferBindingFor(gl, target));
    if (buffer) {
      let info = record.buffers.get(buffer);
      if (!info) {
        info = { target: bufferTargetName(gl, target), size: 0, usage: null };
        record.buffers.set(buffer, info);
      }
      info.target = info.target || bufferTargetName(gl, target);
      info.size = typeof dataOrSize === "number"
        ? dataOrSize
        : (dataOrSize?.byteLength ?? 0);
      info.usage = usageName(gl, usage);
    }
    return orig(...args);
  }, originals);

  // ---------- textures ----------

  wrap(gl, "createTexture", (orig, args) => {
    const t = orig(...args);
    if (t) {
      record.textures.set(t, {
        target: null, width: 0, height: 0, depth: 1,
        internalFormat: null, format: null, type: null, mipmap: false,
      });
      idOf(record, t, "t");
    }
    return t;
  }, originals);

  wrap(gl, "deleteTexture", (orig, args) => {
    record.textures.delete(args[0]); record.ids.delete(args[0]);
    return orig(...args);
  }, originals);

  wrap(gl, "bindTexture", (orig, args) => {
    const [target, texture] = args;
    if (texture) {
      let info = record.textures.get(texture);
      if (!info) {
        info = { target: null, width: 0, height: 0, depth: 1,
                 internalFormat: null, format: null, type: null, mipmap: false };
        record.textures.set(texture, info);
      }
      idOf(record, texture, "t");
      if (!info.target) info.target = textureTargetName(gl, target);
    }
    return orig(...args);
  }, originals);

  wrap(gl, "texImage2D", (orig, args) => {
    // (target, level, internalFormat, width, height, border, format, type, source)  9-arg
    // (target, level, internalFormat, format, type, source)                          6-arg
    const target = args[0];
    const level = args[1];
    const tex = gl.getParameter(textureBindingFor(gl, target));
    if (tex) {
      const info = record.textures.get(tex) || { target: textureTargetName(gl, target) };
      record.textures.set(tex, info);
      info.target = info.target || textureTargetName(gl, target);
      info.internalFormat = formatName(gl, args[2]);
      if (args.length >= 9) {
        if (level === 0) { info.width = args[3]; info.height = args[4]; }
        info.format = formatName(gl, args[6]);
        info.type = typeName(gl, args[7]);
      } else if (args.length === 6) {
        const dims = sourceDimensions(args[5]);
        if (dims && level === 0) { info.width = dims.width; info.height = dims.height; }
        info.format = formatName(gl, args[3]);
        info.type = typeName(gl, args[4]);
      }
      if (level > 0) info.mipmap = true;
    }
    return orig(...args);
  }, originals);

  wrap(gl, "texImage3D", (orig, args) => {
    // (target, level, internalFormat, width, height, depth, border, format, type, source)
    const target = args[0];
    const level = args[1];
    const tex = gl.getParameter(textureBindingFor(gl, target));
    if (tex) {
      const info = record.textures.get(tex) || {};
      record.textures.set(tex, info);
      info.target = info.target || textureTargetName(gl, target);
      info.internalFormat = formatName(gl, args[2]);
      if (level === 0) { info.width = args[3]; info.height = args[4]; info.depth = args[5]; }
      info.format = formatName(gl, args[7]);
      info.type = typeName(gl, args[8]);
      if (level > 0) info.mipmap = true;
    }
    return orig(...args);
  }, originals);

  wrap(gl, "texStorage2D", (orig, args) => {
    // (target, levels, internalFormat, width, height)
    const target = args[0];
    const tex = gl.getParameter(textureBindingFor(gl, target));
    if (tex) {
      const info = record.textures.get(tex) || {};
      record.textures.set(tex, info);
      info.target = info.target || textureTargetName(gl, target);
      info.internalFormat = formatName(gl, args[2]);
      info.width = args[3]; info.height = args[4];
      info.mipmap = args[1] > 1;
    }
    return orig(...args);
  }, originals);

  wrap(gl, "texStorage3D", (orig, args) => {
    // (target, levels, internalFormat, width, height, depth)
    const target = args[0];
    const tex = gl.getParameter(textureBindingFor(gl, target));
    if (tex) {
      const info = record.textures.get(tex) || {};
      record.textures.set(tex, info);
      info.target = info.target || textureTargetName(gl, target);
      info.internalFormat = formatName(gl, args[2]);
      info.width = args[3]; info.height = args[4]; info.depth = args[5];
      info.mipmap = args[1] > 1;
    }
    return orig(...args);
  }, originals);

  wrap(gl, "generateMipmap", (orig, args) => {
    const target = args[0];
    const tex = gl.getParameter(textureBindingFor(gl, target));
    if (tex) {
      const info = record.textures.get(tex);
      if (info) info.mipmap = true;
    }
    return orig(...args);
  }, originals);

  // ---------- framebuffers & renderbuffers ----------

  wrap(gl, "createFramebuffer", (orig, args) => {
    const f = orig(...args);
    if (f) { record.framebuffers.set(f, { attachments: {} }); idOf(record, f, "f"); }
    return f;
  }, originals);
  wrap(gl, "deleteFramebuffer", (orig, args) => {
    record.framebuffers.delete(args[0]); record.ids.delete(args[0]);
    return orig(...args);
  }, originals);
  wrap(gl, "bindFramebuffer", (orig, args) => {
    const [target, fb] = args;
    record.boundFb[fbTargetName(gl, target)] = fb;
    if (fb && !record.framebuffers.has(fb)) {
      record.framebuffers.set(fb, { attachments: {} });
      idOf(record, fb, "f");
    }
    return orig(...args);
  }, originals);

  wrap(gl, "framebufferTexture2D", (orig, args) => {
    // (target, attachment, textarget, texture, level)
    const [target, attachment, , texture, level] = args;
    const fb = record.boundFb[fbTargetName(gl, target)];
    if (fb) {
      const info = record.framebuffers.get(fb) || { attachments: {} };
      info.attachments[attachmentName(gl, attachment)] = {
        kind: "texture", texture, level,
      };
      record.framebuffers.set(fb, info);
    }
    return orig(...args);
  }, originals);

  wrap(gl, "framebufferRenderbuffer", (orig, args) => {
    const [target, attachment, , renderbuffer] = args;
    const fb = record.boundFb[fbTargetName(gl, target)];
    if (fb) {
      const info = record.framebuffers.get(fb) || { attachments: {} };
      info.attachments[attachmentName(gl, attachment)] = {
        kind: "renderbuffer", renderbuffer,
      };
      record.framebuffers.set(fb, info);
    }
    return orig(...args);
  }, originals);

  wrap(gl, "framebufferTextureLayer", (orig, args) => {
    const [target, attachment, texture, level, layer] = args;
    const fb = record.boundFb[fbTargetName(gl, target)];
    if (fb) {
      const info = record.framebuffers.get(fb) || { attachments: {} };
      info.attachments[attachmentName(gl, attachment)] = {
        kind: "textureLayer", texture, level, layer,
      };
      record.framebuffers.set(fb, info);
    }
    return orig(...args);
  }, originals);

  wrap(gl, "createRenderbuffer", (orig, args) => {
    const r = orig(...args);
    if (r) {
      record.renderbuffers.set(r, { internalFormat: null, width: 0, height: 0, samples: 0 });
      idOf(record, r, "r");
    }
    return r;
  }, originals);
  wrap(gl, "deleteRenderbuffer", (orig, args) => {
    record.renderbuffers.delete(args[0]); record.ids.delete(args[0]);
    return orig(...args);
  }, originals);
  wrap(gl, "bindRenderbuffer", (orig, args) => {
    const [, rb] = args;
    record.boundRb = rb;
    return orig(...args);
  }, originals);
  wrap(gl, "renderbufferStorage", (orig, args) => {
    // (target, internalFormat, width, height)
    const rb = record.boundRb;
    if (rb) {
      const info = record.renderbuffers.get(rb) || {};
      info.internalFormat = formatName(gl, args[1]);
      info.width = args[2]; info.height = args[3]; info.samples = 0;
      record.renderbuffers.set(rb, info);
    }
    return orig(...args);
  }, originals);
  wrap(gl, "renderbufferStorageMultisample", (orig, args) => {
    // (target, samples, internalFormat, width, height)
    const rb = record.boundRb;
    if (rb) {
      const info = record.renderbuffers.get(rb) || {};
      info.samples = args[1];
      info.internalFormat = formatName(gl, args[2]);
      info.width = args[3]; info.height = args[4];
      record.renderbuffers.set(rb, info);
    }
    return orig(...args);
  }, originals);

  // ---------- VAOs / samplers / transform-feedback / queries / sync ----------

  trackCreateDelete(gl, "VertexArray", record.vaos, originals, record, "v");
  trackCreateDelete(gl, "Sampler", record.samplers, originals, record);
  trackCreateDelete(gl, "TransformFeedback", record.transformFeedbacks, originals, record);
  trackCreateDelete(gl, "Query", record.queries, originals, record);

  if (typeof gl.fenceSync === "function") {
    wrap(gl, "fenceSync", (orig, args) => {
      const s = orig(...args);
      if (s) record.syncs.add(s);
      return s;
    }, originals);
    wrap(gl, "deleteSync", (orig, args) => {
      record.syncs.delete(args[0]);
      return orig(...args);
    }, originals);
  }

  // Capture currently-bound state at instrumentation time. Best effort —
  // helps when we attach LATE (e.g. bookmarklet on a running scene).
  const current = gl.getParameter(gl.CURRENT_PROGRAM);
  if (current) {
    record.programs.add(current);
    record.currentProgram = current;
  }
  captureBoundResources(gl, record);

  gl[ORIGINALS] = originals;
  gl[PATCHED] = true;
  return true;
}

/**
 * Walk known binding points and register any currently-bound resources.
 * Lets us catch buffers/textures/fbos that existed before we patched.
 */
function captureBoundResources(gl, record) {
  // buffers
  const bufBindings = [
    [gl.ARRAY_BUFFER_BINDING, gl.ARRAY_BUFFER],
    [gl.ELEMENT_ARRAY_BUFFER_BINDING, gl.ELEMENT_ARRAY_BUFFER],
  ];
  if (gl.UNIFORM_BUFFER_BINDING !== undefined) {
    bufBindings.push(
      [gl.UNIFORM_BUFFER_BINDING, gl.UNIFORM_BUFFER],
      [gl.COPY_READ_BUFFER_BINDING, gl.COPY_READ_BUFFER],
      [gl.COPY_WRITE_BUFFER_BINDING, gl.COPY_WRITE_BUFFER],
      [gl.PIXEL_PACK_BUFFER_BINDING, gl.PIXEL_PACK_BUFFER],
      [gl.PIXEL_UNPACK_BUFFER_BINDING, gl.PIXEL_UNPACK_BUFFER],
      [gl.TRANSFORM_FEEDBACK_BUFFER_BINDING, gl.TRANSFORM_FEEDBACK_BUFFER],
    );
  }
  for (const [pname, target] of bufBindings) {
    const buf = safeGet(gl, pname);
    if (buf && !record.buffers.has(buf)) {
      record.buffers.set(buf, { target: bufferTargetName(gl, target), size: 0, usage: null });
      idOf(record, buf, "b");
    }
  }

  // textures (per active unit — best effort, scans unit 0)
  const tx2d = safeGet(gl, gl.TEXTURE_BINDING_2D);
  if (tx2d && !record.textures.has(tx2d)) {
    record.textures.set(tx2d, { target: "TEXTURE_2D", width: 0, height: 0, depth: 1 });
    idOf(record, tx2d, "t");
  }
  const txCube = safeGet(gl, gl.TEXTURE_BINDING_CUBE_MAP);
  if (txCube && !record.textures.has(txCube)) {
    record.textures.set(txCube, { target: "TEXTURE_CUBE_MAP", width: 0, height: 0, depth: 1 });
    idOf(record, txCube, "t");
  }
  if (gl.TEXTURE_BINDING_2D_ARRAY !== undefined) {
    const txArr = safeGet(gl, gl.TEXTURE_BINDING_2D_ARRAY);
    if (txArr && !record.textures.has(txArr)) {
      record.textures.set(txArr, { target: "TEXTURE_2D_ARRAY", width: 0, height: 0, depth: 1 });
      idOf(record, txArr, "t");
    }
    const tx3d = safeGet(gl, gl.TEXTURE_BINDING_3D);
    if (tx3d && !record.textures.has(tx3d)) {
      record.textures.set(tx3d, { target: "TEXTURE_3D", width: 0, height: 0, depth: 1 });
      idOf(record, tx3d, "t");
    }
  }

  // framebuffer / renderbuffer
  const fb = safeGet(gl, gl.FRAMEBUFFER_BINDING);
  if (fb && !record.framebuffers.has(fb)) {
    record.framebuffers.set(fb, { attachments: {} });
    record.boundFb["FRAMEBUFFER"] = fb;
    idOf(record, fb, "f");
  }
  const rb = safeGet(gl, gl.RENDERBUFFER_BINDING);
  if (rb && !record.renderbuffers.has(rb)) {
    record.renderbuffers.set(rb, { internalFormat: null, width: 0, height: 0, samples: 0 });
    record.boundRb = rb;
    idOf(record, rb, "r");
  }

  // VAO (WebGL2 only — WebGL1 has the OES_vertex_array_object extension binding)
  if (gl.VERTEX_ARRAY_BINDING !== undefined) {
    const vao = safeGet(gl, gl.VERTEX_ARRAY_BINDING);
    if (vao) { record.vaos.add(vao); idOf(record, vao, "v"); }
  }
}

function safeGet(gl, pname) {
  try { return gl.getParameter(pname); } catch (_) { return null; }
}

// --- small helpers --------------------------------------------------------

function trackCreateDelete(gl, suffix, set, originals, record, prefix) {
  const create = `create${suffix}`;
  const del = `delete${suffix}`;
  if (typeof gl[create] === "function") {
    wrap(gl, create, (orig, args) => {
      const o = orig(...args);
      if (o) {
        set.add(o);
        if (record && prefix) idOf(record, o, prefix);
      }
      return o;
    }, originals);
  }
  if (typeof gl[del] === "function") {
    wrap(gl, del, (orig, args) => {
      set.delete(args[0]);
      if (record) record.ids.delete(args[0]);
      return orig(...args);
    }, originals);
  }
}

function bufferBindingFor(gl, target) {
  if (target === gl.ARRAY_BUFFER) return gl.ARRAY_BUFFER_BINDING;
  if (target === gl.ELEMENT_ARRAY_BUFFER) return gl.ELEMENT_ARRAY_BUFFER_BINDING;
  if (target === gl.UNIFORM_BUFFER) return gl.UNIFORM_BUFFER_BINDING;
  if (target === gl.COPY_READ_BUFFER) return gl.COPY_READ_BUFFER_BINDING;
  if (target === gl.COPY_WRITE_BUFFER) return gl.COPY_WRITE_BUFFER_BINDING;
  if (target === gl.PIXEL_PACK_BUFFER) return gl.PIXEL_PACK_BUFFER_BINDING;
  if (target === gl.PIXEL_UNPACK_BUFFER) return gl.PIXEL_UNPACK_BUFFER_BINDING;
  if (target === gl.TRANSFORM_FEEDBACK_BUFFER) return gl.TRANSFORM_FEEDBACK_BUFFER_BINDING;
  return gl.ARRAY_BUFFER_BINDING;
}

function textureBindingFor(gl, target) {
  if (target === gl.TEXTURE_2D) return gl.TEXTURE_BINDING_2D;
  if (target === gl.TEXTURE_CUBE_MAP) return gl.TEXTURE_BINDING_CUBE_MAP;
  if (target === gl.TEXTURE_2D_ARRAY) return gl.TEXTURE_BINDING_2D_ARRAY;
  if (target === gl.TEXTURE_3D) return gl.TEXTURE_BINDING_3D;
  // cube map face targets all read via TEXTURE_BINDING_CUBE_MAP
  if (target >= 0x8515 && target <= 0x851a) return gl.TEXTURE_BINDING_CUBE_MAP;
  return gl.TEXTURE_BINDING_2D;
}

function usageName(gl, usage) {
  const map = {
    [gl.STATIC_DRAW]: "STATIC_DRAW",
    [gl.DYNAMIC_DRAW]: "DYNAMIC_DRAW",
    [gl.STREAM_DRAW]: "STREAM_DRAW",
  };
  if (gl.STATIC_READ !== undefined) {
    map[gl.STATIC_READ] = "STATIC_READ";
    map[gl.DYNAMIC_READ] = "DYNAMIC_READ";
    map[gl.STREAM_READ] = "STREAM_READ";
    map[gl.STATIC_COPY] = "STATIC_COPY";
    map[gl.DYNAMIC_COPY] = "DYNAMIC_COPY";
    map[gl.STREAM_COPY] = "STREAM_COPY";
  }
  return map[usage] || `0x${usage.toString(16)}`;
}

function formatName(gl, v) {
  // very small subset; falls back to hex. Internal formats are huge.
  const m = {
    [gl.RGB]: "RGB",
    [gl.RGBA]: "RGBA",
    [gl.LUMINANCE]: "LUMINANCE",
    [gl.ALPHA]: "ALPHA",
    [gl.DEPTH_COMPONENT]: "DEPTH_COMPONENT",
    [gl.DEPTH_STENCIL]: "DEPTH_STENCIL",
  };
  if (gl.R8 !== undefined) {
    Object.assign(m, {
      [gl.R8]: "R8", [gl.RG8]: "RG8", [gl.RGB8]: "RGB8", [gl.RGBA8]: "RGBA8",
      [gl.R16F]: "R16F", [gl.RG16F]: "RG16F", [gl.RGB16F]: "RGB16F", [gl.RGBA16F]: "RGBA16F",
      [gl.R32F]: "R32F", [gl.RG32F]: "RG32F", [gl.RGB32F]: "RGB32F", [gl.RGBA32F]: "RGBA32F",
      [gl.SRGB8]: "SRGB8", [gl.SRGB8_ALPHA8]: "SRGB8_ALPHA8",
      [gl.DEPTH_COMPONENT16]: "DEPTH_COMPONENT16",
      [gl.DEPTH_COMPONENT24]: "DEPTH_COMPONENT24",
      [gl.DEPTH_COMPONENT32F]: "DEPTH_COMPONENT32F",
      [gl.DEPTH24_STENCIL8]: "DEPTH24_STENCIL8",
      [gl.DEPTH32F_STENCIL8]: "DEPTH32F_STENCIL8",
    });
  }
  return m[v] || `0x${v.toString(16)}`;
}

function typeName(gl, v) {
  const m = {
    [gl.UNSIGNED_BYTE]: "UNSIGNED_BYTE",
    [gl.BYTE]: "BYTE",
    [gl.UNSIGNED_SHORT]: "UNSIGNED_SHORT",
    [gl.SHORT]: "SHORT",
    [gl.UNSIGNED_INT]: "UNSIGNED_INT",
    [gl.INT]: "INT",
    [gl.FLOAT]: "FLOAT",
  };
  if (gl.HALF_FLOAT !== undefined) m[gl.HALF_FLOAT] = "HALF_FLOAT";
  return m[v] || `0x${v.toString(16)}`;
}

// --- getContext patch + scan (unchanged) ----------------------------------

export function patchGetContext(onContext) {
  if (typeof HTMLCanvasElement === "undefined") return () => {};
  const proto = HTMLCanvasElement.prototype;
  if (proto.__wgla_getContext_patched) return proto.__wgla_getContext_restore;

  const original = proto.getContext;
  proto.getContext = function (type, ...rest) {
    const ctx = original.call(this, type, ...rest);
    if (ctx && (type === "webgl2" || type === "webgl" || type === "experimental-webgl")) {
      try { onContext(ctx, this, type === "webgl2" ? "webgl2" : "webgl"); }
      catch (e) { console.warn("[gpu-probe] onContext failed:", e); }
    }
    return ctx;
  };
  proto.__wgla_getContext_patched = true;
  const restore = () => {
    proto.getContext = original;
    delete proto.__wgla_getContext_patched;
    delete proto.__wgla_getContext_restore;
  };
  proto.__wgla_getContext_restore = restore;
  return restore;
}

export function scanCanvases(onContext) {
  if (typeof document === "undefined") return [];
  const canvases = Array.from(document.querySelectorAll("canvas"));
  const found = [];
  for (const canvas of canvases) {
    let gl = null, version = null;
    try { gl = canvas.getContext("webgl2"); if (gl) version = "webgl2"; } catch (_) {}
    if (!gl) { try { gl = canvas.getContext("webgl"); if (gl) version = "webgl"; } catch (_) {} }
    if (gl) {
      onContext(gl, canvas, version);
      found.push({ gl, canvas, version });
    }
  }
  return found;
}
