/* gpu-probe v0.2.0 — https://github.com/shopify-playground/gpu-probe */
var __WGLA_LIB = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.js
  var index_exports = {};
  __export(index_exports, {
    default: () => index_default
  });

  // src/core/primitives.js
  var MODES = {
    0: { name: "POINTS", kind: "points", prims: (c) => c },
    1: { name: "LINES", kind: "lines", prims: (c) => c >= 2 ? c / 2 | 0 : 0 },
    2: { name: "LINE_LOOP", kind: "lines", prims: (c) => c >= 2 ? c : 0 },
    3: { name: "LINE_STRIP", kind: "lines", prims: (c) => c >= 2 ? c - 1 : 0 },
    4: { name: "TRIANGLES", kind: "triangles", prims: (c) => c >= 3 ? c / 3 | 0 : 0 },
    5: { name: "TRIANGLE_STRIP", kind: "triangles", prims: (c) => c >= 3 ? c - 2 : 0 },
    6: { name: "TRIANGLE_FAN", kind: "triangles", prims: (c) => c >= 3 ? c - 2 : 0 }
  };
  function classifyDraw(mode, count, instances = 1) {
    const m = MODES[mode];
    const inst = Math.max(1, instances | 0);
    if (!m) {
      return {
        modeName: `UNKNOWN(0x${mode.toString(16)})`,
        kind: "unknown",
        vertices: (count | 0) * inst,
        primitives: 0,
        instances: inst
      };
    }
    return {
      modeName: m.name,
      kind: m.kind,
      vertices: (count | 0) * inst,
      primitives: m.prims(count | 0) * inst,
      instances: inst
    };
  }

  // src/core/instrument.js
  var PATCHED = "__wgla_patched";
  var ORIGINALS = "__wgla_originals";
  var DRAW_METHODS = [
    "drawArrays",
    "drawElements",
    "drawArraysInstanced",
    "drawElementsInstanced",
    "drawRangeElements"
  ];
  function wrap(gl, name, fn, originals) {
    if (typeof gl[name] !== "function") return;
    const orig = gl[name].bind(gl);
    originals[name] = orig;
    gl[name] = function(...args) {
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
    if (target >= 34069 && target <= 34074) return "TEXTURE_CUBE_MAP";
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
      const w = source.naturalWidth || source.videoWidth || source.width;
      const h = source.naturalHeight || source.videoHeight || source.height;
      if (w && h) return { width: w, height: h };
    }
    return null;
  }
  function patchContext(gl, record) {
    if (!gl || gl[PATCHED]) return false;
    const originals = {};
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
      if (s) {
        record.shaders.add(s);
        idOf(record, s, "s");
        const t = args[0];
        const typeName2 = t === gl.VERTEX_SHADER ? "VERTEX_SHADER" : t === gl.FRAGMENT_SHADER ? "FRAGMENT_SHADER" : `UNKNOWN(${t})`;
        record.shaderInfo.set(s, { type: typeName2, source: "", compiled: false, infoLog: "" });
      }
      return s;
    }, originals);
    wrap(gl, "shaderSource", (orig, args) => {
      const [shader, source] = args;
      const ret = orig(...args);
      if (shader && record.shaderInfo.has(shader)) {
        record.shaderInfo.get(shader).source = typeof source === "string" ? source : "";
      }
      return ret;
    }, originals);
    wrap(gl, "compileShader", (orig, args) => {
      const [shader] = args;
      const ret = orig(...args);
      if (shader && record.shaderInfo.has(shader)) {
        const info = record.shaderInfo.get(shader);
        try {
          info.compiled = !!gl.getShaderParameter(shader, gl.COMPILE_STATUS);
          info.infoLog = gl.getShaderInfoLog(shader) || "";
          if (!info.source) info.source = gl.getShaderSource(shader) || "";
        } catch (_) {
        }
      }
      return ret;
    }, originals);
    wrap(gl, "attachShader", (orig, args) => {
      const [program, shader] = args;
      const ret = orig(...args);
      if (program && shader) {
        let set = record.programShaders.get(program);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          record.programShaders.set(program, set);
        }
        set.add(shader);
      }
      return ret;
    }, originals);
    wrap(gl, "detachShader", (orig, args) => {
      return orig(...args);
    }, originals);
    wrap(gl, "deleteShader", (orig, args) => {
      record.shaders.delete(args[0]);
      record.ids.delete(args[0]);
      return orig(...args);
    }, originals);
    wrap(gl, "deleteProgram", (orig, args) => {
      const p = args[0];
      record.programs.delete(p);
      record.drawCalls.delete(p);
      record.useProgramCount.delete(p);
      record.ids.delete(p);
      record.programShaders.delete(p);
      return orig(...args);
    }, originals);
    for (const method of DRAW_METHODS) {
      if (typeof gl[method] !== "function") continue;
      wrap(gl, method, (orig, args) => {
        let mode, count, instances = 1;
        if (method === "drawArrays") {
          mode = args[0];
          count = args[2];
        } else if (method === "drawArraysInstanced") {
          mode = args[0];
          count = args[2];
          instances = args[3];
        } else if (method === "drawElements") {
          mode = args[0];
          count = args[1];
        } else if (method === "drawElementsInstanced") {
          mode = args[0];
          count = args[1];
          instances = args[4];
        } else if (method === "drawRangeElements") {
          mode = args[0];
          count = args[3];
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
        record.totalDrawCalls++;
        record.totalVertices += stats.vertices;
        if (stats.kind === "triangles") record.totalTriangles += stats.primitives;
        else if (stats.kind === "lines") record.totalLines += stats.primitives;
        else if (stats.kind === "points") record.totalPoints += stats.primitives;
        record.frame._drawCalls++;
        record.frame._vertices += stats.vertices;
        if (stats.kind === "triangles") record.frame._triangles += stats.primitives;
        else if (stats.kind === "lines") record.frame._lines += stats.primitives;
        else if (stats.kind === "points") record.frame._points += stats.primitives;
        pushDraw(record, {
          method,
          programId,
          mode: stats.modeName,
          kind: stats.kind,
          vertices: stats.vertices,
          primitives: stats.primitives,
          instances: stats.instances
        });
        return orig(...args);
      }, originals);
    }
    wrap(gl, "createBuffer", (orig, args) => {
      const b = orig(...args);
      if (b) {
        record.buffers.set(b, { target: null, size: 0, usage: null });
        idOf(record, b, "b");
      }
      return b;
    }, originals);
    wrap(gl, "deleteBuffer", (orig, args) => {
      record.buffers.delete(args[0]);
      record.ids.delete(args[0]);
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
        info.size = typeof dataOrSize === "number" ? dataOrSize : dataOrSize?.byteLength ?? 0;
        info.usage = usageName(gl, usage);
      }
      return orig(...args);
    }, originals);
    wrap(gl, "createTexture", (orig, args) => {
      const t = orig(...args);
      if (t) {
        record.textures.set(t, {
          target: null,
          width: 0,
          height: 0,
          depth: 1,
          internalFormat: null,
          format: null,
          type: null,
          mipmap: false
        });
        idOf(record, t, "t");
      }
      return t;
    }, originals);
    wrap(gl, "deleteTexture", (orig, args) => {
      record.textures.delete(args[0]);
      record.ids.delete(args[0]);
      return orig(...args);
    }, originals);
    wrap(gl, "bindTexture", (orig, args) => {
      const [target, texture] = args;
      if (texture) {
        let info = record.textures.get(texture);
        if (!info) {
          info = {
            target: null,
            width: 0,
            height: 0,
            depth: 1,
            internalFormat: null,
            format: null,
            type: null,
            mipmap: false
          };
          record.textures.set(texture, info);
        }
        idOf(record, texture, "t");
        if (!info.target) info.target = textureTargetName(gl, target);
      }
      return orig(...args);
    }, originals);
    wrap(gl, "texImage2D", (orig, args) => {
      const target = args[0];
      const level = args[1];
      const tex = gl.getParameter(textureBindingFor(gl, target));
      if (tex) {
        const info = record.textures.get(tex) || { target: textureTargetName(gl, target) };
        record.textures.set(tex, info);
        info.target = info.target || textureTargetName(gl, target);
        info.internalFormat = formatName(gl, args[2]);
        if (args.length >= 9) {
          if (level === 0) {
            info.width = args[3];
            info.height = args[4];
          }
          info.format = formatName(gl, args[6]);
          info.type = typeName(gl, args[7]);
        } else if (args.length === 6) {
          const dims = sourceDimensions(args[5]);
          if (dims && level === 0) {
            info.width = dims.width;
            info.height = dims.height;
          }
          info.format = formatName(gl, args[3]);
          info.type = typeName(gl, args[4]);
        }
        if (level > 0) info.mipmap = true;
      }
      return orig(...args);
    }, originals);
    wrap(gl, "texImage3D", (orig, args) => {
      const target = args[0];
      const level = args[1];
      const tex = gl.getParameter(textureBindingFor(gl, target));
      if (tex) {
        const info = record.textures.get(tex) || {};
        record.textures.set(tex, info);
        info.target = info.target || textureTargetName(gl, target);
        info.internalFormat = formatName(gl, args[2]);
        if (level === 0) {
          info.width = args[3];
          info.height = args[4];
          info.depth = args[5];
        }
        info.format = formatName(gl, args[7]);
        info.type = typeName(gl, args[8]);
        if (level > 0) info.mipmap = true;
      }
      return orig(...args);
    }, originals);
    wrap(gl, "texStorage2D", (orig, args) => {
      const target = args[0];
      const tex = gl.getParameter(textureBindingFor(gl, target));
      if (tex) {
        const info = record.textures.get(tex) || {};
        record.textures.set(tex, info);
        info.target = info.target || textureTargetName(gl, target);
        info.internalFormat = formatName(gl, args[2]);
        info.width = args[3];
        info.height = args[4];
        info.mipmap = args[1] > 1;
      }
      return orig(...args);
    }, originals);
    wrap(gl, "texStorage3D", (orig, args) => {
      const target = args[0];
      const tex = gl.getParameter(textureBindingFor(gl, target));
      if (tex) {
        const info = record.textures.get(tex) || {};
        record.textures.set(tex, info);
        info.target = info.target || textureTargetName(gl, target);
        info.internalFormat = formatName(gl, args[2]);
        info.width = args[3];
        info.height = args[4];
        info.depth = args[5];
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
    wrap(gl, "createFramebuffer", (orig, args) => {
      const f = orig(...args);
      if (f) {
        record.framebuffers.set(f, { attachments: {} });
        idOf(record, f, "f");
      }
      return f;
    }, originals);
    wrap(gl, "deleteFramebuffer", (orig, args) => {
      record.framebuffers.delete(args[0]);
      record.ids.delete(args[0]);
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
      const [target, attachment, , texture, level] = args;
      const fb = record.boundFb[fbTargetName(gl, target)];
      if (fb) {
        const info = record.framebuffers.get(fb) || { attachments: {} };
        info.attachments[attachmentName(gl, attachment)] = {
          kind: "texture",
          texture,
          level
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
          kind: "renderbuffer",
          renderbuffer
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
          kind: "textureLayer",
          texture,
          level,
          layer
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
      record.renderbuffers.delete(args[0]);
      record.ids.delete(args[0]);
      return orig(...args);
    }, originals);
    wrap(gl, "bindRenderbuffer", (orig, args) => {
      const [, rb] = args;
      record.boundRb = rb;
      return orig(...args);
    }, originals);
    wrap(gl, "renderbufferStorage", (orig, args) => {
      const rb = record.boundRb;
      if (rb) {
        const info = record.renderbuffers.get(rb) || {};
        info.internalFormat = formatName(gl, args[1]);
        info.width = args[2];
        info.height = args[3];
        info.samples = 0;
        record.renderbuffers.set(rb, info);
      }
      return orig(...args);
    }, originals);
    wrap(gl, "renderbufferStorageMultisample", (orig, args) => {
      const rb = record.boundRb;
      if (rb) {
        const info = record.renderbuffers.get(rb) || {};
        info.samples = args[1];
        info.internalFormat = formatName(gl, args[2]);
        info.width = args[3];
        info.height = args[4];
        record.renderbuffers.set(rb, info);
      }
      return orig(...args);
    }, originals);
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
  function captureBoundResources(gl, record) {
    const bufBindings = [
      [gl.ARRAY_BUFFER_BINDING, gl.ARRAY_BUFFER],
      [gl.ELEMENT_ARRAY_BUFFER_BINDING, gl.ELEMENT_ARRAY_BUFFER]
    ];
    if (gl.UNIFORM_BUFFER_BINDING !== void 0) {
      bufBindings.push(
        [gl.UNIFORM_BUFFER_BINDING, gl.UNIFORM_BUFFER],
        [gl.COPY_READ_BUFFER_BINDING, gl.COPY_READ_BUFFER],
        [gl.COPY_WRITE_BUFFER_BINDING, gl.COPY_WRITE_BUFFER],
        [gl.PIXEL_PACK_BUFFER_BINDING, gl.PIXEL_PACK_BUFFER],
        [gl.PIXEL_UNPACK_BUFFER_BINDING, gl.PIXEL_UNPACK_BUFFER],
        [gl.TRANSFORM_FEEDBACK_BUFFER_BINDING, gl.TRANSFORM_FEEDBACK_BUFFER]
      );
    }
    for (const [pname, target] of bufBindings) {
      const buf = safeGet(gl, pname);
      if (buf && !record.buffers.has(buf)) {
        record.buffers.set(buf, { target: bufferTargetName(gl, target), size: 0, usage: null });
        idOf(record, buf, "b");
      }
    }
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
    if (gl.TEXTURE_BINDING_2D_ARRAY !== void 0) {
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
    if (gl.VERTEX_ARRAY_BINDING !== void 0) {
      const vao = safeGet(gl, gl.VERTEX_ARRAY_BINDING);
      if (vao) {
        record.vaos.add(vao);
        idOf(record, vao, "v");
      }
    }
  }
  function safeGet(gl, pname) {
    try {
      return gl.getParameter(pname);
    } catch (_) {
      return null;
    }
  }
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
    if (target >= 34069 && target <= 34074) return gl.TEXTURE_BINDING_CUBE_MAP;
    return gl.TEXTURE_BINDING_2D;
  }
  function usageName(gl, usage) {
    const map = {
      [gl.STATIC_DRAW]: "STATIC_DRAW",
      [gl.DYNAMIC_DRAW]: "DYNAMIC_DRAW",
      [gl.STREAM_DRAW]: "STREAM_DRAW"
    };
    if (gl.STATIC_READ !== void 0) {
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
    const m = {
      [gl.RGB]: "RGB",
      [gl.RGBA]: "RGBA",
      [gl.LUMINANCE]: "LUMINANCE",
      [gl.ALPHA]: "ALPHA",
      [gl.DEPTH_COMPONENT]: "DEPTH_COMPONENT",
      [gl.DEPTH_STENCIL]: "DEPTH_STENCIL"
    };
    if (gl.R8 !== void 0) {
      Object.assign(m, {
        [gl.R8]: "R8",
        [gl.RG8]: "RG8",
        [gl.RGB8]: "RGB8",
        [gl.RGBA8]: "RGBA8",
        [gl.R16F]: "R16F",
        [gl.RG16F]: "RG16F",
        [gl.RGB16F]: "RGB16F",
        [gl.RGBA16F]: "RGBA16F",
        [gl.R32F]: "R32F",
        [gl.RG32F]: "RG32F",
        [gl.RGB32F]: "RGB32F",
        [gl.RGBA32F]: "RGBA32F",
        [gl.SRGB8]: "SRGB8",
        [gl.SRGB8_ALPHA8]: "SRGB8_ALPHA8",
        [gl.DEPTH_COMPONENT16]: "DEPTH_COMPONENT16",
        [gl.DEPTH_COMPONENT24]: "DEPTH_COMPONENT24",
        [gl.DEPTH_COMPONENT32F]: "DEPTH_COMPONENT32F",
        [gl.DEPTH24_STENCIL8]: "DEPTH24_STENCIL8",
        [gl.DEPTH32F_STENCIL8]: "DEPTH32F_STENCIL8"
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
      [gl.FLOAT]: "FLOAT"
    };
    if (gl.HALF_FLOAT !== void 0) m[gl.HALF_FLOAT] = "HALF_FLOAT";
    return m[v] || `0x${v.toString(16)}`;
  }
  function patchGetContext(onContext) {
    if (typeof HTMLCanvasElement === "undefined") return () => {
    };
    const proto = HTMLCanvasElement.prototype;
    if (proto.__wgla_getContext_patched) return proto.__wgla_getContext_restore;
    const original = proto.getContext;
    proto.getContext = function(type, ...rest) {
      const ctx = original.call(this, type, ...rest);
      if (ctx && (type === "webgl2" || type === "webgl" || type === "experimental-webgl")) {
        try {
          onContext(ctx, this, type === "webgl2" ? "webgl2" : "webgl");
        } catch (e) {
          console.warn("[gpu-probe] onContext failed:", e);
        }
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
  function scanCanvases(onContext) {
    if (typeof document === "undefined") return [];
    const canvases = Array.from(document.querySelectorAll("canvas"));
    const found = [];
    for (const canvas of canvases) {
      let gl = null, version = null;
      try {
        gl = canvas.getContext("webgl2");
        if (gl) version = "webgl2";
      } catch (_) {
      }
      if (!gl) {
        try {
          gl = canvas.getContext("webgl");
          if (gl) version = "webgl";
        } catch (_) {
        }
      }
      if (gl) {
        onContext(gl, canvas, version);
        found.push({ gl, canvas, version });
      }
    }
    return found;
  }

  // src/core/gl-types.js
  var GL_TYPE_NAMES = {
    5120: "BYTE",
    5121: "UNSIGNED_BYTE",
    5122: "SHORT",
    5123: "UNSIGNED_SHORT",
    5124: "INT",
    5125: "UNSIGNED_INT",
    5126: "FLOAT",
    5131: "HALF_FLOAT",
    35664: "FLOAT_VEC2",
    35665: "FLOAT_VEC3",
    35666: "FLOAT_VEC4",
    35667: "INT_VEC2",
    35668: "INT_VEC3",
    35669: "INT_VEC4",
    35670: "BOOL",
    35671: "BOOL_VEC2",
    35672: "BOOL_VEC3",
    35673: "BOOL_VEC4",
    35674: "FLOAT_MAT2",
    35675: "FLOAT_MAT3",
    35676: "FLOAT_MAT4",
    35678: "SAMPLER_2D",
    35679: "SAMPLER_3D",
    35680: "SAMPLER_CUBE",
    35682: "SAMPLER_2D_SHADOW",
    35685: "FLOAT_MAT2x3",
    35686: "FLOAT_MAT2x4",
    35687: "FLOAT_MAT3x2",
    35688: "FLOAT_MAT3x4",
    35689: "FLOAT_MAT4x2",
    35690: "FLOAT_MAT4x3",
    36289: "SAMPLER_2D_ARRAY",
    36292: "SAMPLER_2D_ARRAY_SHADOW",
    36293: "SAMPLER_CUBE_SHADOW",
    36294: "UNSIGNED_INT_VEC2",
    36295: "UNSIGNED_INT_VEC3",
    36296: "UNSIGNED_INT_VEC4",
    36298: "INT_SAMPLER_2D",
    36299: "INT_SAMPLER_3D",
    36300: "INT_SAMPLER_CUBE",
    36303: "INT_SAMPLER_2D_ARRAY",
    36306: "UNSIGNED_INT_SAMPLER_2D",
    36307: "UNSIGNED_INT_SAMPLER_3D",
    36308: "UNSIGNED_INT_SAMPLER_CUBE",
    36311: "UNSIGNED_INT_SAMPLER_2D_ARRAY"
  };

  // src/core/extract.js
  function typeNameU(type) {
    return GL_TYPE_NAMES[type] || `0x${type.toString(16)}`;
  }
  function safeUniformValue(gl, program, location2) {
    if (!location2) return null;
    try {
      const v = gl.getUniform(program, location2);
      if (v == null) return null;
      if (ArrayBuffer.isView(v)) return Array.from(v);
      return v;
    } catch (_) {
      return null;
    }
  }
  function extractShader(gl, shader, cached) {
    if (!shader && !cached) return null;
    let type = cached?.type || null;
    let compiled = cached?.compiled ?? false;
    let deleted = false;
    let source = cached?.source || "";
    let infoLog = cached?.infoLog || "";
    if (shader) {
      try {
        const t = gl.getShaderParameter(shader, gl.SHADER_TYPE);
        if (t === gl.VERTEX_SHADER) type = "VERTEX_SHADER";
        else if (t === gl.FRAGMENT_SHADER) type = "FRAGMENT_SHADER";
      } catch (_) {
      }
      try {
        const c = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (c !== null && c !== void 0) compiled = !!c;
      } catch (_) {
      }
      try {
        const d = gl.getShaderParameter(shader, gl.DELETE_STATUS);
        if (d !== null && d !== void 0) deleted = !!d;
      } catch (_) {
      }
      try {
        const s = gl.getShaderSource(shader);
        if (s) source = s;
      } catch (_) {
      }
      try {
        const l = gl.getShaderInfoLog(shader);
        if (l) infoLog = l;
      } catch (_) {
      }
    }
    return {
      type: type || "UNKNOWN",
      compiled,
      deleted,
      sourceLength: source.length,
      source,
      infoLog
    };
  }
  function extractProgram(gl, program, meta = {}, record = null) {
    const linked = !!gl.getProgramParameter(program, gl.LINK_STATUS);
    const validated = !!gl.getProgramParameter(program, gl.VALIDATE_STATUS);
    const active = gl.getParameter(gl.CURRENT_PROGRAM) === program;
    const attached = gl.getAttachedShaders(program) || [];
    const seen = new Set(attached);
    const recordedSet = record?.programShaders?.get(program);
    if (recordedSet) for (const s of recordedSet) seen.add(s);
    const shaders = [...seen].map((s) => extractShader(gl, s, record?.shaderInfo?.get(s)));
    const uniforms = [];
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < numUniforms; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const loc = gl.getUniformLocation(program, info.name);
      uniforms.push({
        name: info.name,
        type: typeNameU(info.type),
        typeEnum: info.type,
        size: info.size,
        value: safeUniformValue(gl, program, loc)
      });
    }
    const attribs = [];
    const numAttribs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) || 0;
    for (let i = 0; i < numAttribs; i++) {
      const info = gl.getActiveAttrib(program, i);
      if (!info) continue;
      attribs.push({
        name: info.name,
        type: typeNameU(info.type),
        typeEnum: info.type,
        size: info.size,
        location: gl.getAttribLocation(program, info.name)
      });
    }
    return {
      id: meta.id ?? null,
      active,
      linked,
      validated,
      deleted: !!gl.getProgramParameter(program, gl.DELETE_STATUS),
      infoLog: gl.getProgramInfoLog(program) || "",
      drawCalls: meta.drawCalls ?? 0,
      useProgramCount: meta.useProgramCount ?? 0,
      shaders,
      uniforms,
      attribs
    };
  }
  function idFor(record, resource, fallback) {
    return record.ids.get(resource) || fallback;
  }
  function extractBuffers(record) {
    const out = [];
    for (const [b, info] of record.buffers) {
      out.push({
        id: idFor(record, b, "b?"),
        target: info.target || "UNKNOWN",
        size: info.size || 0,
        usage: info.usage || null
      });
    }
    return out;
  }
  function extractTextures(record) {
    const out = [];
    for (const [t, info] of record.textures) {
      out.push({
        id: idFor(record, t, "t?"),
        target: info.target || "UNKNOWN",
        width: info.width || 0,
        height: info.height || 0,
        depth: info.depth || 1,
        internalFormat: info.internalFormat || null,
        format: info.format || null,
        type: info.type || null,
        mipmap: !!info.mipmap
      });
    }
    return out;
  }
  function extractFramebuffers(record) {
    const out = [];
    for (const [fb, info] of record.framebuffers) {
      const att = {};
      for (const [name, a] of Object.entries(info.attachments || {})) {
        if (a.kind === "texture" || a.kind === "textureLayer") {
          att[name] = {
            kind: a.kind,
            texture: idFor(record, a.texture, null),
            level: a.level ?? 0,
            layer: a.layer ?? null
          };
        } else if (a.kind === "renderbuffer") {
          att[name] = { kind: "renderbuffer", renderbuffer: idFor(record, a.renderbuffer, null) };
        }
      }
      out.push({ id: idFor(record, fb, "f?"), attachments: att });
    }
    return out;
  }
  function extractRenderbuffers(record) {
    const out = [];
    for (const [r, info] of record.renderbuffers) {
      out.push({
        id: idFor(record, r, "r?"),
        internalFormat: info.internalFormat || null,
        width: info.width || 0,
        height: info.height || 0,
        samples: info.samples || 0
      });
    }
    return out;
  }
  function bufferBreakdown(buffers) {
    const by = {};
    for (const b of buffers) {
      by[b.target] = (by[b.target] || 0) + 1;
    }
    return by;
  }
  function extractContext(gl, record) {
    const programs = [];
    for (const p of record.programs) {
      programs.push(
        extractProgram(gl, p, {
          id: idFor(record, p, "p?"),
          drawCalls: record.drawCalls.get(p) || 0,
          useProgramCount: record.useProgramCount.get(p) || 0
        }, record)
      );
    }
    const buffers = extractBuffers(record);
    const textures = extractTextures(record);
    const framebuffers = extractFramebuffers(record);
    const renderbuffers = extractRenderbuffers(record);
    return {
      version: record.version,
      canvas: record.canvas ? {
        width: record.canvas.width,
        height: record.canvas.height,
        clientWidth: record.canvas.clientWidth,
        clientHeight: record.canvas.clientHeight,
        id: record.canvas.id || null,
        className: record.canvas.className || null
      } : null,
      capabilities: {
        vendor: safeGet2(gl, gl.VENDOR),
        renderer: safeGet2(gl, gl.RENDERER),
        version: safeGet2(gl, gl.VERSION),
        glslVersion: safeGet2(gl, gl.SHADING_LANGUAGE_VERSION),
        maxTextureSize: safeGet2(gl, gl.MAX_TEXTURE_SIZE),
        maxVertexAttribs: safeGet2(gl, gl.MAX_VERTEX_ATTRIBS),
        maxVaryingVectors: safeGet2(gl, gl.MAX_VARYING_VECTORS) ?? safeGet2(gl, gl.MAX_VARYING_COMPONENTS),
        extensions: gl.getSupportedExtensions ? gl.getSupportedExtensions() : []
      },
      frame: {
        fps: record.frame.fps,
        frameMs: record.frame.frameMs,
        drawCalls: record.frame.drawCalls,
        vertices: record.frame.vertices,
        triangles: record.frame.triangles,
        lines: record.frame.lines,
        points: record.frame.points,
        draws: record.frame.draws.slice()
      },
      totals: {
        drawCalls: record.totalDrawCalls,
        vertices: record.totalVertices,
        triangles: record.totalTriangles,
        lines: record.totalLines,
        points: record.totalPoints,
        drawCallsByMethod: Object.fromEntries(record.drawCallsByMethod)
      },
      inventory: {
        programs: programs.length,
        shaders: record.shaders.size,
        buffers: buffers.length,
        buffersByTarget: bufferBreakdown(buffers),
        textures: textures.length,
        framebuffers: framebuffers.length,
        renderbuffers: renderbuffers.length,
        vaos: record.vaos.size,
        samplers: record.samplers.size,
        transformFeedbacks: record.transformFeedbacks.size,
        queries: record.queries.size,
        syncs: record.syncs.size
      },
      programs,
      buffers,
      textures,
      framebuffers,
      renderbuffers
    };
  }
  function safeGet2(gl, pname) {
    try {
      return gl.getParameter(pname);
    } catch (_) {
      return null;
    }
  }

  // src/core/report.js
  var S = {
    title: "color:#0bf;font-weight:bold;font-size:13px",
    dim: "color:#888",
    kv: "color:#aaa"
  };
  function fmtBytes(n) {
    if (!n) return "0";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }
  function fmtNum(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
  }
  function printSnapshot(snap) {
    const inv = snap.inventory;
    console.groupCollapsed(
      `%c[gpu-probe]%c ${snap.version}  ${inv.programs}p ${inv.buffers}b ${inv.textures}t ${inv.framebuffers}f  ${fmtNum(snap.totals.drawCalls)} draws  ${fmtNum(snap.totals.triangles)} tris`,
      S.title,
      S.dim
    );
    console.groupCollapsed("%cContext", S.title);
    console.log("%cvendor:", S.kv, snap.capabilities.vendor);
    console.log("%crenderer:", S.kv, snap.capabilities.renderer);
    console.log("%cversion:", S.kv, snap.capabilities.version);
    console.log("%cglsl:", S.kv, snap.capabilities.glslVersion);
    if (snap.canvas) {
      console.log(
        "%ccanvas:",
        S.kv,
        `${snap.canvas.width}\xD7${snap.canvas.height} (css ${snap.canvas.clientWidth}\xD7${snap.canvas.clientHeight})`,
        snap.canvas.id ? `#${snap.canvas.id}` : ""
      );
    }
    console.groupEnd();
    console.groupCollapsed(`%cFrame`, S.title);
    console.log("fps:", snap.frame.fps.toFixed(1));
    console.log("frame ms:", snap.frame.frameMs.toFixed(2));
    console.log("draws/frame:", snap.frame.drawCalls);
    console.log("tris/frame:", snap.frame.triangles);
    console.log("verts/frame:", snap.frame.vertices);
    console.groupEnd();
    console.groupCollapsed(`%cTotals (since attach)`, S.title);
    console.table({
      drawCalls: snap.totals.drawCalls,
      vertices: snap.totals.vertices,
      triangles: snap.totals.triangles,
      lines: snap.totals.lines,
      points: snap.totals.points
    });
    console.log("by method:", snap.totals.drawCallsByMethod);
    console.groupEnd();
    console.groupCollapsed(`%cInventory`, S.title);
    console.table({
      programs: inv.programs,
      shaders: inv.shaders,
      buffers: inv.buffers,
      textures: inv.textures,
      framebuffers: inv.framebuffers,
      renderbuffers: inv.renderbuffers,
      vaos: inv.vaos,
      samplers: inv.samplers,
      transformFeedbacks: inv.transformFeedbacks,
      queries: inv.queries,
      syncs: inv.syncs
    });
    if (Object.keys(inv.buffersByTarget).length) {
      console.log("buffers by target:", inv.buffersByTarget);
    }
    console.groupEnd();
    if (snap.buffers.length) {
      console.groupCollapsed(`Buffers (${snap.buffers.length})`);
      console.table(snap.buffers.map((b) => ({ id: b.id, target: b.target, size: fmtBytes(b.size), usage: b.usage })));
      console.groupEnd();
    }
    if (snap.textures.length) {
      console.groupCollapsed(`Textures (${snap.textures.length})`);
      console.table(snap.textures.map((t) => ({
        id: t.id,
        target: t.target,
        size: t.depth > 1 ? `${t.width}\xD7${t.height}\xD7${t.depth}` : `${t.width}\xD7${t.height}`,
        internalFormat: t.internalFormat,
        mipmap: t.mipmap
      })));
      console.groupEnd();
    }
    if (snap.framebuffers.length) {
      console.groupCollapsed(`Framebuffers (${snap.framebuffers.length})`);
      for (const f of snap.framebuffers) {
        console.log(f.id, f.attachments);
      }
      console.groupEnd();
    }
    if (snap.renderbuffers.length) {
      console.groupCollapsed(`Renderbuffers (${snap.renderbuffers.length})`);
      console.table(snap.renderbuffers.map((r) => ({
        id: r.id,
        internalFormat: r.internalFormat,
        size: `${r.width}\xD7${r.height}`,
        samples: r.samples
      })));
      console.groupEnd();
    }
    for (const prog of snap.programs) {
      const head = `${prog.id}  ${prog.active ? "\u25CF active" : "\u25CB"}  linked:${prog.linked ? "\u2713" : "\u2717"}  draws:${prog.drawCalls}`;
      console.groupCollapsed(`%c${head}`, S.title);
      if (prog.infoLog) console.warn("infoLog:", prog.infoLog);
      if (prog.attribs.length) {
        console.groupCollapsed(`Attributes (${prog.attribs.length})`);
        console.table(prog.attribs);
        console.groupEnd();
      }
      if (prog.uniforms.length) {
        console.groupCollapsed(`Uniforms (${prog.uniforms.length})`);
        console.table(prog.uniforms.map((u) => ({
          name: u.name,
          type: u.type,
          size: u.size,
          value: fmtValue(u.value)
        })));
        console.groupEnd();
      }
      for (const sh of prog.shaders) {
        const status = sh.compiled ? "\u2713" : "\u2717";
        console.groupCollapsed(`${sh.type} ${status}  (${sh.sourceLength} chars)`);
        if (sh.infoLog) console.warn("infoLog:", sh.infoLog);
        console.log(sh.source);
        console.groupEnd();
      }
      console.groupEnd();
    }
    console.groupEnd();
  }
  function fmtValue(v) {
    if (v == null) return v;
    if (Array.isArray(v)) {
      if (v.length > 6) return `[${v.slice(0, 6).map(short).join(", ")}, \u2026(${v.length})]`;
      return `[${v.map(short).join(", ")}]`;
    }
    if (typeof v === "number") return short(v);
    return v;
  }
  function short(n) {
    if (typeof n !== "number") return String(n);
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(4).replace(/\.?0+$/, "");
  }

  // src/core/frame.js
  var subs = /* @__PURE__ */ new Set();
  var started = false;
  var last = 0;
  var smoothedDt = 16.666;
  var EMA = 0.1;
  function tick(now) {
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(tick);
    }
    const dt = last === 0 ? 16.666 : now - last;
    last = now;
    if (dt < 200) smoothedDt = smoothedDt * (1 - EMA) + dt * EMA;
    const fps = 1e3 / smoothedDt;
    for (const fn of subs) {
      try {
        fn({ now, dt: smoothedDt, fps });
      } catch (e) {
      }
    }
  }
  function start() {
    if (started || typeof requestAnimationFrame === "undefined") return;
    started = true;
    requestAnimationFrame(tick);
  }
  function onFrame(fn) {
    subs.add(fn);
    start();
    return () => subs.delete(fn);
  }

  // src/core/analyzer.js
  function makeRecord(gl, canvas, version) {
    return {
      gl,
      canvas,
      version: version || (typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl"),
      // bookkeeping
      currentProgram: null,
      boundFb: {},
      // { FRAMEBUFFER: fb, DRAW_FRAMEBUFFER: fb, READ_FRAMEBUFFER: fb }
      boundRb: null,
      // stable ids: resource -> "p0" | "b3" | ...
      ids: /* @__PURE__ */ new Map(),
      counters: { p: 0, s: 0, b: 0, t: 0, f: 0, r: 0, v: 0 },
      // resources
      programs: /* @__PURE__ */ new Set(),
      shaders: /* @__PURE__ */ new Set(),
      // per-shader cached info (source, type, compile status, infoLog) — captured
      // at shaderSource()/compileShader() time so we can still surface the GLSL
      // even after the engine detaches shaders post-link (Three.js does this).
      shaderInfo: /* @__PURE__ */ new Map(),
      // shader -> { type, source, compiled, infoLog }
      // program -> Set<shader> association captured at attachShader() time, used
      // as a fallback when getAttachedShaders() returns empty post-link.
      programShaders: /* @__PURE__ */ new Map(),
      buffers: /* @__PURE__ */ new Map(),
      // buffer -> { target, size, usage }
      textures: /* @__PURE__ */ new Map(),
      // texture -> { target, width, height, depth, internalFormat, format, type, mipmap }
      framebuffers: /* @__PURE__ */ new Map(),
      // fb -> { attachments: {[name]: {...}} }
      renderbuffers: /* @__PURE__ */ new Map(),
      // rb -> { internalFormat, width, height, samples }
      vaos: /* @__PURE__ */ new Set(),
      samplers: /* @__PURE__ */ new Set(),
      transformFeedbacks: /* @__PURE__ */ new Set(),
      queries: /* @__PURE__ */ new Set(),
      syncs: /* @__PURE__ */ new Set(),
      // counters
      drawCalls: /* @__PURE__ */ new Map(),
      // program -> count
      useProgramCount: /* @__PURE__ */ new Map(),
      // program -> count
      drawCallsByMethod: /* @__PURE__ */ new Map(),
      // method -> count
      totalDrawCalls: 0,
      totalVertices: 0,
      totalTriangles: 0,
      totalLines: 0,
      totalPoints: 0,
      // live (per-frame) — _foo are accumulators flushed each tick
      frame: {
        fps: 0,
        frameMs: 0,
        drawCalls: 0,
        vertices: 0,
        triangles: 0,
        lines: 0,
        points: 0,
        draws: [],
        // snapshot of last completed frame
        _drawCalls: 0,
        _vertices: 0,
        _triangles: 0,
        _lines: 0,
        _points: 0,
        _draws: []
        // accumulator for current frame (capped)
      }
    };
  }
  function idOf(record, resource, prefix) {
    if (!resource) return null;
    let id = record.ids.get(resource);
    if (!id) {
      id = `${prefix}${record.counters[prefix]++}`;
      record.ids.set(resource, id);
    }
    return id;
  }
  var MAX_DRAWS_PER_FRAME = 2e3;
  function pushDraw(record, entry) {
    if (record.frame._draws.length < MAX_DRAWS_PER_FRAME) {
      record.frame._draws.push(entry);
    }
  }
  var Analyzer = class {
    constructor() {
      this.records = /* @__PURE__ */ new Map();
      this._installed = false;
      this._restoreGetContext = null;
      this._unsubFrame = null;
      this._frameListeners = /* @__PURE__ */ new Set();
    }
    install() {
      if (this._installed) return this;
      this._installed = true;
      this._restoreGetContext = patchGetContext((gl, canvas, version) => {
        this.attach(gl, canvas, version);
      });
      this._unsubFrame = onFrame((tick2) => this._onTick(tick2));
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
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        url: typeof location !== "undefined" ? location.href : null,
        contexts
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
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
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
    _onTick(tick2) {
      for (const [, r] of this.records) {
        r.frame.fps = tick2.fps;
        r.frame.frameMs = tick2.dt;
        r.frame.drawCalls = r.frame._drawCalls;
        r.frame.vertices = r.frame._vertices;
        r.frame.triangles = r.frame._triangles;
        r.frame.lines = r.frame._lines;
        r.frame.points = r.frame._points;
        r.frame.draws = r.frame._draws;
        r.frame._drawCalls = 0;
        r.frame._vertices = 0;
        r.frame._triangles = 0;
        r.frame._lines = 0;
        r.frame._points = 0;
        r.frame._draws = [];
      }
      for (const fn of this._frameListeners) {
        try {
          fn(this);
        } catch (_) {
        }
      }
    }
  };
  function getAnalyzer() {
    const KEY = "__wgla_instance";
    if (typeof globalThis !== "undefined" && globalThis[KEY]) {
      return globalThis[KEY];
    }
    const a = new Analyzer();
    if (typeof globalThis !== "undefined") globalThis[KEY] = a;
    return a;
  }

  // src/core-webgpu/primitives.js
  var TOPOS = {
    "point-list": { kind: "points", prims: (c) => c },
    "line-list": { kind: "lines", prims: (c) => c >= 2 ? c / 2 | 0 : 0 },
    "line-strip": { kind: "lines", prims: (c) => c >= 2 ? c - 1 : 0 },
    "triangle-list": { kind: "triangles", prims: (c) => c >= 3 ? c / 3 | 0 : 0 },
    "triangle-strip": { kind: "triangles", prims: (c) => c >= 3 ? c - 2 : 0 }
  };
  function classifyDraw2(topology, count, instances = 1) {
    const t = TOPOS[topology] || TOPOS["triangle-list"];
    const inst = Math.max(1, instances | 0);
    return {
      topology: topology || "triangle-list",
      kind: t.kind,
      vertices: (count | 0) * inst,
      primitives: t.prims(count | 0) * inst,
      instances: inst
    };
  }
  function bufferUsageFlags(mask) {
    const flags = [];
    if (mask & 1) flags.push("MAP_READ");
    if (mask & 2) flags.push("MAP_WRITE");
    if (mask & 4) flags.push("COPY_SRC");
    if (mask & 8) flags.push("COPY_DST");
    if (mask & 16) flags.push("INDEX");
    if (mask & 32) flags.push("VERTEX");
    if (mask & 64) flags.push("UNIFORM");
    if (mask & 128) flags.push("STORAGE");
    if (mask & 256) flags.push("INDIRECT");
    if (mask & 512) flags.push("QUERY_RESOLVE");
    return flags;
  }
  function textureUsageFlags(mask) {
    const flags = [];
    if (mask & 1) flags.push("COPY_SRC");
    if (mask & 2) flags.push("COPY_DST");
    if (mask & 4) flags.push("TEXTURE_BINDING");
    if (mask & 8) flags.push("STORAGE_BINDING");
    if (mask & 16) flags.push("RENDER_ATTACHMENT");
    return flags;
  }

  // src/core-webgpu/instrument.js
  var PATCHED2 = "__wgpua_patched";
  var VIEW_TO_TEXTURE = /* @__PURE__ */ new WeakMap();
  function patchMethod(obj, name, factory) {
    if (!obj || typeof obj[name] !== "function") return;
    const orig = obj[name].bind(obj);
    obj[name] = function(...args) {
      return factory(orig, args, this);
    };
  }
  function patchGPU(onDevice, onContext) {
    if (typeof navigator === "undefined" || !navigator.gpu) return () => {
    };
    if (navigator.gpu[PATCHED2]) return () => {
    };
    navigator.gpu[PATCHED2] = true;
    const origRequestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async function(...args) {
      const adapter = await origRequestAdapter(...args);
      if (adapter && !adapter[PATCHED2]) instrumentAdapter(adapter, onDevice);
      return adapter;
    };
    if (typeof HTMLCanvasElement !== "undefined") {
      const proto = HTMLCanvasElement.prototype;
      if (!proto.__wgpua_getContext_patched) {
        const original = proto.getContext;
        proto.getContext = function(type, ...rest) {
          const ctx = original.call(this, type, ...rest);
          if (ctx && type === "webgpu" && !ctx[PATCHED2]) {
            instrumentCanvasContext(ctx, this, onContext);
          }
          return ctx;
        };
        proto.__wgpua_getContext_patched = true;
      }
    }
    return () => {
    };
  }
  function instrumentAdapter(adapter, onDevice) {
    adapter[PATCHED2] = true;
    const origReq = adapter.requestDevice.bind(adapter);
    adapter.requestDevice = async function(...args) {
      const device = await origReq(...args);
      if (device && !device[PATCHED2]) onDevice(device, adapter, args[0]);
      return device;
    };
  }
  function instrumentCanvasContext(ctx, canvas, onContext) {
    ctx[PATCHED2] = true;
    patchMethod(ctx, "configure", (orig, args) => {
      const desc = args[0];
      if (desc && desc.device) onContext(desc.device, canvas, desc);
      return orig(...args);
    });
  }
  function patchDevicePrototype(onDevice) {
    if (typeof GPUDevice === "undefined") return;
    const proto = GPUDevice.prototype;
    if (proto.__wgpua_proto_patched) return;
    proto.__wgpua_proto_patched = true;
    const methods = [
      "createCommandEncoder",
      "createBuffer",
      "createTexture",
      "createBindGroup",
      "createShaderModule",
      "createRenderPipeline",
      "createComputePipeline"
    ];
    for (const m of methods) {
      const orig = proto[m];
      if (typeof orig !== "function") continue;
      proto[m] = function(...args) {
        if (!this[PATCHED2]) {
          try {
            onDevice(this, null, null);
          } catch (_) {
          }
        }
        return orig.apply(this, args);
      };
    }
  }
  function patchDevice(device, record) {
    if (!device || device[PATCHED2]) return false;
    device[PATCHED2] = true;
    try {
      if (typeof device.addEventListener === "function") {
        device.addEventListener("uncapturederror", (ev) => {
          const e = ev?.error;
          pushWarning(record, {
            severity: "error",
            source: "uncapturederror",
            kind: e?.constructor?.name || "GPUError",
            message: String(e?.message || ev?.message || e || "unknown error")
          });
        });
      }
      if (device.lost && typeof device.lost.then === "function") {
        device.lost.then((info) => {
          pushWarning(record, {
            severity: "error",
            source: "deviceLost",
            kind: "DeviceLost",
            message: `${info?.reason || "unknown"}: ${info?.message || ""}`
          });
        }, () => {
        });
      }
    } catch (_) {
    }
    patchMethod(device, "createBuffer", (orig, args) => {
      const buf = orig(...args);
      const desc = args[0] || {};
      record.buffers.set(buf, {
        label: desc.label || null,
        size: desc.size || 0,
        usage: desc.usage || 0,
        usageFlags: bufferUsageFlags(desc.usage || 0),
        mappedAtCreation: !!desc.mappedAtCreation
      });
      idOf2(record, buf, "b");
      return buf;
    });
    patchMethod(device, "createTexture", (orig, args) => {
      const tex = orig(...args);
      const desc = args[0] || {};
      const size = normalizeExtent(desc.size);
      record.textures.set(tex, {
        label: desc.label || null,
        width: size.width,
        height: size.height,
        depthOrArrayLayers: size.depthOrArrayLayers,
        format: desc.format || null,
        dimension: desc.dimension || "2d",
        mipLevelCount: desc.mipLevelCount || 1,
        sampleCount: desc.sampleCount || 1,
        usage: desc.usage || 0,
        usageFlags: textureUsageFlags(desc.usage || 0)
      });
      idOf2(record, tex, "t");
      if (typeof tex.createView === "function" && !tex[PATCHED2]) {
        tex[PATCHED2] = true;
        const origView = tex.createView.bind(tex);
        tex.createView = function(vdesc) {
          const v = origView(vdesc);
          try {
            VIEW_TO_TEXTURE.set(v, { texture: tex, viewDesc: vdesc || null });
          } catch (_) {
          }
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
        addressModeW: desc.addressModeW || "clamp-to-edge"
      });
      idOf2(record, s, "s");
      return s;
    });
    patchMethod(device, "createShaderModule", (orig, args) => {
      const mod = orig(...args);
      const desc = args[0] || {};
      record.shaderModules.set(mod, {
        label: desc.label || null,
        code: desc.code || "",
        sourceLength: (desc.code || "").length
      });
      idOf2(record, mod, "sh");
      return mod;
    });
    patchMethod(device, "createBindGroupLayout", (orig, args) => {
      const o = orig(...args);
      const desc = args[0] || {};
      record.bindGroupLayouts.set(o, {
        label: desc.label || null,
        explicit: true,
        entries: (desc.entries || []).map(summarizeBGLEntry)
      });
      idOf2(record, o, "bgl");
      return o;
    });
    patchMethod(device, "createBindGroup", (orig, args) => {
      const o = orig(...args);
      const desc = args[0] || {};
      const entries = (desc.entries || []).map((e) => ({
        binding: e.binding,
        resource: summarizeBGResource(record, e.resource)
      }));
      if (desc.layout && !record.bindGroupLayouts.has(desc.layout)) {
        record.bindGroupLayouts.set(desc.layout, {
          label: desc.layout.label || null,
          explicit: false,
          entries: []
        });
        idOf2(record, desc.layout, "bgl");
      }
      record.bindGroups.set(o, {
        label: desc.label || null,
        layout: desc.layout || null,
        layoutId: idOf2(record, desc.layout, "bgl") || null,
        entries
      });
      const bgId = idOf2(record, o, "bg");
      validateBindGroupAgainstLayout(record, bgId, desc.label, desc.layout, desc.entries || []);
      return o;
    });
    patchMethod(device, "createPipelineLayout", (orig, args) => {
      const o = orig(...args);
      const desc = args[0] || {};
      record.pipelineLayouts.set(o, {
        label: desc.label || null,
        bindGroupLayoutIds: (desc.bindGroupLayouts || []).map((l) => idOf2(record, l, "bgl") || null)
      });
      idOf2(record, o, "pl");
      return o;
    });
    patchMethod(device, "createRenderPipeline", (orig, args) => {
      const p = orig(...args);
      record.renderPipelines.set(p, makeRenderPipelineInfo(record, args[0] || {}));
      idOf2(record, p, "rp");
      return p;
    });
    patchMethod(device, "createRenderPipelineAsync", async (orig, args) => {
      const p = await orig(...args);
      record.renderPipelines.set(p, makeRenderPipelineInfo(record, args[0] || {}));
      idOf2(record, p, "rp");
      return p;
    });
    patchMethod(device, "createComputePipeline", (orig, args) => {
      const p = orig(...args);
      record.computePipelines.set(p, makeComputePipelineInfo(record, args[0] || {}));
      idOf2(record, p, "cp");
      return p;
    });
    patchMethod(device, "createComputePipelineAsync", async (orig, args) => {
      const p = await orig(...args);
      record.computePipelines.set(p, makeComputePipelineInfo(record, args[0] || {}));
      idOf2(record, p, "cp");
      return p;
    });
    patchMethod(device, "createQuerySet", (orig, args) => {
      const q = orig(...args);
      record.querySets.add(q);
      idOf2(record, q, "qs");
      return q;
    });
    patchMethod(device, "importExternalTexture", (orig, args) => {
      const t = orig(...args);
      record.externalTextures.add(t);
      idOf2(record, t, "et");
      return t;
    });
    patchMethod(device, "createCommandEncoder", (orig, args) => {
      const enc = orig(...args);
      instrumentCommandEncoder(enc, record);
      return enc;
    });
    patchMethod(device, "createRenderBundleEncoder", (orig, args) => {
      const enc = orig(...args);
      instrumentRenderPass(
        enc,
        record,
        /*isBundle*/
        true
      );
      return enc;
    });
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
  function instrumentCommandEncoder(enc, record) {
    if (!enc || enc[PATCHED2]) return;
    enc[PATCHED2] = true;
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
    for (const m of ["copyBufferToBuffer", "copyBufferToTexture", "copyTextureToBuffer", "copyTextureToTexture"]) {
      patchMethod(enc, m, (orig, args) => {
        record.frame._copies++;
        record.totals.copies++;
        return orig(...args);
      });
    }
  }
  function instrumentRenderPass(pass, record, isBundle, beginDesc) {
    if (!pass || pass[PATCHED2]) return;
    pass[PATCHED2] = true;
    const state = { pipeline: null, indexFormat: null };
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
      record.frame._bundleExecutes += args[0]?.length || 0;
      return orig(...args);
    });
  }
  function instrumentComputePass(pass, record) {
    if (!pass || pass[PATCHED2]) return;
    pass[PATCHED2] = true;
    const state = { pipeline: null };
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
    const stats = classifyDraw2(topology, count, instances);
    const pipelineId = pipeline ? idOf2(record, pipeline, "rp") : null;
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
    if (info) {
      info._drawsF = (info._drawsF || 0) + 1;
      info._vertsF = (info._vertsF || 0) + stats.vertices;
      info._totalDraws = (info._totalDraws || 0) + 1;
      info._totalVerts = (info._totalVerts || 0) + stats.vertices;
    }
    if (passEntry) passEntry.draws++;
    pushDraw2(record, {
      method,
      pipelineId,
      topology,
      kind: stats.kind,
      vertices: stats.vertices,
      primitives: stats.primitives,
      instances: stats.instances,
      bundle: !!isBundle
    });
  }
  function recordDispatch(record, pipeline, method, x, y, z, passEntry) {
    const info = pipeline ? record.computePipelines.get(pipeline) : null;
    const pipelineId = pipeline ? idOf2(record, pipeline, "cp") : null;
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
  function describeRenderPass(record, beginDesc) {
    const colorAttachments = [];
    for (const a of beginDesc.colorAttachments || []) {
      if (!a) {
        colorAttachments.push(null);
        continue;
      }
      const info = a.view ? VIEW_TO_TEXTURE.get(a.view) : null;
      const texId = info?.texture ? idOf2(record, info.texture, "t") : null;
      const texInfo = info?.texture ? record.textures.get(info.texture) : null;
      colorAttachments.push({
        textureId: texId,
        format: texInfo?.format || null,
        loadOp: a.loadOp || null,
        storeOp: a.storeOp || null,
        isCanvas: !texId
        // canvas-derived views aren't tracked, so this is a strong hint
      });
    }
    let depth = null;
    if (beginDesc.depthStencilAttachment) {
      const a = beginDesc.depthStencilAttachment;
      const info = a.view ? VIEW_TO_TEXTURE.get(a.view) : null;
      const texId = info?.texture ? idOf2(record, info.texture, "t") : null;
      const texInfo = info?.texture ? record.textures.get(info.texture) : null;
      depth = {
        textureId: texId,
        format: texInfo?.format || null,
        depthLoadOp: a.depthLoadOp || null,
        depthStoreOp: a.depthStoreOp || null
      };
    }
    return {
      kind: "render",
      label: beginDesc.label || null,
      draws: 0,
      dispatches: 0,
      attachments: colorAttachments,
      depth
    };
  }
  function validateBindGroupAgainstLayout(record, bgId, bgLabel, layout, entries) {
    if (!layout) return;
    const layoutInfo = record.bindGroupLayouts.get(layout);
    if (!layoutInfo || !layoutInfo.explicit) return;
    const byBinding = /* @__PURE__ */ new Map();
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
      const offset = res.offset | 0 || 0;
      const declared = res.size != null ? res.size | 0 : bufInfo.size - offset;
      if (declared < minBindingSize) {
        pushWarning(record, {
          severity: "error",
          source: "static",
          kind: "BindingSizeTooSmall",
          message: `bind group ${bgId}${bgLabel ? ` "${bgLabel}"` : ""}: entry @binding(${e.binding}) bound buffer slice is ${declared}B, layout requires minBindingSize ${minBindingSize}B`,
          refs: { bindGroup: bgId, binding: e.binding, buffer: idOf2(record, res.buffer, "b") }
        });
      }
    }
  }
  function normalizeExtent(size) {
    if (Array.isArray(size)) {
      return { width: size[0] | 0, height: size[1] | 0 || 1, depthOrArrayLayers: size[2] | 0 || 1 };
    }
    return {
      width: size?.width | 0 || 1,
      height: size?.height | 0 || 1,
      depthOrArrayLayers: size?.depthOrArrayLayers | 0 || 1
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
        moduleId: idOf2(record, desc.vertex.module, "sh") || null,
        entryPoint: desc.vertex.entryPoint || null,
        buffers: (desc.vertex.buffers || []).map((b) => ({
          arrayStride: b?.arrayStride ?? 0,
          stepMode: b?.stepMode || "vertex",
          attributes: (b?.attributes || []).map((a) => ({
            shaderLocation: a.shaderLocation,
            format: a.format,
            offset: a.offset
          }))
        }))
      } : null,
      fragment: desc.fragment ? {
        moduleId: idOf2(record, desc.fragment.module, "sh") || null,
        entryPoint: desc.fragment.entryPoint || null,
        targets: (desc.fragment.targets || []).map((t) => ({
          format: t?.format || null,
          blend: !!t?.blend
        }))
      } : null,
      depthStencil: desc.depthStencil ? {
        format: desc.depthStencil.format || null,
        depthWriteEnabled: !!desc.depthStencil.depthWriteEnabled,
        depthCompare: desc.depthStencil.depthCompare || null
      } : null,
      multisample: desc.multisample ? {
        count: desc.multisample.count || 1
      } : { count: 1 }
    };
  }
  function makeComputePipelineInfo(record, desc) {
    return {
      label: desc.label || null,
      layoutKind: desc.layout === "auto" ? "auto" : "explicit",
      compute: desc.compute ? {
        moduleId: idOf2(record, desc.compute.module, "sh") || null,
        entryPoint: desc.compute.entryPoint || null
      } : null
    };
  }
  function summarizeBGLEntry(e) {
    const t = e.buffer ? "buffer" : e.sampler ? "sampler" : e.texture ? "texture" : e.storageTexture ? "storageTexture" : e.externalTexture ? "externalTexture" : "unknown";
    return {
      binding: e.binding,
      visibility: visibilityFlags(e.visibility),
      kind: t,
      detail: e[t] ? { ...e[t] } : null
    };
  }
  function visibilityFlags(mask) {
    const out = [];
    if (mask & 1) out.push("VERTEX");
    if (mask & 2) out.push("FRAGMENT");
    if (mask & 4) out.push("COMPUTE");
    return out;
  }
  function summarizeBGResource(record, res) {
    if (!res) return null;
    if (res.buffer) {
      return {
        kind: "bufferBinding",
        buffer: res.buffer,
        // raw object, used for static validation
        bufferId: idOf2(record, res.buffer, "b") || null,
        offset: res.offset || 0,
        size: res.size || null
      };
    }
    if (typeof GPUTextureView !== "undefined" && res instanceof GPUTextureView) {
      const lineage = VIEW_TO_TEXTURE.get(res);
      return {
        kind: "textureView",
        label: res.label || null,
        textureId: lineage?.texture ? idOf2(record, lineage.texture, "t") : null,
        viewDesc: lineage?.viewDesc || null
      };
    }
    if (typeof GPUSampler !== "undefined" && res instanceof GPUSampler) {
      return { kind: "sampler", id: idOf2(record, res, "s") || null };
    }
    if (typeof GPUExternalTexture !== "undefined" && res instanceof GPUExternalTexture) {
      return { kind: "externalTexture", id: idOf2(record, res, "et") || null };
    }
    return { kind: "unknown" };
  }

  // src/core-webgpu/extract.js
  function idFor2(record, resource, fallback) {
    return record.ids.get(resource) || fallback;
  }
  function extractDevice(record) {
    return {
      label: record.device?.label || null,
      adapterInfo: record.adapterInfo || null,
      canvas: record.canvas ? {
        width: record.canvas.width,
        height: record.canvas.height,
        id: record.canvas.id || null
      } : null,
      canvasFormat: record.canvasFormat || null,
      frame: {
        fps: record.frame.fps,
        frameMs: record.frame.frameMs,
        drawCalls: record.frame.drawCalls,
        dispatchCalls: record.frame.dispatchCalls,
        vertices: record.frame.vertices,
        triangles: record.frame.triangles,
        lines: record.frame.lines,
        points: record.frame.points,
        renderPasses: record.frame.renderPasses,
        computePasses: record.frame.computePasses,
        submits: record.frame.submits,
        copies: record.frame.copies,
        workgroups: record.frame.workgroups,
        writeBuffer: record.frame.writeBuffer,
        writeTexture: record.frame.writeTexture,
        draws: record.frame.draws.slice(),
        dispatches: record.frame.dispatches.slice(),
        passes: (record.frame.passes || []).map((p) => ({ ...p }))
      },
      warnings: (record.warnings || []).map((w) => ({
        severity: w.severity,
        source: w.source,
        kind: w.kind,
        message: w.message,
        count: w.count,
        time: w.time,
        refs: w.refs || null
      })),
      totals: { ...record.totals },
      inventory: {
        buffers: record.buffers.size,
        textures: record.textures.size,
        samplers: record.samplers.size,
        shaderModules: record.shaderModules.size,
        bindGroups: record.bindGroups.size,
        bindGroupLayouts: record.bindGroupLayouts.size,
        pipelineLayouts: record.pipelineLayouts.size,
        renderPipelines: record.renderPipelines.size,
        computePipelines: record.computePipelines.size,
        querySets: record.querySets.size,
        externalTextures: record.externalTextures.size,
        buffersByKind: bufferBreakdown2(record)
      },
      buffers: extractBuffers2(record),
      textures: extractTextures2(record),
      samplers: extractSamplers(record),
      shaderModules: extractShaderModules(record),
      renderPipelines: extractRenderPipelines(record),
      computePipelines: extractComputePipelines(record),
      bindGroupLayouts: extractBindGroupLayouts(record),
      bindGroups: extractBindGroups(record)
    };
  }
  function bufferBreakdown2(record) {
    const by = { VERTEX: 0, INDEX: 0, UNIFORM: 0, STORAGE: 0, INDIRECT: 0, OTHER: 0 };
    for (const [, info] of record.buffers) {
      const flags = info.usageFlags || [];
      if (flags.includes("VERTEX")) by.VERTEX++;
      else if (flags.includes("INDEX")) by.INDEX++;
      else if (flags.includes("UNIFORM")) by.UNIFORM++;
      else if (flags.includes("STORAGE")) by.STORAGE++;
      else if (flags.includes("INDIRECT")) by.INDIRECT++;
      else by.OTHER++;
    }
    return by;
  }
  function extractBuffers2(record) {
    const out = [];
    for (const [b, info] of record.buffers) {
      out.push({
        id: idFor2(record, b, "b?"),
        label: info.label,
        size: info.size,
        usageFlags: info.usageFlags,
        mappedAtCreation: info.mappedAtCreation
      });
    }
    return out;
  }
  function extractTextures2(record) {
    const out = [];
    for (const [t, info] of record.textures) {
      out.push({
        id: idFor2(record, t, "t?"),
        label: info.label,
        width: info.width,
        height: info.height,
        depthOrArrayLayers: info.depthOrArrayLayers,
        format: info.format,
        dimension: info.dimension,
        mipLevelCount: info.mipLevelCount,
        sampleCount: info.sampleCount,
        usageFlags: info.usageFlags
      });
    }
    return out;
  }
  function extractSamplers(record) {
    const out = [];
    for (const [s, info] of record.samplers) {
      out.push({ id: idFor2(record, s, "s?"), ...info });
    }
    return out;
  }
  function extractShaderModules(record) {
    const out = [];
    for (const [m, info] of record.shaderModules) {
      out.push({
        id: idFor2(record, m, "sh?"),
        label: info.label,
        sourceLength: info.sourceLength,
        code: info.code
      });
    }
    return out;
  }
  function extractRenderPipelines(record) {
    const out = [];
    for (const [p, info] of record.renderPipelines) {
      out.push({
        id: idFor2(record, p, "rp?"),
        label: info.label,
        topology: info.topology,
        cullMode: info.cullMode,
        frontFace: info.frontFace,
        layoutKind: info.layoutKind,
        vertex: info.vertex,
        fragment: info.fragment,
        depthStencil: info.depthStencil,
        multisample: info.multisample,
        drawsF: info._drawsF || 0,
        vertsF: info._vertsF || 0,
        totalDraws: info._totalDraws || 0,
        totalVerts: info._totalVerts || 0
      });
    }
    return out;
  }
  function extractComputePipelines(record) {
    const out = [];
    for (const [p, info] of record.computePipelines) {
      out.push({
        id: idFor2(record, p, "cp?"),
        label: info.label,
        layoutKind: info.layoutKind,
        compute: info.compute,
        dispatchesF: info._dispatchesF || 0,
        wgF: info._wgF || 0,
        totalDispatches: info._totalDispatches || 0,
        totalWorkgroups: info._totalWorkgroups || 0
      });
    }
    return out;
  }
  function extractBindGroupLayouts(record) {
    const out = [];
    for (const [l, info] of record.bindGroupLayouts) {
      out.push({
        id: idFor2(record, l, "bgl?"),
        label: info.label,
        explicit: info.explicit,
        entries: info.entries
      });
    }
    return out;
  }
  function extractBindGroups(record) {
    const out = [];
    for (const [g, info] of record.bindGroups) {
      out.push({
        id: idFor2(record, g, "bg?"),
        label: info.label,
        layoutId: info.layoutId,
        entries: (info.entries || []).map((e) => ({
          binding: e.binding,
          resource: cleanResource(e.resource)
        }))
      });
    }
    return out;
  }
  function cleanResource(res) {
    if (!res) return null;
    if (res.kind === "bufferBinding") {
      return { kind: res.kind, bufferId: res.bufferId, offset: res.offset, size: res.size };
    }
    return { ...res };
  }

  // src/core-webgpu/analyzer.js
  var MAX_DRAWS_PER_FRAME2 = 2e3;
  var MAX_WARNINGS = 200;
  function idOf2(record, resource, prefix) {
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
  function pushDraw2(record, entry) {
    if (record.frame._draws.length < MAX_DRAWS_PER_FRAME2) {
      record.frame._draws.push(entry);
    }
  }
  function pushDispatch(record, entry) {
    if (record.frame._dispatches.length < MAX_DRAWS_PER_FRAME2) {
      record.frame._dispatches.push(entry);
    }
  }
  function pushWarning(record, w) {
    if (!record) return;
    const entry = { ...w, time: Date.now() };
    const last2 = record.warnings[0];
    if (last2 && last2.message === entry.message && last2.kind === entry.kind) {
      last2.count = (last2.count || 1) + 1;
      last2.time = entry.time;
      return;
    }
    entry.count = 1;
    record.warnings.unshift(entry);
    if (record.warnings.length > MAX_WARNINGS) record.warnings.length = MAX_WARNINGS;
  }
  function makeDeviceRecord(device, adapter) {
    return {
      device,
      adapter,
      canvas: null,
      canvasFormat: null,
      adapterInfo: adapter?.info ? {
        vendor: adapter.info.vendor || null,
        architecture: adapter.info.architecture || null,
        device: adapter.info.device || null,
        description: adapter.info.description || null
      } : null,
      ids: /* @__PURE__ */ new Map(),
      counters: {},
      // resources
      buffers: /* @__PURE__ */ new Map(),
      textures: /* @__PURE__ */ new Map(),
      samplers: /* @__PURE__ */ new Map(),
      shaderModules: /* @__PURE__ */ new Map(),
      bindGroups: /* @__PURE__ */ new Map(),
      bindGroupLayouts: /* @__PURE__ */ new Map(),
      pipelineLayouts: /* @__PURE__ */ new Map(),
      renderPipelines: /* @__PURE__ */ new Map(),
      computePipelines: /* @__PURE__ */ new Map(),
      querySets: /* @__PURE__ */ new Set(),
      externalTextures: /* @__PURE__ */ new Set(),
      // accumulating warnings/errors across the lifetime of the device
      warnings: [],
      // live per-frame stats
      frame: {
        fps: 0,
        frameMs: 0,
        drawCalls: 0,
        dispatchCalls: 0,
        vertices: 0,
        triangles: 0,
        lines: 0,
        points: 0,
        renderPasses: 0,
        computePasses: 0,
        submits: 0,
        copies: 0,
        workgroups: 0,
        writeBuffer: 0,
        writeTexture: 0,
        draws: [],
        dispatches: [],
        passes: [],
        // accumulators
        _drawCalls: 0,
        _dispatchCalls: 0,
        _vertices: 0,
        _triangles: 0,
        _lines: 0,
        _points: 0,
        _renderPasses: 0,
        _computePasses: 0,
        _submits: 0,
        _copies: 0,
        _workgroups: 0,
        _writeBuffer: 0,
        _writeTexture: 0,
        _bundleExecutes: 0,
        _draws: [],
        _dispatches: [],
        _passes: []
      },
      totals: {
        drawCalls: 0,
        dispatchCalls: 0,
        vertices: 0,
        triangles: 0,
        lines: 0,
        points: 0,
        renderPasses: 0,
        computePasses: 0,
        submits: 0,
        copies: 0,
        workgroups: 0,
        writeBuffer: 0,
        writeTexture: 0
      }
    };
  }
  var WebGPUAnalyzer = class {
    constructor() {
      this.records = /* @__PURE__ */ new Map();
      this._installed = false;
      this._unsubFrame = null;
      this._frameListeners = /* @__PURE__ */ new Set();
    }
    install() {
      if (this._installed) return this;
      if (typeof navigator === "undefined" || !navigator.gpu) return this;
      this._installed = true;
      patchGPU(
        (device, adapter, desc) => this._onDevice(device, adapter, desc),
        (device, canvas, configureDesc) => this._onContext(device, canvas, configureDesc)
      );
      patchDevicePrototype((device) => this._onDevice(device, null, null));
      this._unsubFrame = onFrame((tick2) => this._onTick(tick2));
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
      patchDevicePrototype((device) => this._onDevice(device, null, null));
      if (typeof globalThis === "undefined") return this;
      const found = /* @__PURE__ */ new Set();
      const visited = /* @__PURE__ */ new WeakSet();
      const SCAN_DEPTH = 4;
      const MAX_KEYS = 400;
      const looksLikeDevice = (o) => o && typeof o === "object" && o.queue && o.features && o.limits && typeof o.createBuffer === "function" && typeof o.createShaderModule === "function";
      const walk = (obj, depth) => {
        if (depth < 0 || !obj || typeof obj !== "object" || visited.has(obj)) return;
        visited.add(obj);
        let keys;
        try {
          keys = Object.keys(obj);
        } catch (_) {
          return;
        }
        if (keys.length > MAX_KEYS) keys = keys.slice(0, MAX_KEYS);
        for (const k of keys) {
          let v;
          try {
            v = obj[k];
          } catch (_) {
            continue;
          }
          if (!v || typeof v !== "object") continue;
          if (looksLikeDevice(v)) {
            found.add(v);
            continue;
          }
          if (depth > 0) walk(v, depth - 1);
        }
      };
      try {
        walk(globalThis, SCAN_DEPTH);
      } catch (_) {
      }
      for (const device of found) this._onDevice(device, null);
      return this;
    }
    _onContext(device, canvas, configureDesc) {
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
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        url: typeof location !== "undefined" ? location.href : null,
        devices
      };
    }
    report() {
      const snap = this.data();
      console.log(
        `%c[wgpu-analyzer]%c ${snap.devices.length} device(s)`,
        "color:#f0c;font-weight:bold",
        "color:#888"
      );
      for (const d of snap.devices) {
        console.groupCollapsed(
          `%cdevice  ${d.inventory.buffers}b ${d.inventory.textures}t ${d.inventory.renderPipelines}rp ${d.inventory.computePipelines}cp`,
          "color:#f0c;font-weight:bold"
        );
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
          info._totalDraws = 0;
          info._totalVerts = 0;
        }
        for (const [, info] of r.computePipelines) {
          info._totalDispatches = 0;
          info._totalWorkgroups = 0;
        }
      }
    }
    onFrame(fn) {
      this._frameListeners.add(fn);
      return () => this._frameListeners.delete(fn);
    }
    _onTick(tick2) {
      for (const [, r] of this.records) {
        r.frame.fps = tick2.fps;
        r.frame.frameMs = tick2.dt;
        r.frame.drawCalls = r.frame._drawCalls;
        r.frame.dispatchCalls = r.frame._dispatchCalls;
        r.frame.vertices = r.frame._vertices;
        r.frame.triangles = r.frame._triangles;
        r.frame.lines = r.frame._lines;
        r.frame.points = r.frame._points;
        r.frame.renderPasses = r.frame._renderPasses;
        r.frame.computePasses = r.frame._computePasses;
        r.frame.submits = r.frame._submits;
        r.frame.copies = r.frame._copies;
        r.frame.workgroups = r.frame._workgroups;
        r.frame.writeBuffer = r.frame._writeBuffer;
        r.frame.writeTexture = r.frame._writeTexture;
        r.frame.draws = r.frame._draws;
        r.frame.dispatches = r.frame._dispatches;
        r.frame.passes = r.frame._passes;
        r.frame._drawCalls = 0;
        r.frame._dispatchCalls = 0;
        r.frame._vertices = 0;
        r.frame._triangles = 0;
        r.frame._lines = 0;
        r.frame._points = 0;
        r.frame._renderPasses = 0;
        r.frame._computePasses = 0;
        r.frame._submits = 0;
        r.frame._copies = 0;
        r.frame._workgroups = 0;
        r.frame._writeBuffer = 0;
        r.frame._writeTexture = 0;
        r.frame._bundleExecutes = 0;
        r.frame._draws = [];
        r.frame._dispatches = [];
        r.frame._passes = [];
        for (const [, info] of r.renderPipelines) {
          info._drawsF = 0;
          info._vertsF = 0;
        }
        for (const [, info] of r.computePipelines) {
          info._dispatchesF = 0;
          info._wgF = 0;
        }
      }
      for (const fn of this._frameListeners) {
        try {
          fn(this);
        } catch (_) {
        }
      }
    }
  };
  function getWebGPUAnalyzer() {
    const KEY = "__wgpua_instance";
    if (typeof globalThis !== "undefined" && globalThis[KEY]) return globalThis[KEY];
    const a = new WebGPUAnalyzer();
    if (typeof globalThis !== "undefined") globalThis[KEY] = a;
    return a;
  }

  // src/core/scene.js
  var TEXTURE_MAP_KEYS = [
    "map",
    "normalMap",
    "roughnessMap",
    "metalnessMap",
    "emissiveMap",
    "aoMap",
    "alphaMap",
    "bumpMap",
    "displacementMap",
    "envMap",
    "lightMap",
    "specularMap",
    "gradientMap",
    "matcap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "sheenColorMap",
    "sheenRoughnessMap",
    "transmissionMap",
    "thicknessMap",
    "iridescenceMap",
    "iridescenceThicknessMap"
  ];
  var SceneTracker = class {
    constructor() {
      this.scenes = [];
      this.models = [];
    }
    attach(scene, opts = {}) {
      if (!scene || this.scenes.find((s) => s.scene === scene)) return this;
      this.scenes.push({
        scene,
        label: opts.label || scene.name || `scene${this.scenes.length}`,
        renderer: opts.renderer || null
      });
      if (Array.isArray(opts.models)) {
        for (const m of opts.models) this.attachModel(m.root || m.scene, m);
      }
      return this;
    }
    detach(scene) {
      const i = this.scenes.findIndex((s) => s.scene === scene);
      if (i >= 0) this.scenes.splice(i, 1);
      return this;
    }
    // Register a loaded asset root (e.g. gltf.scene) so the Scene tab can
    // group its meshes/textures separately from procedural primitives.
    attachModel(root, opts = {}) {
      if (!root || this.models.find((m) => m.root === root)) return this;
      this.models.push({
        root,
        label: opts.label || root.name || `model${this.models.length}`,
        source: opts.source || null,
        kind: opts.kind || guessModelKind(opts.source)
      });
      return this;
    }
    detachModel(root) {
      const i = this.models.findIndex((m) => m.root === root);
      if (i >= 0) this.models.splice(i, 1);
      return this;
    }
    has() {
      return this.scenes.length > 0;
    }
  };
  function guessModelKind(source) {
    if (!source) return "model";
    const s = String(source).toLowerCase();
    if (s.endsWith(".glb")) return "glb";
    if (s.endsWith(".gltf")) return "gltf";
    if (s.endsWith(".obj")) return "obj";
    if (s.endsWith(".fbx")) return "fbx";
    if (s.endsWith(".usdz")) return "usdz";
    if (s.endsWith(".ply")) return "ply";
    if (s.endsWith(".stl")) return "stl";
    return "model";
  }
  function snapshotScene(scene, models = []) {
    const meshes = [];
    const lights = [];
    const cameras = [];
    const geometries = /* @__PURE__ */ new Set();
    const materials = /* @__PURE__ */ new Set();
    const textures = /* @__PURE__ */ new Map();
    let nodeCount = 0;
    let totalVerts = 0;
    let totalTris = 0;
    let totalInstances = 0;
    let drawCallEstimate = 0;
    const modelStats = models.map((m) => ({
      label: m.label,
      source: m.source,
      kind: m.kind,
      rootName: m.root?.name || null,
      visible: m.root ? !!m.root.visible : true,
      nodes: 0,
      meshes: 0,
      instancedMeshes: 0,
      instances: 0,
      vertices: 0,
      triangles: 0,
      geometries: /* @__PURE__ */ new Set(),
      materials: /* @__PURE__ */ new Set(),
      textures: /* @__PURE__ */ new Map(),
      meshList: []
    }));
    const modelRoots = models.map((m) => m.root);
    function modelIndexOf(o) {
      if (!modelRoots.length) return -1;
      if (o.__wgla_modelIdx != null) return o.__wgla_modelIdx;
      let p = o;
      while (p) {
        const i = modelRoots.indexOf(p);
        if (i >= 0) {
          o.__wgla_modelIdx = i;
          return i;
        }
        p = p.parent;
      }
      o.__wgla_modelIdx = -1;
      return -1;
    }
    scene.traverse((o) => {
      nodeCount++;
      const mi = modelIndexOf(o);
      if (mi >= 0) modelStats[mi].nodes++;
      if (o.isLight) lights.push(o);
      if (o.isCamera) cameras.push(o);
      if (!(o.isMesh || o.isPoints || o.isLine || o.isLineSegments || o.isSkinnedMesh)) return;
      const geo = o.geometry;
      if (geo) geometries.add(geo);
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        materials.add(m);
        for (const k of TEXTURE_MAP_KEYS) {
          const t = m[k];
          if (t && t.isTexture) {
            let entry = textures.get(t);
            if (!entry) {
              entry = { count: 0, refKeys: /* @__PURE__ */ new Set() };
              textures.set(t, entry);
            }
            entry.count++;
            entry.refKeys.add(k);
          }
        }
      }
      const isInstanced = !!o.isInstancedMesh;
      const instanceCount = isInstanced ? o.count || 0 : 1;
      const verts = geo?.attributes?.position?.count || 0;
      const tris = computeTriangleCount(o);
      totalVerts += verts;
      totalTris += tris * instanceCount;
      totalInstances += isInstanced ? instanceCount : 0;
      drawCallEstimate += mats.length || 1;
      const meshEntry = {
        object: o,
        name: o.name || "(unnamed)",
        kind: o.isPoints ? "points" : o.isLineSegments ? "lineSegments" : o.isLine ? "line" : o.isSkinnedMesh ? "skinnedMesh" : isInstanced ? "instancedMesh" : "mesh",
        isInstanced,
        instanceCount,
        vertices: verts,
        triangles: tris,
        materialCount: mats.length,
        materials: mats,
        geometryUuid: geo?.uuid || null,
        attributeKeys: geo ? Object.keys(geo.attributes || {}) : [],
        hasIndex: !!geo?.index,
        visible: !!o.visible,
        modelIndex: mi
      };
      meshes.push(meshEntry);
      if (mi >= 0) {
        const ms = modelStats[mi];
        ms.meshes++;
        if (isInstanced) ms.instancedMeshes++;
        ms.instances += isInstanced ? instanceCount : 0;
        ms.vertices += verts;
        ms.triangles += tris * instanceCount;
        if (geo) ms.geometries.add(geo);
        for (const m of mats) {
          ms.materials.add(m);
          for (const k of TEXTURE_MAP_KEYS) {
            const t = m[k];
            if (t && t.isTexture) {
              let entry = ms.textures.get(t);
              if (!entry) {
                entry = { count: 0, refKeys: /* @__PURE__ */ new Set() };
                ms.textures.set(t, entry);
              }
              entry.count++;
              entry.refKeys.add(k);
            }
          }
        }
        ms.meshList.push(meshEntry);
      }
    });
    return {
      nodeCount,
      meshes,
      lights,
      cameras,
      uniqueGeometries: geometries.size,
      uniqueMaterials: materials.size,
      uniqueTextures: textures.size,
      totalVerts,
      totalTris,
      totalInstances,
      drawCallEstimate,
      textures: [...textures.entries()].map(([t, info]) => textureSummary(t, info)),
      models: modelStats.map((ms) => ({
        label: ms.label,
        source: ms.source,
        kind: ms.kind,
        rootName: ms.rootName,
        visible: ms.visible,
        nodes: ms.nodes,
        meshes: ms.meshes,
        instancedMeshes: ms.instancedMeshes,
        instances: ms.instances,
        vertices: ms.vertices,
        triangles: ms.triangles,
        uniqueGeometries: ms.geometries.size,
        uniqueMaterials: ms.materials.size,
        uniqueTextures: ms.textures.size,
        meshList: ms.meshList,
        textures: [...ms.textures.entries()].map(([t, info]) => textureSummary(t, info))
      }))
    };
  }
  function textureSummary(t, info) {
    return {
      texture: t,
      count: info.count,
      refKeys: [...info.refKeys],
      width: t.image?.width || t.source?.data?.width || 0,
      height: t.image?.height || t.source?.data?.height || 0,
      format: textureFormatLabel(t),
      colorSpace: t.colorSpace || null,
      flipY: !!t.flipY,
      generateMipmaps: !!t.generateMipmaps,
      anisotropy: t.anisotropy || 1,
      isCompressed: !!t.isCompressedTexture,
      name: t.name || ""
    };
  }
  function computeTriangleCount(o) {
    const geo = o.geometry;
    if (!geo) return 0;
    if (o.isPoints || o.isLine || o.isLineSegments) return 0;
    if (geo.index) return geo.index.count / 3 | 0;
    const pos = geo.attributes?.position;
    return pos ? pos.count / 3 | 0 : 0;
  }
  function textureFormatLabel(t) {
    return t.type != null && t.format != null ? `${t.format}/${t.type}` : t.format ?? "?";
  }
  function getSceneTracker() {
    const KEY = "__wgla_scene_tracker";
    if (typeof globalThis !== "undefined" && globalThis[KEY]) return globalThis[KEY];
    const t = new SceneTracker();
    if (typeof globalThis !== "undefined") globalThis[KEY] = t;
    return t;
  }

  // src/ui/hud.js
  var HUD_ID = "__wgla_hud";
  var STYLE_ID = "__wgla_styles";
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
    #${HUD_ID} { font: 11px ui-monospace, Menlo, monospace; color: #eee; }
    #${HUD_ID} button { font: inherit; }
    .wgla-row {
      display: flex; justify-content: space-between; gap: 12px;
      padding: 2px 6px; font-variant-numeric: tabular-nums;
    }
    .wgla-row:nth-child(odd)  { background: rgba(255,255,255,0.05); }
    .wgla-row.clickable       { cursor: pointer; }
    .wgla-row.clickable:hover { background: rgba(11,187,255,0.15); }
    .wgla-row > span:first-child  { color: #888; }
    .wgla-row > span:last-child   { color: #eee; text-align: right; }

    .wgla-trow {
      display: grid; gap: 8px; padding: 3px 6px;
      font-variant-numeric: tabular-nums; cursor: pointer;
    }
    .wgla-trow:nth-child(odd)  { background: rgba(255,255,255,0.05); }
    .wgla-trow:hover           { background: rgba(11,187,255,0.15); }
    .wgla-thead {
      display: grid; gap: 8px; padding: 3px 6px;
      color: #666; font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.5px; border-bottom: 1px solid #222;
    }
    .wgla-sect {
      color: #666; text-transform: uppercase; font-size: 10px;
      letter-spacing: 0.5px; margin: 10px 0 4px; padding: 0 6px;
    }
    .wgla-sect.collapsible {
      cursor: pointer; user-select: none; display: flex;
      align-items: center; gap: 6px; padding: 2px 6px;
      border-radius: 3px;
    }
    .wgla-sect.collapsible:hover { background: rgba(255,255,255,0.04); color: #aaa; }
    .wgla-sect .caret { color: #555; font-size: 9px; width: 8px; display: inline-block; }
    .wgla-sect .count { color: #0bf; margin-left: auto; text-transform: none; font-size: 10px; }
    .wgla-empty { color: #666; padding: 8px 6px; }
    .wgla-btn {
      background: #181818; color: #ddd;
      border: 1px solid #2a2a2a; border-radius: 4px;
      padding: 3px 8px; cursor: pointer;
    }
    .wgla-btn:hover { background: #222; }
    .wgla-tab {
      flex: 1 1 0; padding: 5px 4px; background: transparent;
      color: #888; border: none; border-bottom: 1px solid transparent;
      cursor: pointer;
    }
    .wgla-tab:hover { color: #ccc; }
    .wgla-tab.active {
      color: #0bf; background: #181820;
      border-bottom: 1px solid #0bf;
    }
    .wgla-iconbtn {
      background: transparent; border: none; color: #888;
      cursor: pointer; padding: 0 6px;
    }
    .wgla-iconbtn:hover { color: #ddd; }
    .wgla-select {
      background: #181818; color: #ddd;
      border: 1px solid #2a2a2a; border-radius: 4px;
      padding: 2px 6px; font: inherit; cursor: pointer; width: 100%;
    }
    .wgla-link {
      color: #0bf; cursor: pointer; text-decoration: underline;
    }
    .wgla-pre {
      margin: 0 6px; padding: 6px 8px;
      background: #0a0a0a; border: 1px solid #1f1f1f; border-radius: 4px;
      color: #cde; font: 10px/1.35 ui-monospace, Menlo, monospace;
      max-height: 240px; overflow: auto; white-space: pre;
    }
    .wgla-canvas-highlight {
      outline: 2px solid #0bf !important;
      outline-offset: 2px !important;
    }
    .wgla-ctxchip {
      color: #888; font-size: 10px;
      padding: 1px 4px; border: 1px solid #2a2a2a; border-radius: 3px;
      margin-right: 4px;
    }
    .wgla-warn {
      padding: 4px 8px; margin: 2px 6px;
      border-left: 3px solid #f55; background: rgba(255,80,80,0.08);
      color: #fbb; font: 10px/1.4 ui-monospace, Menlo, monospace;
      white-space: pre-wrap; word-break: break-word; cursor: default;
      border-radius: 0 3px 3px 0;
    }
    .wgla-warn.info  { border-left-color: #0bf; background: rgba(0,180,255,0.06); color: #cde; }
    .wgla-warn.warn  { border-left-color: #fc3; background: rgba(255,200,50,0.06); color: #fec; }
    .wgla-warn .meta { color: #888; font-size: 9px; }
    .wgla-warn .count { color: #f88; margin-left: 6px; }
    .wgla-pillrow {
      display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 6px 6px;
    }
    .wgla-pill {
      display: inline-block; padding: 1px 6px;
      background: rgba(11,187,255,0.10); color: #9ce; border-radius: 3px;
      font-size: 10px;
    }
    .wgla-pill.gpu { background: rgba(255,0,200,0.12); color: #f9d; }
    .wgla-pill.bad { background: rgba(255,80,80,0.18); color: #fbb; }
    .wgla-pill.muted { background: rgba(255,255,255,0.06); color: #888; }
  `;
    document.head.appendChild(s);
  }
  function el(tag, styles, text) {
    const e = document.createElement(tag);
    if (styles) Object.assign(e.style, styles);
    if (text != null) e.textContent = text;
    return e;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function row(label, valueEl, onClick) {
    const r = el("div");
    r.className = "wgla-row" + (onClick ? " clickable" : "");
    r.appendChild(el("span", null, label));
    r.appendChild(valueEl);
    if (onClick) r.addEventListener("click", onClick);
    return r;
  }
  function tableHeader(cols, items) {
    const h = el("div");
    h.className = "wgla-thead";
    h.style.gridTemplateColumns = cols;
    for (const x of items) {
      const s = el("span");
      if (x.right) s.style.textAlign = "right";
      s.textContent = x.label;
      h.appendChild(s);
    }
    return h;
  }
  function tableRow(cols, onClick) {
    const r = el("div");
    r.className = "wgla-trow";
    r.style.gridTemplateColumns = cols;
    if (onClick) r.addEventListener("click", onClick);
    return r;
  }
  function section(text) {
    const e = el("div", null, text);
    e.className = "wgla-sect";
    return e;
  }
  function button(label, onClick) {
    const b = el("button", null, label);
    b.className = "wgla-btn";
    b.addEventListener("click", onClick);
    return b;
  }
  function fmtNum2(n) {
    if (n == null) return "\u2014";
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}G`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n | 0);
  }
  function fmtBytes2(n) {
    if (!n) return "0";
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
  }
  function fmtUniform(v) {
    if (v == null) return String(v);
    function s(n) {
      if (typeof n !== "number") return String(n);
      if (Number.isInteger(n)) return String(n);
      return n.toFixed(3).replace(/\.?0+$/, "");
    }
    if (Array.isArray(v)) {
      if (v.length > 4) return `[${v.slice(0, 4).map(s).join(", ")}, \u2026(${v.length})]`;
      return `[${v.map(s).join(", ")}]`;
    }
    return s(v);
  }
  function contextLetter(i) {
    return String.fromCharCode(65 + i);
  }
  var MESH_KIND_GLYPH = {
    mesh: "\u25B3",
    instancedMesh: "\u29C9",
    skinnedMesh: "\xBF",
    points: "\xB7",
    line: "\u2500",
    lineSegments: "\u22EE"
  };
  function makeKeyedList(parent, opts) {
    let countSpan = null, contentWrap = null, collapsed = false;
    if (opts.collapsible && opts.title) {
      const h = el("div", null);
      h.className = "wgla-sect collapsible";
      const caret = el("span", null, "\u25B8");
      caret.className = "caret";
      const lbl = el("span", null, opts.title);
      countSpan = el("span", null, "0");
      countSpan.className = "count";
      h.append(caret, lbl, countSpan);
      parent.appendChild(h);
      contentWrap = el("div");
      parent.appendChild(contentWrap);
      collapsed = opts.defaultCollapsed !== false;
      const apply = () => {
        contentWrap.style.display = collapsed ? "none" : "";
        caret.textContent = collapsed ? "\u25B8" : "\u25BE";
      };
      apply();
      h.addEventListener("click", () => {
        collapsed = !collapsed;
        apply();
        diff();
      });
      if (opts.headers) contentWrap.appendChild(tableHeader(opts.cols, opts.headers));
    } else {
      if (opts.title) parent.appendChild(section(opts.title));
      if (opts.headers) parent.appendChild(tableHeader(opts.cols, opts.headers));
      contentWrap = parent;
    }
    const container = el("div");
    const empty = el("div", null, opts.emptyText || "(none)");
    empty.className = "wgla-empty";
    contentWrap.appendChild(container);
    contentWrap.appendChild(empty);
    const rowMap = /* @__PURE__ */ new Map();
    function diff() {
      const items = opts.getItems() || [];
      if (countSpan) countSpan.textContent = String(items.length);
      if (collapsed) return;
      empty.style.display = items.length ? "none" : "";
      const seen = /* @__PURE__ */ new Set();
      let i = 0;
      for (const item of items) {
        const key = opts.getKey(item);
        seen.add(key);
        let entry = rowMap.get(key);
        if (!entry) {
          entry = opts.build(item);
          rowMap.set(key, entry);
          if (entry.row && !entry.row.__wgla_clickbound && opts.onClick) {
            entry.row.addEventListener("click", () => opts.onClick(entry.item));
            entry.row.__wgla_clickbound = true;
          }
        }
        entry.item = item;
        opts.update(entry, item);
        const expected = container.children[i];
        if (expected !== entry.row) container.insertBefore(entry.row, expected || null);
        i++;
      }
      for (const [key, entry] of [...rowMap]) {
        if (!seen.has(key)) {
          entry.row.remove();
          rowMap.delete(key);
        }
      }
    }
    return diff;
  }
  function findInWebGL(analyzer, id, contextIdx) {
    if (!analyzer) return null;
    const recs = [...analyzer.records.values()];
    const target = contextIdx != null && recs[contextIdx] ? [recs[contextIdx]] : recs;
    for (const r of target) {
      for (const [k, v] of r.ids) if (v === id) return { record: r, resource: k, ctxIdx: recs.indexOf(r) };
    }
    return null;
  }
  function findInWebGPU(analyzer, id, contextIdx) {
    if (!analyzer) return null;
    const recs = [...analyzer.records.values()];
    const target = contextIdx != null && recs[contextIdx] ? [recs[contextIdx]] : recs;
    for (const r of target) {
      for (const [k, v] of r.ids) if (v === id) return { record: r, resource: k, ctxIdx: recs.indexOf(r) };
    }
    return null;
  }
  function recordIndex(analyzer, rec) {
    let i = 0;
    for (const [, r] of analyzer.records) {
      if (r === rec) return i;
      i++;
    }
    return -1;
  }
  function mountHUD(analyzers) {
    ensureStyles();
    const { webgl: webgl2, webgpu: webgpu2, scenes: scenes2 } = analyzers;
    const existing = document.getElementById(HUD_ID);
    if (existing && existing.__wgla_unmount) existing.__wgla_unmount();
    else if (existing) existing.remove();
    const state = {
      tab: "live",
      detail: null,
      // { side, kind, id, contextIdx }
      selected: null,
      // { side, record } or null = All
      collapsed: false
    };
    let currentController = null;
    let dropdownSig = "";
    const root = el("div", {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "2147483647",
      width: "380px",
      maxHeight: "92vh",
      display: "flex",
      flexDirection: "column",
      background: "rgba(10,10,12,0.92)",
      border: "1px solid #2a2a2a",
      borderRadius: "6px",
      backdropFilter: "blur(8px)",
      boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
      userSelect: "none"
    });
    root.id = HUD_ID;
    const header = el("div", {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "6px 8px",
      borderBottom: "1px solid #222",
      cursor: "move"
    });
    const titleWrap = el("div");
    const title = el("span", { color: "#0bf", fontWeight: "bold" }, "gpu-probe");
    const badge = el("span", { color: "#666", marginLeft: "6px" }, "");
    titleWrap.append(title, badge);
    const collapseBtn = el("button", null, "\u25BE");
    collapseBtn.className = "wgla-iconbtn";
    const closeBtn = el("button", null, "\xD7");
    closeBtn.className = "wgla-iconbtn";
    const headerRight = el("div");
    headerRight.append(collapseBtn, closeBtn);
    header.append(titleWrap, headerRight);
    const ctxBar = el("div", {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "6px 8px",
      borderBottom: "1px solid #222"
    });
    ctxBar.appendChild(el("span", { color: "#888" }, "context:"));
    const ctxSelect = el("select");
    ctxSelect.className = "wgla-select";
    ctxBar.appendChild(ctxSelect);
    const tabbar = el("div", {
      display: "flex",
      background: "#0c0c0c",
      borderBottom: "1px solid #222"
    });
    const tabButtons = {};
    for (const t of [
      { key: "live", label: "Live" },
      { key: "frame", label: "Frame" },
      { key: "programs", label: "Programs" },
      { key: "resources", label: "Resources" },
      { key: "gpu", label: "GPU" },
      { key: "scene", label: "Scene" }
    ]) {
      const b = el("button", null, t.label);
      b.className = "wgla-tab";
      b.addEventListener("click", () => switchTab(t.key));
      tabButtons[t.key] = b;
      tabbar.appendChild(b);
    }
    const body = el("div", {
      padding: "6px 0",
      overflowY: "auto",
      flex: "1 1 auto",
      minHeight: "0",
      overscrollBehavior: "contain"
    });
    body.addEventListener("wheel", (e) => {
      e.stopPropagation();
    }, { passive: true });
    const footer = el("div", {
      display: "flex",
      gap: "4px",
      padding: "6px 8px",
      background: "#0c0c0c",
      borderTop: "1px solid #222"
    });
    footer.append(
      button("Scan", () => {
        webgl2?.scan?.();
        rebuildDropdown(true);
        rerenderCurrent();
      }),
      button("Report", () => {
        webgl2?.report?.();
        if (webgpu2?.records.size) webgpu2.report();
      }),
      button("JSON", () => downloadCombined(webgl2, webgpu2)),
      button("Reset", () => {
        webgl2?.reset?.();
        webgpu2?.reset?.();
        rerenderCurrent();
      })
    );
    root.append(header, ctxBar, tabbar, body, footer);
    document.body.appendChild(root);
    closeBtn.addEventListener("click", unmount);
    collapseBtn.addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      const dsp = state.collapsed ? "none" : "";
      ctxBar.style.display = dsp;
      tabbar.style.display = state.collapsed ? "none" : "flex";
      body.style.display = dsp;
      footer.style.display = state.collapsed ? "none" : "flex";
      collapseBtn.textContent = state.collapsed ? "\u25B8" : "\u25BE";
    });
    enableDrag(root, header);
    ctxSelect.addEventListener("change", () => {
      const v = ctxSelect.value;
      const next = v === "" ? null : parseSelectKey(v, webgl2, webgpu2);
      setSelected(next);
    });
    function setSelected(sel) {
      if (state.selected?.record?.canvas) {
        state.selected.record.canvas.classList.remove("wgla-canvas-highlight");
      }
      state.selected = sel;
      if (sel?.record?.canvas) sel.record.canvas.classList.add("wgla-canvas-highlight");
      rerenderCurrent();
    }
    function rebuildDropdown(force) {
      const sig = makeDropdownSignature(webgl2, webgpu2);
      if (!force && sig === dropdownSig) return;
      dropdownSig = sig;
      const prev = ctxSelect.value;
      clear(ctxSelect);
      const optAll = document.createElement("option");
      optAll.value = "";
      optAll.textContent = `All (${countContexts(webgl2, webgpu2)})`;
      ctxSelect.appendChild(optAll);
      if (webgl2) {
        let i = 0;
        for (const [, r] of webgl2.records) {
          const o = document.createElement("option");
          o.value = `webgl:${i}`;
          const c = r.canvas;
          const label = c?.id ? `#${c.id}` : c?.className ? `.${c.className.split(" ")[0]}` : `canvas[${i}]`;
          o.textContent = `${contextLetter(i)}\xB7[gl] ${label}  ${c ? `${c.width}\xD7${c.height}` : ""}`;
          ctxSelect.appendChild(o);
          i++;
        }
      }
      if (webgpu2) {
        let i = 0;
        const offset = webgl2 ? webgl2.records.size : 0;
        for (const [, r] of webgpu2.records) {
          const o = document.createElement("option");
          o.value = `webgpu:${i}`;
          const c = r.canvas;
          o.textContent = `${contextLetter(offset + i)}\xB7[gpu] ${c?.id ? `#${c.id}` : `dev[${i}]`}`;
          ctxSelect.appendChild(o);
          i++;
        }
      }
      if (state.selected) {
        const k = selectKeyFor(state.selected, webgl2, webgpu2);
        if (k) ctxSelect.value = k;
      } else if (prev && [...ctxSelect.options].some((o) => o.value === prev)) {
        ctxSelect.value = prev;
      }
    }
    function getActiveRecords(side) {
      const analyzer = side === "webgl" ? webgl2 : webgpu2;
      if (!analyzer) return [];
      const all = [...analyzer.records.values()];
      if (state.selected && state.selected.side === side && all.includes(state.selected.record)) {
        return [state.selected.record];
      }
      if (state.selected && state.selected.side !== side) return [];
      return all;
    }
    function showPrefix(side) {
      const analyzer = side === "webgl" ? webgl2 : webgpu2;
      if (!analyzer) return false;
      return state.selected == null && analyzer.records.size > 1;
    }
    function ctxIdxOf(side, rec) {
      const analyzer = side === "webgl" ? webgl2 : webgpu2;
      return recordIndex(analyzer, rec);
    }
    function idLabel(side, id, ctxIdx) {
      return (showPrefix(side) ? `${contextLetter(ctxIdx)}\xB7` : "") + (id || "?");
    }
    function switchTab(key) {
      state.tab = key;
      state.detail = null;
      for (const [k, b] of Object.entries(tabButtons)) b.classList.toggle("active", k === key);
      rerenderCurrent();
    }
    function rerenderCurrent() {
      clear(body);
      if (state.detail) currentController = buildDetailView(state.detail);
      else currentController = state.tab === "live" ? buildLiveTab() : state.tab === "frame" ? buildFrameTab() : state.tab === "programs" ? buildProgramsTab() : state.tab === "resources" ? buildResourcesTab() : state.tab === "gpu" ? buildGPUTab() : state.tab === "scene" ? buildSceneTab() : null;
      if (currentController) {
        body.appendChild(currentController.root);
        currentController.update?.();
      }
    }
    function openDetail(detail) {
      state.detail = detail;
      rerenderCurrent();
    }
    function buildLiveTab() {
      const r = el("div");
      const refs = {};
      const hasGL = !!(webgl2 && webgl2.records.size);
      const hasGPU = !!(webgpu2 && webgpu2.records.size);
      let gpuBox = null;
      if (hasGPU) {
        r.appendChild(section("WebGPU \xB7 frame"));
        gpuBox = el("div");
        refs.gpuFps = el("span", null, "\u2014");
        refs.gpuMs = el("span", null, "\u2014");
        refs.gpuDraws = el("span", null, "\u2014");
        refs.gpuDisp = el("span", null, "\u2014");
        refs.gpuVerts = el("span", null, "\u2014");
        refs.gpuTris = el("span", null, "\u2014");
        refs.gpuWG = el("span", null, "\u2014");
        refs.gpuRP = el("span", null, "\u2014");
        refs.gpuCP = el("span", null, "\u2014");
        refs.gpuSubmits = el("span", null, "\u2014");
        refs.gpuCopies = el("span", null, "\u2014");
        refs.gpuWB = el("span", null, "\u2014");
        refs.gpuWT = el("span", null, "\u2014");
        gpuBox.append(
          row("fps", refs.gpuFps),
          row("frame ms", refs.gpuMs),
          row("draws/f", refs.gpuDraws),
          row("dispatches/f", refs.gpuDisp),
          row("vertices/f", refs.gpuVerts),
          row("triangles/f", refs.gpuTris),
          row("workgroups/f", refs.gpuWG),
          row("renderPasses/f", refs.gpuRP),
          row("computePass/f", refs.gpuCP),
          row("submits/f", refs.gpuSubmits),
          row("copies/f", refs.gpuCopies),
          row("writeBuffer/f", refs.gpuWB),
          row("writeTexture/f", refs.gpuWT)
        );
        r.appendChild(gpuBox);
        r.appendChild(section("WebGPU \xB7 inventory"));
        const giBox = el("div");
        refs.gpuPipes = el("span", null, "\u2014");
        refs.gpuComp = el("span", null, "\u2014");
        refs.gpuShads = el("span", null, "\u2014");
        refs.gpuBGs = el("span", null, "\u2014");
        refs.gpuBGLs = el("span", null, "\u2014");
        refs.gpuBufs = el("span", null, "\u2014");
        refs.gpuTexs = el("span", null, "\u2014");
        refs.gpuSamps = el("span", null, "\u2014");
        giBox.append(
          row("renderPipelines", refs.gpuPipes),
          row("computePipelines", refs.gpuComp),
          row("shaderModules", refs.gpuShads),
          row("bindGroups", refs.gpuBGs),
          row("bindGroupLayouts", refs.gpuBGLs),
          row("buffers", refs.gpuBufs),
          row("textures", refs.gpuTexs),
          row("samplers", refs.gpuSamps)
        );
        r.appendChild(giBox);
        r.appendChild(section("WebGPU \xB7 buffers by kind"));
        const pillRow = el("div");
        pillRow.className = "wgla-pillrow";
        refs.gpuBufPills = pillRow;
        r.appendChild(pillRow);
        const warnHead = section("WebGPU \xB7 validation");
        r.appendChild(warnHead);
        refs.gpuWarnHead = warnHead;
        const warnList = el("div");
        refs.gpuWarnList = warnList;
        r.appendChild(warnList);
        const warnMore = el("div", { padding: "4px 6px" });
        const warnLink = el("span", null, "see all in GPU tab \u2192");
        warnLink.className = "wgla-link";
        warnLink.addEventListener("click", () => switchTab("gpu"));
        warnMore.appendChild(warnLink);
        refs.gpuWarnMore = warnMore;
        r.appendChild(warnMore);
      }
      let glFrameBox = null, glInvBox = null;
      if (hasGL) {
        r.appendChild(section("WebGL \xB7 frame"));
        glFrameBox = el("div");
        refs.fps = el("span", null, "\u2014");
        refs.ms = el("span", null, "\u2014");
        refs.draws = el("span", null, "\u2014");
        refs.tris = el("span", null, "\u2014");
        refs.verts = el("span", null, "\u2014");
        refs.lines = el("span", null, "\u2014");
        refs.pts = el("span", null, "\u2014");
        glFrameBox.append(
          row("fps", refs.fps),
          row("frame ms", refs.ms),
          row("draws/f", refs.draws),
          row("tris/f", refs.tris),
          row("verts/f", refs.verts),
          row("lines/f", refs.lines),
          row("points/f", refs.pts)
        );
        r.appendChild(glFrameBox);
        r.appendChild(section("WebGL \xB7 inventory"));
        glInvBox = el("div");
        refs.progs = el("span", null, "\u2014");
        refs.shads = el("span", null, "\u2014");
        refs.bufs = el("span", null, "\u2014");
        refs.texs = el("span", null, "\u2014");
        refs.fbs = el("span", null, "\u2014");
        refs.rbs = el("span", null, "\u2014");
        refs.vaos = el("span", null, "\u2014");
        glInvBox.append(
          row("programs", refs.progs),
          row("shaders", refs.shads),
          row("buffers", refs.bufs),
          row("textures", refs.texs),
          row("framebuffers", refs.fbs),
          row("renderbufs", refs.rbs),
          row("vaos", refs.vaos)
        );
        r.appendChild(glInvBox);
      }
      if (!hasGL && !hasGPU) {
        const e = el("div", null, "waiting for a graphics context\u2026");
        e.className = "wgla-empty";
        r.appendChild(e);
      }
      function update() {
        if (glFrameBox) {
          const recs = getActiveRecords("webgl");
          let fps = 0, ms = 0, d = 0, t = 0, v = 0, ln = 0, pt = 0;
          let pr = 0, sh = 0, bf = 0, tx = 0, fb = 0, rb = 0, va = 0;
          for (const rec of recs) {
            fps = Math.max(fps, rec.frame.fps);
            ms = Math.max(ms, rec.frame.frameMs);
            d += rec.frame.drawCalls;
            t += rec.frame.triangles;
            v += rec.frame.vertices;
            ln += rec.frame.lines;
            pt += rec.frame.points;
            pr += rec.programs.size;
            sh += rec.shaders.size;
            bf += rec.buffers.size;
            tx += rec.textures.size;
            fb += rec.framebuffers.size;
            rb += rec.renderbuffers.size;
            va += rec.vaos.size;
          }
          refs.fps.textContent = recs.length ? fps.toFixed(1) : "\u2014";
          refs.fps.style.color = fps >= 55 ? "#3c3" : fps >= 30 ? "#fc3" : fps > 0 ? "#f55" : "#888";
          refs.ms.textContent = recs.length ? ms.toFixed(2) : "\u2014";
          refs.draws.textContent = fmtNum2(d);
          refs.tris.textContent = fmtNum2(t);
          refs.verts.textContent = fmtNum2(v);
          refs.lines.textContent = fmtNum2(ln);
          refs.pts.textContent = fmtNum2(pt);
          refs.progs.textContent = String(pr);
          refs.shads.textContent = String(sh);
          refs.bufs.textContent = String(bf);
          refs.texs.textContent = String(tx);
          refs.fbs.textContent = String(fb);
          refs.rbs.textContent = String(rb);
          refs.vaos.textContent = String(va);
        }
        if (gpuBox) {
          const grecs = getActiveRecords("webgpu");
          let gfps = 0, gms = 0;
          let gd = 0, gp = 0, gv = 0, gtri = 0, gwg = 0;
          let grp = 0, gcp = 0, gsub = 0, gcop = 0, gwb = 0, gwt = 0;
          let gpipes = 0, gcomp = 0, gshads = 0, gbgs = 0, gbgls = 0;
          let gbufs = 0, gtex = 0, gsamp = 0;
          const kinds = { VERTEX: 0, INDEX: 0, UNIFORM: 0, STORAGE: 0, INDIRECT: 0, OTHER: 0 };
          const warnings = [];
          for (const rec of grecs) {
            gfps = Math.max(gfps, rec.frame.fps);
            gms = Math.max(gms, rec.frame.frameMs);
            gd += rec.frame.drawCalls;
            gp += rec.frame.dispatchCalls;
            gv += rec.frame.vertices;
            gtri += rec.frame.triangles;
            gwg += rec.frame.workgroups;
            grp += rec.frame.renderPasses;
            gcp += rec.frame.computePasses;
            gsub += rec.frame.submits;
            gcop += rec.frame.copies;
            gwb += rec.frame.writeBuffer;
            gwt += rec.frame.writeTexture;
            gpipes += rec.renderPipelines.size;
            gcomp += rec.computePipelines.size;
            gshads += rec.shaderModules.size;
            gbgs += rec.bindGroups.size;
            gbgls += rec.bindGroupLayouts.size;
            gbufs += rec.buffers.size;
            gtex += rec.textures.size;
            gsamp += rec.samplers.size;
            for (const [, info] of rec.buffers) {
              const flags = info.usageFlags || [];
              const k = flags.includes("VERTEX") ? "VERTEX" : flags.includes("INDEX") ? "INDEX" : flags.includes("UNIFORM") ? "UNIFORM" : flags.includes("STORAGE") ? "STORAGE" : flags.includes("INDIRECT") ? "INDIRECT" : "OTHER";
              kinds[k]++;
            }
            for (const w of rec.warnings || []) warnings.push(w);
          }
          refs.gpuFps.textContent = grecs.length ? gfps.toFixed(1) : "\u2014";
          refs.gpuFps.style.color = gfps >= 55 ? "#3c3" : gfps >= 30 ? "#fc3" : gfps > 0 ? "#f55" : "#888";
          refs.gpuMs.textContent = grecs.length ? gms.toFixed(2) : "\u2014";
          refs.gpuDraws.textContent = fmtNum2(gd);
          refs.gpuDisp.textContent = fmtNum2(gp);
          refs.gpuVerts.textContent = fmtNum2(gv);
          refs.gpuTris.textContent = fmtNum2(gtri);
          refs.gpuWG.textContent = fmtNum2(gwg);
          refs.gpuRP.textContent = fmtNum2(grp);
          refs.gpuCP.textContent = fmtNum2(gcp);
          refs.gpuSubmits.textContent = fmtNum2(gsub);
          refs.gpuCopies.textContent = fmtNum2(gcop);
          refs.gpuWB.textContent = fmtNum2(gwb);
          refs.gpuWT.textContent = fmtNum2(gwt);
          refs.gpuPipes.textContent = String(gpipes);
          refs.gpuComp.textContent = String(gcomp);
          refs.gpuShads.textContent = String(gshads);
          refs.gpuBGs.textContent = String(gbgs);
          refs.gpuBGLs.textContent = String(gbgls);
          refs.gpuBufs.textContent = String(gbufs);
          refs.gpuTexs.textContent = String(gtex);
          refs.gpuSamps.textContent = String(gsamp);
          clear(refs.gpuBufPills);
          let pillTotal = 0;
          for (const k of ["VERTEX", "INDEX", "UNIFORM", "STORAGE", "INDIRECT", "OTHER"]) {
            if (!kinds[k]) continue;
            pillTotal++;
            const p = el("span", null, `${k} ${kinds[k]}`);
            p.className = "wgla-pill gpu";
            refs.gpuBufPills.appendChild(p);
          }
          if (!pillTotal) {
            const p = el("span", null, "none");
            p.className = "wgla-pill muted";
            refs.gpuBufPills.appendChild(p);
          }
          clear(refs.gpuWarnList);
          const warnTotal = warnings.length;
          if (!warnTotal) {
            const ok = el("div", null, "no validation issues");
            ok.className = "wgla-empty";
            ok.style.color = "#3c3";
            refs.gpuWarnList.appendChild(ok);
            refs.gpuWarnMore.style.display = "none";
          } else {
            const head = warnings.slice(0, 3);
            for (const w of head) refs.gpuWarnList.appendChild(renderWarning(w));
            refs.gpuWarnMore.style.display = warnTotal > 3 ? "" : "none";
            refs.gpuWarnMore.firstChild.textContent = `+${warnTotal - 3} more \xB7 see GPU tab \u2192`;
          }
        }
      }
      return { root: r, update };
    }
    function renderWarning(w) {
      const sev = w.severity === "error" ? "" : w.severity || "info";
      const div = el("div");
      div.className = "wgla-warn" + (sev ? " " + sev : "");
      const head = el("div");
      const kind = el("span", { color: "#fdd", fontWeight: "bold" }, w.kind || "warning");
      const meta = el("span");
      meta.className = "meta";
      const src = w.source ? ` \xB7 ${w.source}` : "";
      meta.textContent = `${src}`;
      const count = el("span", null, w.count > 1 ? `\xD7${w.count}` : "");
      count.className = "count";
      head.append(kind, meta, count);
      const msg = el("div", null, w.message || "");
      div.append(head, msg);
      return div;
    }
    function buildFrameTab() {
      const r = el("div");
      const cols = "60px 1fr 50px 50px 32px";
      const refreshFns = [];
      const hasGL = !!(webgl2 && webgl2.records.size);
      const hasGPU = !!(webgpu2 && webgpu2.records.size);
      if (hasGL) refreshFns.push(makeKeyedList(r, {
        title: "WebGL \xB7 draws this frame",
        cols,
        headers: [
          { label: "prog" },
          { label: "method \xB7 mode" },
          { label: "prims", right: true },
          { label: "verts", right: true },
          { label: "inst", right: true }
        ],
        emptyText: "(no draws captured)",
        getItems: () => {
          const out = [];
          const recs = getActiveRecords("webgl");
          for (const rec of recs) {
            const ctxIdx = ctxIdxOf("webgl", rec);
            rec.frame.draws.forEach((d, i) => out.push({
              key: `${ctxIdx}:${i}:${d.programId || ""}:${d.method}:${d.mode || ""}`,
              ctxIdx,
              idx: i,
              ...d
            }));
          }
          return out;
        },
        getKey: (it) => it.key,
        build: (it) => {
          const idSpan = el("span", { color: "#0bf" });
          const labelSpan = el("span");
          const primsSpan = el("span", { textAlign: "right" });
          const vertsSpan = el("span", { textAlign: "right", color: "#888" });
          const instSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow(cols);
          rEl.append(idSpan, labelSpan, primsSpan, vertsSpan, instSpan);
          return { row: rEl, refs: { idSpan, labelSpan, primsSpan, vertsSpan, instSpan } };
        },
        update: (entry, it) => {
          entry.refs.idSpan.textContent = it.programId ? idLabel("webgl", it.programId, it.ctxIdx) : "\u2014";
          entry.refs.labelSpan.textContent = `${it.method} \xB7 ${it.mode}`;
          entry.refs.primsSpan.textContent = fmtNum2(it.primitives);
          entry.refs.vertsSpan.textContent = fmtNum2(it.vertices);
          entry.refs.instSpan.textContent = it.instances > 1 ? "\xD7" + it.instances : "";
        },
        onClick: (it) => {
          if (it?.programId) openDetail({ side: "webgl", kind: "program", id: it.programId, contextIdx: it.ctxIdx });
        }
      }));
      if (hasGPU) {
        refreshFns.push(makeKeyedList(r, {
          title: "WebGPU \xB7 draws this frame",
          cols,
          headers: [
            { label: "pipe" },
            { label: "method \xB7 topology" },
            { label: "prims", right: true },
            { label: "verts", right: true },
            { label: "inst", right: true }
          ],
          emptyText: "(no draws captured)",
          getItems: () => {
            const out = [];
            const recs = getActiveRecords("webgpu");
            for (const rec of recs) {
              const ctxIdx = ctxIdxOf("webgpu", rec);
              rec.frame.draws.forEach((d, i) => out.push({
                key: `${ctxIdx}:${i}:${d.pipelineId || ""}:${d.method}:${d.topology || ""}`,
                ctxIdx,
                idx: i,
                ...d
              }));
            }
            return out;
          },
          getKey: (it) => it.key,
          build: (it) => {
            const idSpan = el("span", { color: "#f0c" });
            const labelSpan = el("span");
            const primsSpan = el("span", { textAlign: "right" });
            const vertsSpan = el("span", { textAlign: "right", color: "#888" });
            const instSpan = el("span", { textAlign: "right", color: "#888" });
            const rEl = tableRow(cols);
            rEl.append(idSpan, labelSpan, primsSpan, vertsSpan, instSpan);
            return { row: rEl, refs: { idSpan, labelSpan, primsSpan, vertsSpan, instSpan } };
          },
          update: (entry, it) => {
            entry.refs.idSpan.textContent = it.pipelineId ? idLabel("webgpu", it.pipelineId, it.ctxIdx) : "\u2014";
            entry.refs.labelSpan.textContent = `${it.method} \xB7 ${it.topology}`;
            entry.refs.primsSpan.textContent = fmtNum2(it.primitives);
            entry.refs.vertsSpan.textContent = fmtNum2(it.vertices);
            entry.refs.instSpan.textContent = it.instances > 1 ? "\xD7" + it.instances : "";
          },
          onClick: (it) => {
            if (it?.pipelineId) openDetail({ side: "webgpu", kind: "renderPipeline", id: it.pipelineId, contextIdx: it.ctxIdx });
          }
        }));
        refreshFns.push(makeKeyedList(r, {
          title: "WebGPU \xB7 dispatches this frame",
          cols: "60px 1fr 60px",
          headers: [
            { label: "pipe" },
            { label: "dispatch (x,y,z)" },
            { label: "wgrps", right: true }
          ],
          emptyText: "(no dispatches captured)",
          getItems: () => {
            const out = [];
            const recs = getActiveRecords("webgpu");
            for (const rec of recs) {
              const ctxIdx = ctxIdxOf("webgpu", rec);
              rec.frame.dispatches.forEach((d, i) => out.push({
                key: `${ctxIdx}:${i}:${d.pipelineId || ""}:${d.method}`,
                ctxIdx,
                idx: i,
                ...d
              }));
            }
            return out;
          },
          getKey: (it) => it.key,
          build: (it) => {
            const idSpan = el("span", { color: "#f0c" });
            const xyzSpan = el("span");
            const wgSpan = el("span", { textAlign: "right" });
            const rEl = tableRow("60px 1fr 60px");
            rEl.append(idSpan, xyzSpan, wgSpan);
            return { row: rEl, refs: { idSpan, xyzSpan, wgSpan } };
          },
          update: (entry, it) => {
            entry.refs.idSpan.textContent = it.pipelineId ? idLabel("webgpu", it.pipelineId, it.ctxIdx) : "\u2014";
            entry.refs.xyzSpan.textContent = `${it.x},${it.y},${it.z}`;
            entry.refs.wgSpan.textContent = fmtNum2(it.workgroups);
          },
          onClick: (it) => {
            if (it?.pipelineId) openDetail({ side: "webgpu", kind: "computePipeline", id: it.pipelineId, contextIdx: it.ctxIdx });
          }
        }));
        refreshFns.push(makeKeyedList(r, {
          title: "WebGPU \xB7 passes this frame",
          cols: "42px 1fr 50px 50px",
          headers: [
            { label: "kind" },
            { label: "attachments / label" },
            { label: "draws", right: true },
            { label: "disp", right: true }
          ],
          emptyText: "(no passes captured)",
          getItems: () => {
            const out = [];
            const recs = getActiveRecords("webgpu");
            for (const rec of recs) {
              const ctxIdx = ctxIdxOf("webgpu", rec);
              (rec.frame.passes || []).forEach((p, i) => out.push({
                key: `${ctxIdx}:${i}:${p.kind}`,
                ctxIdx,
                idx: i,
                ...p
              }));
            }
            return out;
          },
          getKey: (it) => it.key,
          build: () => {
            const kSpan = el("span", { color: "#f0c" });
            const lblSpan = el("span");
            const dSpan = el("span", { textAlign: "right" });
            const cSpan = el("span", { textAlign: "right", color: "#888" });
            const rEl = tableRow("42px 1fr 50px 50px");
            rEl.append(kSpan, lblSpan, dSpan, cSpan);
            return { row: rEl, refs: { kSpan, lblSpan, dSpan, cSpan } };
          },
          update: (e, it) => {
            e.refs.kSpan.textContent = it.kind === "render" ? "rndr" : "comp";
            let desc = it.label || "";
            if (it.kind === "render" && it.attachments?.length) {
              const parts = it.attachments.map((a) => {
                if (!a) return "-";
                const ref = a.textureId ? a.textureId : a.isCanvas ? "canvas" : "?";
                return `${ref}${a.format ? `:${a.format}` : ""}${a.loadOp === "clear" ? "\u2738" : ""}`;
              });
              desc = `[${parts.join(", ")}]${it.label ? "  " + it.label : ""}`;
              if (it.depth) desc += ` +depth(${it.depth.format || "?"})`;
            }
            e.refs.lblSpan.textContent = desc || "(unlabeled)";
            e.refs.dSpan.textContent = fmtNum2(it.draws);
            e.refs.cSpan.textContent = fmtNum2(it.dispatches);
          }
        }));
      }
      function update() {
        for (const f of refreshFns) f();
      }
      return { root: r, update };
    }
    function buildProgramsTab() {
      const r = el("div");
      if (!getActiveRecords("webgl").length) {
        r.appendChild(noContextMsg("WebGL"));
        return { root: r };
      }
      const cols = "60px 1fr 60px 60px";
      const refresh = makeKeyedList(r, {
        title: "Programs",
        cols,
        headers: [
          { label: "id" },
          { label: "status" },
          { label: "draws/f", right: true },
          { label: "\u03A3 draws", right: true }
        ],
        emptyText: "(no programs)",
        getItems: () => {
          const out = [];
          const recs = getActiveRecords("webgl");
          for (const rec of recs) {
            const ctxIdx = ctxIdxOf("webgl", rec);
            const dpf = /* @__PURE__ */ new Map();
            for (const d of rec.frame.draws) if (d.programId) dpf.set(d.programId, (dpf.get(d.programId) || 0) + 1);
            for (const p of rec.programs) {
              const id = rec.ids.get(p);
              out.push({
                key: `${ctxIdx}:${id}`,
                ctxIdx,
                id,
                isCurrent: rec.currentProgram === p,
                linked: !!rec.gl.getProgramParameter(p, rec.gl.LINK_STATUS),
                drawsF: dpf.get(id) || 0,
                totalDraws: rec.drawCalls.get(p) || 0
              });
            }
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#0bf" });
          const statusSpan = el("span");
          const dpfSpan = el("span", { textAlign: "right" });
          const totSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow(cols);
          rEl.append(idSpan, statusSpan, dpfSpan, totSpan);
          return { row: rEl, refs: { idSpan, statusSpan, dpfSpan, totSpan } };
        },
        update: (entry, it) => {
          entry.refs.idSpan.textContent = idLabel("webgl", it.id, it.ctxIdx);
          entry.refs.statusSpan.textContent = `${it.isCurrent ? "\u25CF " : "\u25CB "}${it.linked ? "linked" : "unlinked"}`;
          entry.refs.dpfSpan.textContent = fmtNum2(it.drawsF);
          entry.refs.totSpan.textContent = fmtNum2(it.totalDraws);
        },
        onClick: (it) => openDetail({ side: "webgl", kind: "program", id: it.id, contextIdx: it.ctxIdx })
      });
      return { root: r, update: refresh };
    }
    function buildResourcesTab() {
      const r = el("div");
      if (!getActiveRecords("webgl").length) {
        r.appendChild(noContextMsg("WebGL"));
        return { root: r };
      }
      const refreshFns = [];
      refreshFns.push(makeKeyedList(r, {
        title: "Buffers",
        collapsible: true,
        cols: "60px 1fr 60px 80px",
        headers: [
          { label: "id" },
          { label: "target" },
          { label: "size", right: true },
          { label: "usage", right: true }
        ],
        emptyText: "(none)",
        getItems: () => {
          const out = [];
          for (const rec of getActiveRecords("webgl")) {
            const ctxIdx = ctxIdxOf("webgl", rec);
            for (const [b, info] of rec.buffers) {
              const id = rec.ids.get(b);
              out.push({ key: `${ctxIdx}:${id}`, ctxIdx, id, ...info });
            }
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#0bf" });
          const tgtSpan = el("span");
          const sizeSpan = el("span", { textAlign: "right" });
          const usageSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow("60px 1fr 60px 80px");
          rEl.append(idSpan, tgtSpan, sizeSpan, usageSpan);
          return { row: rEl, refs: { idSpan, tgtSpan, sizeSpan, usageSpan } };
        },
        update: (e, it) => {
          e.refs.idSpan.textContent = idLabel("webgl", it.id, it.ctxIdx);
          e.refs.tgtSpan.textContent = it.target || "UNKNOWN";
          e.refs.sizeSpan.textContent = fmtBytes2(it.size || 0);
          e.refs.usageSpan.textContent = it.usage || "";
        },
        onClick: (it) => openDetail({ side: "webgl", kind: "buffer", id: it.id, contextIdx: it.ctxIdx })
      }));
      refreshFns.push(makeKeyedList(r, {
        title: "Textures",
        collapsible: true,
        cols: "60px 1fr 80px 80px",
        headers: [
          { label: "id" },
          { label: "target" },
          { label: "size", right: true },
          { label: "format", right: true }
        ],
        emptyText: "(none)",
        getItems: () => {
          const out = [];
          for (const rec of getActiveRecords("webgl")) {
            const ctxIdx = ctxIdxOf("webgl", rec);
            for (const [t, info] of rec.textures) {
              const id = rec.ids.get(t);
              out.push({ key: `${ctxIdx}:${id}`, ctxIdx, id, ...info });
            }
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#0bf" });
          const tgtSpan = el("span");
          const sizeSpan = el("span", { textAlign: "right" });
          const fmtSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow("60px 1fr 80px 80px");
          rEl.append(idSpan, tgtSpan, sizeSpan, fmtSpan);
          return { row: rEl, refs: { idSpan, tgtSpan, sizeSpan, fmtSpan } };
        },
        update: (e, it) => {
          e.refs.idSpan.textContent = idLabel("webgl", it.id, it.ctxIdx);
          e.refs.tgtSpan.textContent = it.target || "?";
          e.refs.sizeSpan.textContent = it.depth > 1 ? `${it.width}\xD7${it.height}\xD7${it.depth}` : `${it.width}\xD7${it.height}`;
          e.refs.fmtSpan.textContent = it.internalFormat || "";
        },
        onClick: (it) => openDetail({ side: "webgl", kind: "texture", id: it.id, contextIdx: it.ctxIdx })
      }));
      refreshFns.push(makeKeyedList(r, {
        title: "Framebuffers",
        collapsible: true,
        cols: "60px 1fr",
        headers: [{ label: "id" }, { label: "attachments" }],
        emptyText: "(none)",
        getItems: () => {
          const out = [];
          for (const rec of getActiveRecords("webgl")) {
            const ctxIdx = ctxIdxOf("webgl", rec);
            for (const [f, info] of rec.framebuffers) {
              const id = rec.ids.get(f);
              out.push({
                key: `${ctxIdx}:${id}`,
                ctxIdx,
                id,
                attachments: Object.keys(info.attachments || {}).join(", ") || "(none)"
              });
            }
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#0bf" });
          const attSpan = el("span");
          const rEl = tableRow("60px 1fr");
          rEl.append(idSpan, attSpan);
          return { row: rEl, refs: { idSpan, attSpan } };
        },
        update: (e, it) => {
          e.refs.idSpan.textContent = idLabel("webgl", it.id, it.ctxIdx);
          e.refs.attSpan.textContent = it.attachments;
        },
        onClick: (it) => openDetail({ side: "webgl", kind: "framebuffer", id: it.id, contextIdx: it.ctxIdx })
      }));
      refreshFns.push(makeKeyedList(r, {
        title: "Renderbuffers",
        collapsible: true,
        cols: "60px 1fr 80px 50px",
        headers: [
          { label: "id" },
          { label: "format" },
          { label: "size", right: true },
          { label: "samples", right: true }
        ],
        emptyText: "(none)",
        getItems: () => {
          const out = [];
          for (const rec of getActiveRecords("webgl")) {
            const ctxIdx = ctxIdxOf("webgl", rec);
            for (const [rb, info] of rec.renderbuffers) {
              const id = rec.ids.get(rb);
              out.push({ key: `${ctxIdx}:${id}`, ctxIdx, id, ...info });
            }
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#0bf" });
          const fmtSpan = el("span");
          const sizeSpan = el("span", { textAlign: "right" });
          const sampSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow("60px 1fr 80px 50px");
          rEl.append(idSpan, fmtSpan, sizeSpan, sampSpan);
          return { row: rEl, refs: { idSpan, fmtSpan, sizeSpan, sampSpan } };
        },
        update: (e, it) => {
          e.refs.idSpan.textContent = idLabel("webgl", it.id, it.ctxIdx);
          e.refs.fmtSpan.textContent = it.internalFormat || "?";
          e.refs.sizeSpan.textContent = `${it.width}\xD7${it.height}`;
          e.refs.sampSpan.textContent = String(it.samples || 0);
        },
        onClick: (it) => openDetail({ side: "webgl", kind: "renderbuffer", id: it.id, contextIdx: it.ctxIdx })
      }));
      function update() {
        for (const f of refreshFns) f();
      }
      return { root: r, update };
    }
    function buildGPUTab() {
      const r = el("div");
      if (!getActiveRecords("webgpu").length) {
        r.appendChild(noContextMsg("WebGPU"));
        return { root: r };
      }
      const refreshFns = [];
      r.appendChild(section("Validation"));
      const warnHost = el("div");
      r.appendChild(warnHost);
      const warnEmpty = el("div", null, "no validation issues");
      warnEmpty.className = "wgla-empty";
      warnEmpty.style.color = "#3c3";
      r.appendChild(warnEmpty);
      let lastWarnSig = "";
      refreshFns.push(() => {
        const warnings = [];
        for (const rec of getActiveRecords("webgpu")) {
          for (const w of rec.warnings || []) warnings.push(w);
        }
        const sig = warnings.map((w) => `${w.kind}|${w.message}|${w.count}`).join("\n");
        if (sig === lastWarnSig) return;
        lastWarnSig = sig;
        clear(warnHost);
        warnEmpty.style.display = warnings.length ? "none" : "";
        for (const w of warnings) warnHost.appendChild(renderWarning(w));
      });
      refreshFns.push(makeKeyedList(r, {
        title: "Devices \xB7 live stats",
        cols: "60px 1fr 50px 50px 50px",
        headers: [
          { label: "id" },
          { label: "vendor / passes" },
          { label: "draws", right: true },
          { label: "disp", right: true },
          { label: "submits", right: true }
        ],
        emptyText: "(none)",
        getItems: () => {
          const out = [];
          for (const rec of getActiveRecords("webgpu")) {
            const ctxIdx = ctxIdxOf("webgpu", rec);
            out.push({
              key: `dev:${ctxIdx}`,
              ctxIdx,
              id: `dev${ctxIdx}`,
              vendor: rec.adapterInfo?.vendor || "\u2014",
              renderPasses: rec.frame.renderPasses,
              computePasses: rec.frame.computePasses,
              draws: rec.frame.drawCalls,
              disp: rec.frame.dispatchCalls,
              submits: rec.frame.submits
            });
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#f0c" });
          const vendorSpan = el("span");
          const drawsSpan = el("span", { textAlign: "right" });
          const dispSpan = el("span", { textAlign: "right" });
          const subSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow("60px 1fr 50px 50px 50px");
          rEl.append(idSpan, vendorSpan, drawsSpan, dispSpan, subSpan);
          return { row: rEl, refs: { idSpan, vendorSpan, drawsSpan, dispSpan, subSpan } };
        },
        update: (e, it) => {
          e.refs.idSpan.textContent = idLabel("webgpu", it.id, it.ctxIdx);
          e.refs.vendorSpan.textContent = `${it.vendor}  rp:${it.renderPasses} cp:${it.computePasses}`;
          e.refs.drawsSpan.textContent = fmtNum2(it.draws);
          e.refs.dispSpan.textContent = fmtNum2(it.disp);
          e.refs.subSpan.textContent = fmtNum2(it.submits);
        }
      }));
      refreshFns.push(makeKeyedList(r, {
        title: "Render Pipelines",
        cols: "60px 1fr 50px 50px",
        headers: [
          { label: "id" },
          { label: "topology \xB7 label" },
          { label: "draws/f", right: true },
          { label: "\u03A3 draws", right: true }
        ],
        emptyText: "(none)",
        getItems: () => {
          const out = [];
          for (const rec of getActiveRecords("webgpu")) {
            const ctxIdx = ctxIdxOf("webgpu", rec);
            for (const [p, info] of rec.renderPipelines) {
              const id = rec.ids.get(p);
              out.push({
                key: `${ctxIdx}:${id}`,
                ctxIdx,
                id,
                topology: info.topology,
                label: info.label,
                drawsF: info._drawsF || 0,
                totalDraws: info._totalDraws || 0
              });
            }
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#f0c" });
          const lblSpan = el("span");
          const dpfSpan = el("span", { textAlign: "right" });
          const totSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow("60px 1fr 50px 50px");
          rEl.append(idSpan, lblSpan, dpfSpan, totSpan);
          return { row: rEl, refs: { idSpan, lblSpan, dpfSpan, totSpan } };
        },
        update: (e, it) => {
          e.refs.idSpan.textContent = idLabel("webgpu", it.id, it.ctxIdx);
          e.refs.lblSpan.textContent = `${it.topology}${it.label ? "  " + it.label : ""}`;
          e.refs.dpfSpan.textContent = fmtNum2(it.drawsF);
          e.refs.totSpan.textContent = fmtNum2(it.totalDraws);
        },
        onClick: (it) => openDetail({ side: "webgpu", kind: "renderPipeline", id: it.id, contextIdx: it.ctxIdx })
      }));
      refreshFns.push(makeKeyedList(r, {
        title: "Compute Pipelines",
        cols: "60px 1fr 50px 60px",
        headers: [
          { label: "id" },
          { label: "label" },
          { label: "disp/f", right: true },
          { label: "wgrps/f", right: true }
        ],
        emptyText: "(none)",
        getItems: () => {
          const out = [];
          for (const rec of getActiveRecords("webgpu")) {
            const ctxIdx = ctxIdxOf("webgpu", rec);
            for (const [p, info] of rec.computePipelines) {
              const id = rec.ids.get(p);
              out.push({
                key: `${ctxIdx}:${id}`,
                ctxIdx,
                id,
                label: info.label,
                dispatchesF: info._dispatchesF || 0,
                wgF: info._wgF || 0
              });
            }
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#f0c" });
          const lblSpan = el("span");
          const dpfSpan = el("span", { textAlign: "right" });
          const wgSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow("60px 1fr 50px 60px");
          rEl.append(idSpan, lblSpan, dpfSpan, wgSpan);
          return { row: rEl, refs: { idSpan, lblSpan, dpfSpan, wgSpan } };
        },
        update: (e, it) => {
          e.refs.idSpan.textContent = idLabel("webgpu", it.id, it.ctxIdx);
          e.refs.lblSpan.textContent = it.label || "";
          e.refs.dpfSpan.textContent = fmtNum2(it.dispatchesF);
          e.refs.wgSpan.textContent = fmtNum2(it.wgF);
        },
        onClick: (it) => openDetail({ side: "webgpu", kind: "computePipeline", id: it.id, contextIdx: it.ctxIdx })
      }));
      refreshFns.push(makeKeyedList(r, {
        title: "Bind Groups",
        cols: "60px 1fr 40px",
        headers: [{ label: "id" }, { label: "layout \xB7 label" }, { label: "#ent", right: true }],
        emptyText: "(none)",
        getItems: () => {
          const out = [];
          for (const rec of getActiveRecords("webgpu")) {
            const ctxIdx = ctxIdxOf("webgpu", rec);
            for (const [g, info] of rec.bindGroups) {
              const id = rec.ids.get(g);
              out.push({
                key: `${ctxIdx}:${id}`,
                ctxIdx,
                id,
                label: info.label,
                layoutId: info.layoutId,
                entryCount: (info.entries || []).length
              });
            }
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#f0c" });
          const lblSpan = el("span");
          const cntSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow("60px 1fr 40px");
          rEl.append(idSpan, lblSpan, cntSpan);
          return { row: rEl, refs: { idSpan, lblSpan, cntSpan } };
        },
        update: (e, it) => {
          e.refs.idSpan.textContent = idLabel("webgpu", it.id, it.ctxIdx);
          const lay = it.layoutId ? `\u2192 ${it.layoutId}` : "\u2192 (auto)";
          e.refs.lblSpan.textContent = `${lay}${it.label ? "  " + it.label : ""}`;
          e.refs.cntSpan.textContent = String(it.entryCount);
        },
        onClick: (it) => openDetail({ side: "webgpu", kind: "bindGroup", id: it.id, contextIdx: it.ctxIdx })
      }));
      refreshFns.push(makeKeyedList(r, {
        title: "Buffers",
        cols: "60px 1fr 60px 60px",
        headers: [
          { label: "id" },
          { label: "label \xB7 usage" },
          { label: "size", right: true },
          { label: "kind", right: true }
        ],
        emptyText: "(none)",
        getItems: () => {
          const out = [];
          for (const rec of getActiveRecords("webgpu")) {
            const ctxIdx = ctxIdxOf("webgpu", rec);
            for (const [b, info] of rec.buffers) {
              const id = rec.ids.get(b);
              out.push({ key: `${ctxIdx}:${id}`, ctxIdx, id, ...info });
            }
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#f0c" });
          const lblSpan = el("span");
          const sizeSpan = el("span", { textAlign: "right" });
          const kindSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow("60px 1fr 60px 60px");
          rEl.append(idSpan, lblSpan, sizeSpan, kindSpan);
          return { row: rEl, refs: { idSpan, lblSpan, sizeSpan, kindSpan } };
        },
        update: (e, it) => {
          e.refs.idSpan.textContent = idLabel("webgpu", it.id, it.ctxIdx);
          e.refs.lblSpan.textContent = it.label || (it.usageFlags || []).join("|");
          e.refs.sizeSpan.textContent = fmtBytes2(it.size);
          const kind = (it.usageFlags || []).find((f) => ["VERTEX", "INDEX", "UNIFORM", "STORAGE", "INDIRECT"].includes(f)) || "OTHER";
          e.refs.kindSpan.textContent = kind;
        },
        onClick: (it) => openDetail({ side: "webgpu", kind: "gpuBuffer", id: it.id, contextIdx: it.ctxIdx })
      }));
      refreshFns.push(makeKeyedList(r, {
        title: "Textures",
        cols: "60px 1fr 80px 40px",
        headers: [
          { label: "id" },
          { label: "label \xB7 format" },
          { label: "size", right: true },
          { label: "mips", right: true }
        ],
        emptyText: "(none)",
        getItems: () => {
          const out = [];
          for (const rec of getActiveRecords("webgpu")) {
            const ctxIdx = ctxIdxOf("webgpu", rec);
            for (const [t, info] of rec.textures) {
              const id = rec.ids.get(t);
              out.push({ key: `${ctxIdx}:${id}`, ctxIdx, id, ...info });
            }
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#f0c" });
          const lblSpan = el("span");
          const sizeSpan = el("span", { textAlign: "right" });
          const mipSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow("60px 1fr 80px 40px");
          rEl.append(idSpan, lblSpan, sizeSpan, mipSpan);
          return { row: rEl, refs: { idSpan, lblSpan, sizeSpan, mipSpan } };
        },
        update: (e, it) => {
          e.refs.idSpan.textContent = idLabel("webgpu", it.id, it.ctxIdx);
          e.refs.lblSpan.textContent = `${it.label || ""} ${it.format || ""}`.trim();
          e.refs.sizeSpan.textContent = it.depthOrArrayLayers > 1 ? `${it.width}\xD7${it.height}\xD7${it.depthOrArrayLayers}` : `${it.width}\xD7${it.height}`;
          e.refs.mipSpan.textContent = String(it.mipLevelCount);
        },
        onClick: (it) => openDetail({ side: "webgpu", kind: "gpuTexture", id: it.id, contextIdx: it.ctxIdx })
      }));
      refreshFns.push(makeKeyedList(r, {
        title: "Shader Modules",
        cols: "60px 1fr 60px",
        headers: [
          { label: "id" },
          { label: "label" },
          { label: "chars", right: true }
        ],
        emptyText: "(none)",
        getItems: () => {
          const out = [];
          for (const rec of getActiveRecords("webgpu")) {
            const ctxIdx = ctxIdxOf("webgpu", rec);
            for (const [m, info] of rec.shaderModules) {
              const id = rec.ids.get(m);
              out.push({ key: `${ctxIdx}:${id}`, ctxIdx, id, label: info.label, sourceLength: info.sourceLength });
            }
          }
          return out;
        },
        getKey: (it) => it.key,
        build: () => {
          const idSpan = el("span", { color: "#f0c" });
          const lblSpan = el("span");
          const lenSpan = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow("60px 1fr 60px");
          rEl.append(idSpan, lblSpan, lenSpan);
          return { row: rEl, refs: { idSpan, lblSpan, lenSpan } };
        },
        update: (e, it) => {
          e.refs.idSpan.textContent = idLabel("webgpu", it.id, it.ctxIdx);
          e.refs.lblSpan.textContent = it.label || "";
          e.refs.lenSpan.textContent = fmtNum2(it.sourceLength);
        },
        onClick: (it) => openDetail({ side: "webgpu", kind: "shaderModule", id: it.id, contextIdx: it.ctxIdx })
      }));
      function update() {
        for (const f of refreshFns) f();
      }
      return { root: r, update };
    }
    function buildSceneTab() {
      const r = el("div");
      if (!scenes2 || !scenes2.scenes.length) {
        const e = el("div");
        e.className = "wgla-empty";
        e.style.padding = "12px 8px";
        e.style.lineHeight = "1.6";
        e.innerHTML = "no scene attached.<br><br>if this page uses three.js or babylon, open devtools and run:<br><code style='color:#0bf'>GPUProbe.attachScene(yourScene)</code><br><br>for gltf/glb roots:<br><code style='color:#0bf'>GPUProbe.attachModel(gltf.scene, {source:'foo.glb'})</code>";
        r.appendChild(e);
        return { root: r };
      }
      const blocks = scenes2.scenes.map((entry, sceneIdx) => {
        const block = el("div");
        block.appendChild(section(`Scene \xB7 ${entry.label}`));
        const refs = {
          meshes: el("span", null, "\u2014"),
          instMesh: el("span", null, "\u2014"),
          instTotal: el("span", null, "\u2014"),
          verts: el("span", null, "\u2014"),
          tris: el("span", null, "\u2014"),
          geos: el("span", null, "\u2014"),
          mats: el("span", null, "\u2014"),
          texs: el("span", null, "\u2014"),
          lights: el("span", null, "\u2014"),
          cameras: el("span", null, "\u2014"),
          nodes: el("span", null, "\u2014"),
          drawEst: el("span", null, "\u2014")
        };
        const stats = el("div");
        stats.append(
          row("nodes", refs.nodes),
          row("meshes", refs.meshes),
          row("instancedMeshes", refs.instMesh),
          row("\u03A3 instances", refs.instTotal),
          row("\u03A3 vertices", refs.verts),
          row("\u03A3 triangles", refs.tris),
          row("unique geometries", refs.geos),
          row("unique materials", refs.mats),
          row("unique textures", refs.texs),
          row("lights", refs.lights),
          row("cameras", refs.cameras),
          row("draw calls (est.)", refs.drawEst)
        );
        block.appendChild(stats);
        const modelList = makeKeyedList(block, {
          title: "Models",
          cols: "32px 1fr 40px 50px 50px",
          headers: [
            { label: "kind" },
            { label: "label / source" },
            { label: "meshes", right: true },
            { label: "verts", right: true },
            { label: "tris", right: true }
          ],
          emptyText: "(no models attached)",
          getItems: () => (block.__lastSnap?.models || []).map((m, i) => ({
            key: `mdl:${i}:${m.label}`,
            idx: i,
            ...m
          })),
          getKey: (it) => it.key,
          build: () => {
            const k = el("span", { color: "#fc6", fontSize: "10px", textTransform: "uppercase" });
            const n = el("span");
            const m = el("span", { textAlign: "right" });
            const v = el("span", { textAlign: "right" });
            const t = el("span", { textAlign: "right", color: "#888" });
            const rEl = tableRow("32px 1fr 40px 50px 50px");
            rEl.append(k, n, m, v, t);
            return { row: rEl, refs: { k, n, m, v, t } };
          },
          update: (e, it) => {
            e.refs.k.textContent = it.kind;
            const sub = it.source ? `  \xB7 ${it.source.split("/").pop()}` : "";
            e.refs.n.textContent = `${it.label}${sub}`;
            e.refs.m.textContent = String(it.meshes);
            e.refs.v.textContent = fmtNum2(it.vertices);
            e.refs.t.textContent = fmtNum2(it.triangles);
            e.row.style.opacity = it.visible ? "1" : "0.5";
          },
          onClick: (it) => openDetail({ side: "scene", kind: "model", sceneIdx, modelIdx: it.idx })
        });
        const meshList = makeKeyedList(block, {
          title: "Scene primitives",
          cols: "22px 1fr 50px 50px 40px",
          headers: [
            { label: "k" },
            { label: "name" },
            { label: "verts", right: true },
            { label: "tris", right: true },
            { label: "inst", right: true }
          ],
          emptyText: "(no primitives \u2014 all renderables belong to a model)",
          getItems: () => (block.__lastSnap?.meshes || []).filter((m) => m.modelIndex < 0).map((m, i) => ({
            key: `m:${i}:${m.geometryUuid || m.name}`,
            ...m,
            idx: i
          })),
          getKey: (it) => it.key,
          build: () => {
            const k = el("span", { color: "#0bf" });
            const n = el("span");
            const v = el("span", { textAlign: "right" });
            const t = el("span", { textAlign: "right" });
            const i = el("span", { textAlign: "right", color: "#888" });
            const rEl = tableRow("22px 1fr 50px 50px 40px");
            rEl.append(k, n, v, t, i);
            return { row: rEl, refs: { k, n, v, t, i } };
          },
          update: (e, it) => {
            e.refs.k.textContent = MESH_KIND_GLYPH[it.kind] || "?";
            e.refs.n.textContent = it.name;
            e.refs.v.textContent = fmtNum2(it.vertices);
            e.refs.t.textContent = fmtNum2(it.triangles);
            e.refs.i.textContent = it.isInstanced ? "\xD7" + it.instanceCount : "";
            e.row.style.opacity = it.visible ? "1" : "0.5";
          }
        });
        const texList = makeKeyedList(block, {
          title: "Textures (in scene)",
          cols: "1fr 70px 60px 30px",
          headers: [
            { label: "name / slot" },
            { label: "size", right: true },
            { label: "format", right: true },
            { label: "refs", right: true }
          ],
          emptyText: "(no textures)",
          getItems: () => block.__lastSnap?.textures.map((t, i) => ({
            key: `tx:${i}:${t.name || ""}:${t.width}x${t.height}`,
            idx: i,
            ...t
          })) || [],
          getKey: (it) => it.key,
          build: () => {
            const n = el("span");
            const s = el("span", { textAlign: "right" });
            const f = el("span", { textAlign: "right", color: "#888" });
            const c = el("span", { textAlign: "right", color: "#888" });
            const rEl = tableRow("1fr 70px 60px 30px");
            rEl.append(n, s, f, c);
            return { row: rEl, refs: { n, s, f, c } };
          },
          update: (e, it) => {
            const slot = it.refKeys.length ? it.refKeys.join(",") : "?";
            e.refs.n.textContent = `${it.name || "(unnamed)"}  \xB7 ${slot}`;
            e.refs.s.textContent = it.width && it.height ? `${it.width}\xD7${it.height}` : "\u2014";
            e.refs.f.textContent = it.isCompressed ? "compressed" : it.format != null ? String(it.format) : "\u2014";
            e.refs.c.textContent = String(it.count);
          }
        });
        block.__refresh = () => {
          const snap = snapshotScene(entry.scene, scenes2.models);
          block.__lastSnap = snap;
          let instMeshes = 0;
          for (const m of snap.meshes) if (m.isInstanced) instMeshes++;
          refs.nodes.textContent = String(snap.nodeCount);
          refs.meshes.textContent = String(snap.meshes.length);
          refs.instMesh.textContent = String(instMeshes);
          refs.instTotal.textContent = fmtNum2(snap.totalInstances);
          refs.verts.textContent = fmtNum2(snap.totalVerts);
          refs.tris.textContent = fmtNum2(snap.totalTris);
          refs.geos.textContent = String(snap.uniqueGeometries);
          refs.mats.textContent = String(snap.uniqueMaterials);
          refs.texs.textContent = String(snap.uniqueTextures);
          refs.lights.textContent = String(snap.lights.length);
          refs.cameras.textContent = String(snap.cameras.length);
          refs.drawEst.textContent = String(snap.drawCallEstimate);
          modelList();
          meshList();
          texList();
        };
        r.appendChild(block);
        return block;
      });
      function update() {
        for (const b of blocks) b.__refresh();
      }
      return { root: r, update };
    }
    function buildDetailView(d) {
      const r = el("div");
      const back = button("\u2190 back", () => {
        state.detail = null;
        rerenderCurrent();
      });
      back.style.margin = "4px 6px 8px";
      r.appendChild(back);
      if (d.side === "webgl") return buildWebGLDetail(d, r);
      if (d.side === "webgpu") return buildWebGPUDetail(d, r);
      if (d.side === "scene") return buildSceneDetail(d, r);
      return { root: r };
    }
    function buildSceneDetail(d, r) {
      if (d.kind === "model") {
        let update = function() {
          const snap = snapshotScene(entry.scene, scenes2.models);
          const ms = snap.models[d.modelIdx];
          if (!ms) return;
          r.__lastModel = ms;
          refs.kind.textContent = ms.kind;
          refs.source.textContent = ms.source || "\u2014";
          refs.rootName.textContent = ms.rootName || "(unnamed root)";
          refs.visible.textContent = ms.visible ? "yes" : "no";
          refs.nodes.textContent = String(ms.nodes);
          refs.meshes.textContent = String(ms.meshes);
          refs.instances.textContent = fmtNum2(ms.instances);
          refs.verts.textContent = fmtNum2(ms.vertices);
          refs.tris.textContent = fmtNum2(ms.triangles);
          refs.geos.textContent = String(ms.uniqueGeometries);
          refs.mats.textContent = String(ms.uniqueMaterials);
          refs.texs.textContent = String(ms.uniqueTextures);
          meshList();
          texList();
        };
        const entry = scenes2.scenes[d.sceneIdx];
        const modelMeta = scenes2.models[d.modelIdx];
        if (!entry || !modelMeta) {
          r.appendChild(noContextMsg("(model not found)"));
          return { root: r };
        }
        r.appendChild(section(`Model \xB7 ${modelMeta.label}`));
        const refs = {
          kind: el("span"),
          source: el("span"),
          rootName: el("span"),
          nodes: el("span"),
          meshes: el("span"),
          instances: el("span"),
          verts: el("span"),
          tris: el("span"),
          geos: el("span"),
          mats: el("span"),
          texs: el("span"),
          visible: el("span")
        };
        r.append(
          row("kind", refs.kind),
          row("source", refs.source),
          row("root", refs.rootName),
          row("visible", refs.visible),
          row("nodes", refs.nodes),
          row("meshes", refs.meshes),
          row("\u03A3 instances", refs.instances),
          row("\u03A3 vertices", refs.verts),
          row("\u03A3 triangles", refs.tris),
          row("unique geos", refs.geos),
          row("unique mats", refs.mats),
          row("unique tex", refs.texs)
        );
        const meshList = makeKeyedList(r, {
          title: "Meshes (this model)",
          cols: "22px 1fr 50px 50px 40px",
          headers: [
            { label: "k" },
            { label: "name" },
            { label: "verts", right: true },
            { label: "tris", right: true },
            { label: "inst", right: true }
          ],
          emptyText: "(no meshes)",
          getItems: () => (r.__lastModel?.meshList || []).map((m, i) => ({
            key: `m:${i}:${m.geometryUuid || m.name}`,
            ...m,
            idx: i
          })),
          getKey: (it) => it.key,
          build: () => {
            const k = el("span", { color: "#0bf" });
            const n = el("span");
            const v = el("span", { textAlign: "right" });
            const t = el("span", { textAlign: "right" });
            const i = el("span", { textAlign: "right", color: "#888" });
            const rEl = tableRow("22px 1fr 50px 50px 40px");
            rEl.append(k, n, v, t, i);
            return { row: rEl, refs: { k, n, v, t, i } };
          },
          update: (e, it) => {
            e.refs.k.textContent = MESH_KIND_GLYPH[it.kind] || "?";
            e.refs.n.textContent = it.name;
            e.refs.v.textContent = fmtNum2(it.vertices);
            e.refs.t.textContent = fmtNum2(it.triangles);
            e.refs.i.textContent = it.isInstanced ? "\xD7" + it.instanceCount : "";
            e.row.style.opacity = it.visible ? "1" : "0.5";
          }
        });
        const texList = makeKeyedList(r, {
          title: "Textures (this model)",
          cols: "1fr 70px 60px 30px",
          headers: [
            { label: "name / slot" },
            { label: "size", right: true },
            { label: "format", right: true },
            { label: "refs", right: true }
          ],
          emptyText: "(no textures)",
          getItems: () => (r.__lastModel?.textures || []).map((t, i) => ({
            key: `tx:${i}:${t.name || ""}:${t.width}x${t.height}`,
            idx: i,
            ...t
          })),
          getKey: (it) => it.key,
          build: () => {
            const n = el("span");
            const s = el("span", { textAlign: "right" });
            const f = el("span", { textAlign: "right", color: "#888" });
            const c = el("span", { textAlign: "right", color: "#888" });
            const rEl = tableRow("1fr 70px 60px 30px");
            rEl.append(n, s, f, c);
            return { row: rEl, refs: { n, s, f, c } };
          },
          update: (e, it) => {
            const slot = it.refKeys.length ? it.refKeys.join(",") : "?";
            e.refs.n.textContent = `${it.name || "(unnamed)"}  \xB7 ${slot}`;
            e.refs.s.textContent = it.width && it.height ? `${it.width}\xD7${it.height}` : "\u2014";
            e.refs.f.textContent = it.isCompressed ? "compressed" : it.format != null ? String(it.format) : "\u2014";
            e.refs.c.textContent = String(it.count);
          }
        });
        return { root: r, update };
      }
      return { root: r };
    }
    function buildWebGLDetail(d, r) {
      const hit = findInWebGL(webgl2, d.id, d.contextIdx);
      if (!hit) {
        r.appendChild(noContextMsg("(not found)"));
        return { root: r };
      }
      const rec = hit.record, resource = hit.resource;
      const ctxBadge = showPrefix("webgl") ? el("span", { color: "#888", marginLeft: "6px", fontSize: "10px" }, `context ${contextLetter(hit.ctxIdx)}`) : null;
      if (d.kind === "program") {
        let update = function() {
          const info = extractProgram(rec.gl, resource, {
            id: d.id,
            drawCalls: rec.drawCalls.get(resource) || 0,
            useProgramCount: rec.useProgramCount.get(resource) || 0
          }, rec);
          refs.active.textContent = info.active ? "yes" : "no";
          refs.linked.textContent = info.linked ? "yes" : "no";
          refs.validated.textContent = info.validated ? "yes" : "no";
          refs.draws.textContent = fmtNum2(info.drawCalls);
          refs.uses.textContent = fmtNum2(info.useProgramCount);
          for (let i = 0; i < info.uniforms.length; i++) {
            if (!uniformRefs[i]) break;
            uniformRefs[i].valSpan.textContent = fmtUniform(info.uniforms[i].value);
          }
        };
        const head = el("div");
        head.appendChild(section(`Program ${d.id}`));
        if (ctxBadge) head.firstChild.appendChild(ctxBadge);
        r.appendChild(head);
        const metaBox = el("div");
        r.appendChild(metaBox);
        const refs = {
          active: el("span"),
          linked: el("span"),
          validated: el("span"),
          draws: el("span"),
          uses: el("span")
        };
        metaBox.append(
          row("active", refs.active),
          row("linked", refs.linked),
          row("validated", refs.validated),
          row("\u03A3 draws", refs.draws),
          row("\u03A3 useProgram", refs.uses)
        );
        const info0 = extractProgram(rec.gl, resource, { id: d.id }, rec);
        if (info0.infoLog) {
          r.appendChild(section("infoLog"));
          const log = el("pre", null, info0.infoLog);
          log.className = "wgla-pre";
          r.appendChild(log);
        }
        if (info0.attribs.length) {
          r.appendChild(section(`Attributes (${info0.attribs.length})`));
          for (const a of info0.attribs) {
            r.appendChild(row(a.name, el("span", { color: "#888" }, `${a.type} @${a.location}`)));
          }
        }
        const uniformRefs = [];
        if (info0.uniforms.length) {
          r.appendChild(section(`Uniforms (${info0.uniforms.length})  \xB7  live`));
          for (const u of info0.uniforms) {
            const typeSpan = el("span", { color: "#666" }, `${u.type} = `);
            const valSpan = el("span", { color: "#cde" }, "\u2014");
            uniformRefs.push({ name: u.name, valSpan });
            const wrap2 = el("span");
            wrap2.append(typeSpan, valSpan);
            r.appendChild(row(`${u.name}${u.size > 1 ? `[${u.size}]` : ""}`, wrap2));
          }
        }
        for (const sh of info0.shaders) {
          r.appendChild(section(`${sh.type}  ${sh.compiled ? "\u2713" : "\u2717"}  (${sh.sourceLength} chars)`));
          if (sh.infoLog) {
            const log = el("pre", null, sh.infoLog);
            log.className = "wgla-pre";
            r.appendChild(log);
          }
          const pre = el("pre", null, sh.source);
          pre.className = "wgla-pre";
          r.appendChild(pre);
        }
        return { root: r, update };
      }
      if (d.kind === "buffer") {
        const info = rec.buffers.get(resource);
        if (!info) return { root: r };
        r.appendChild(section(`Buffer ${d.id}`));
        r.append(
          row("target", el("span", null, info.target || "UNKNOWN")),
          row("size", el("span", null, fmtBytes2(info.size))),
          row("usage", el("span", null, info.usage || "?"))
        );
        return { root: r };
      }
      if (d.kind === "texture") {
        const info = rec.textures.get(resource);
        if (!info) return { root: r };
        r.appendChild(section(`Texture ${d.id}`));
        const sz = info.depth > 1 ? `${info.width}\xD7${info.height}\xD7${info.depth}` : `${info.width}\xD7${info.height}`;
        r.append(
          row("target", el("span", null, info.target || "?")),
          row("size", el("span", null, sz)),
          row("internalFormat", el("span", null, info.internalFormat || "?")),
          row("format", el("span", null, info.format || "?")),
          row("type", el("span", null, info.type || "?")),
          row("mipmap", el("span", null, info.mipmap ? "yes" : "no"))
        );
        return { root: r };
      }
      if (d.kind === "framebuffer") {
        const info = rec.framebuffers.get(resource);
        if (!info) return { root: r };
        r.appendChild(section(`Framebuffer ${d.id}`));
        for (const [name, a] of Object.entries(info.attachments || {})) {
          const refId = a.texture ? rec.ids.get(a.texture) : a.renderbuffer ? rec.ids.get(a.renderbuffer) : null;
          const link = el("span", null, `${a.kind} \u2192 ${refId || "?"}${a.level != null ? " L" + a.level : ""}`);
          if (refId) link.className = "wgla-link";
          if (refId) link.addEventListener("click", () => {
            openDetail({
              side: "webgl",
              kind: a.texture ? "texture" : "renderbuffer",
              id: refId,
              contextIdx: hit.ctxIdx
            });
          });
          r.appendChild(row(name, link));
        }
        return { root: r };
      }
      if (d.kind === "renderbuffer") {
        const info = rec.renderbuffers.get(resource);
        if (!info) return { root: r };
        r.appendChild(section(`Renderbuffer ${d.id}`));
        r.append(
          row("internalFormat", el("span", null, info.internalFormat || "?")),
          row("size", el("span", null, `${info.width}\xD7${info.height}`)),
          row("samples", el("span", null, String(info.samples || 0)))
        );
        return { root: r };
      }
      return { root: r };
    }
    function buildWebGPUDetail(d, r) {
      const hit = findInWebGPU(webgpu2, d.id, d.contextIdx);
      if (!hit) {
        r.appendChild(noContextMsg("(not found)"));
        return { root: r };
      }
      const rec = hit.record, res = hit.resource;
      if (d.kind === "renderPipeline") {
        const info = rec.renderPipelines.get(res);
        if (!info) return { root: r };
        r.appendChild(section(`Render Pipeline ${d.id}`));
        r.append(
          row("label", el("span", null, info.label || "")),
          row("topology", el("span", null, info.topology)),
          row("cullMode", el("span", null, info.cullMode)),
          row("frontFace", el("span", null, info.frontFace)),
          row("layout", el("span", null, info.layoutKind)),
          row("samples", el("span", null, String(info.multisample.count)))
        );
        if (info.vertex) {
          r.appendChild(section("vertex"));
          r.appendChild(row("module", linkSpan(info.vertex.moduleId, () => {
            if (info.vertex.moduleId) openDetail({ side: "webgpu", kind: "shaderModule", id: info.vertex.moduleId, contextIdx: hit.ctxIdx });
          })));
          r.appendChild(row("entry", el("span", null, info.vertex.entryPoint || "?")));
          for (let i = 0; i < info.vertex.buffers.length; i++) {
            const b = info.vertex.buffers[i];
            r.appendChild(row(`buf[${i}] stride`, el("span", null, `${b.arrayStride} (${b.stepMode})`)));
            for (const a of b.attributes) {
              r.appendChild(row(`  loc ${a.shaderLocation}`, el("span", null, `${a.format} +${a.offset}`)));
            }
          }
        }
        if (info.fragment) {
          r.appendChild(section("fragment"));
          r.appendChild(row("module", linkSpan(info.fragment.moduleId, () => {
            if (info.fragment.moduleId) openDetail({ side: "webgpu", kind: "shaderModule", id: info.fragment.moduleId, contextIdx: hit.ctxIdx });
          })));
          r.appendChild(row("entry", el("span", null, info.fragment.entryPoint || "?")));
          for (let i = 0; i < info.fragment.targets.length; i++) {
            const t = info.fragment.targets[i];
            r.appendChild(row(`target[${i}]`, el("span", null, `${t.format}${t.blend ? " \xB7 blend" : ""}`)));
          }
        }
        if (info.depthStencil) {
          r.appendChild(section("depth/stencil"));
          r.append(
            row("format", el("span", null, info.depthStencil.format || "?")),
            row("write", el("span", null, info.depthStencil.depthWriteEnabled ? "yes" : "no")),
            row("compare", el("span", null, info.depthStencil.depthCompare || ""))
          );
        }
        return { root: r };
      }
      if (d.kind === "computePipeline") {
        const info = rec.computePipelines.get(res);
        if (!info) return { root: r };
        r.appendChild(section(`Compute Pipeline ${d.id}`));
        r.appendChild(row("label", el("span", null, info.label || "")));
        if (info.compute) {
          r.appendChild(row("module", linkSpan(info.compute.moduleId, () => {
            if (info.compute.moduleId) openDetail({ side: "webgpu", kind: "shaderModule", id: info.compute.moduleId, contextIdx: hit.ctxIdx });
          })));
          r.appendChild(row("entry", el("span", null, info.compute.entryPoint || "?")));
        }
        return { root: r };
      }
      if (d.kind === "shaderModule") {
        const info = rec.shaderModules.get(res);
        if (!info) return { root: r };
        r.appendChild(section(`Shader Module ${d.id}`));
        r.append(
          row("label", el("span", null, info.label || "")),
          row("chars", el("span", null, fmtNum2(info.sourceLength)))
        );
        r.appendChild(section("WGSL"));
        const pre = el("pre", null, info.code);
        pre.className = "wgla-pre";
        r.appendChild(pre);
        return { root: r };
      }
      if (d.kind === "gpuBuffer") {
        const info = rec.buffers.get(res);
        if (!info) return { root: r };
        r.appendChild(section(`Buffer ${d.id}`));
        r.append(
          row("label", el("span", null, info.label || "")),
          row("size", el("span", null, fmtBytes2(info.size))),
          row("usage", el("span", null, (info.usageFlags || []).join(" | "))),
          row("mapped@create", el("span", null, info.mappedAtCreation ? "yes" : "no"))
        );
        return { root: r };
      }
      if (d.kind === "gpuTexture") {
        const info = rec.textures.get(res);
        if (!info) return { root: r };
        r.appendChild(section(`Texture ${d.id}`));
        const sz = info.depthOrArrayLayers > 1 ? `${info.width}\xD7${info.height}\xD7${info.depthOrArrayLayers}` : `${info.width}\xD7${info.height}`;
        r.append(
          row("label", el("span", null, info.label || "")),
          row("size", el("span", null, sz)),
          row("format", el("span", null, info.format || "?")),
          row("dimension", el("span", null, info.dimension)),
          row("mipLevels", el("span", null, String(info.mipLevelCount))),
          row("samples", el("span", null, String(info.sampleCount))),
          row("usage", el("span", null, (info.usageFlags || []).join(" | ")))
        );
        return { root: r };
      }
      if (d.kind === "bindGroup") {
        const info = rec.bindGroups.get(res);
        if (!info) return { root: r };
        r.appendChild(section(`Bind Group ${d.id}`));
        r.append(
          row("label", el("span", null, info.label || "")),
          row("layout", info.layoutId ? linkSpan(info.layoutId, () => openDetail({ side: "webgpu", kind: "bindGroupLayout", id: info.layoutId, contextIdx: hit.ctxIdx })) : el("span", { color: "#888" }, "(auto from pipeline)")),
          row("#entries", el("span", null, String((info.entries || []).length)))
        );
        const layoutInfo = info.layout ? rec.bindGroupLayouts.get(info.layout) : null;
        r.appendChild(section("entries"));
        for (const e of info.entries || []) {
          const lyEntry = layoutInfo?.entries.find((le) => le.binding === e.binding);
          const meta = el("span");
          if (lyEntry) {
            const vis = (lyEntry.visibility || []).join("|") || "?";
            meta.append(el("span", { color: "#888" }, `${lyEntry.kind} \xB7 vis:${vis}`));
          } else {
            meta.append(el("span", { color: "#888" }, "(no layout info)"));
          }
          r.appendChild(row(`@binding(${e.binding})`, meta));
          const res2 = e.resource;
          if (!res2) continue;
          if (res2.kind === "bufferBinding") {
            const link = linkSpan(res2.bufferId || "?", () => {
              if (res2.bufferId) openDetail({ side: "webgpu", kind: "gpuBuffer", id: res2.bufferId, contextIdx: hit.ctxIdx });
            });
            const buf = rec.buffers.get(res2.buffer);
            const total = buf ? buf.size : null;
            const slice = res2.size != null ? res2.size : total != null ? total - (res2.offset | 0) : null;
            const detail = el("span");
            detail.append(link);
            detail.append(el(
              "span",
              { color: "#888" },
              ` +${res2.offset | 0}, ${slice != null ? fmtBytes2(slice) : "?"}${total != null ? ` of ${fmtBytes2(total)}` : ""}`
            ));
            r.appendChild(row("  buffer", detail));
            const minSz = lyEntry?.detail?.minBindingSize;
            if (minSz && slice != null && slice < minSz) {
              const warn = el(
                "div",
                null,
                `\u26A0 binding size ${fmtBytes2(slice)} < minBindingSize ${fmtBytes2(minSz)}`
              );
              warn.className = "wgla-warn";
              warn.style.margin = "2px 12px";
              r.appendChild(warn);
            }
          } else if (res2.kind === "textureView") {
            if (res2.textureId) {
              const link = linkSpan(res2.textureId, () => openDetail({
                side: "webgpu",
                kind: "gpuTexture",
                id: res2.textureId,
                contextIdx: hit.ctxIdx
              }));
              const wrap2 = el("span");
              wrap2.append(el("span", { color: "#888" }, "view of "), link);
              if (res2.label) wrap2.append(el("span", { color: "#888" }, ` \xB7 ${res2.label}`));
              r.appendChild(row("  textureView", wrap2));
            } else {
              r.appendChild(row("  textureView", el(
                "span",
                { color: "#888" },
                res2.label ? `(canvas?) \xB7 ${res2.label}` : "(canvas or external)"
              )));
            }
          } else if (res2.kind === "sampler") {
            r.appendChild(row("  sampler", el("span", null, res2.id || "?")));
          } else if (res2.kind === "externalTexture") {
            r.appendChild(row("  externalTexture", el("span", null, res2.id || "?")));
          } else {
            r.appendChild(row("  resource", el("span", { color: "#888" }, res2.kind || "?")));
          }
        }
        return { root: r };
      }
      if (d.kind === "bindGroupLayout") {
        const info = rec.bindGroupLayouts.get(res);
        if (!info) return { root: r };
        r.appendChild(section(`Bind Group Layout ${d.id}`));
        r.append(
          row("label", el("span", null, info.label || "")),
          row("source", el("span", null, info.explicit ? "explicit" : "derived")),
          row("#entries", el("span", null, String((info.entries || []).length)))
        );
        r.appendChild(section("entries"));
        for (const e of info.entries || []) {
          const vis = (e.visibility || []).join("|") || "?";
          const detail = el("span", { color: "#888" }, `${e.kind} \xB7 vis:${vis}`);
          if (e.kind === "buffer" && e.detail?.minBindingSize) {
            detail.textContent += ` \xB7 minBindingSize:${e.detail.minBindingSize}`;
          }
          if (e.kind === "buffer" && e.detail?.type) {
            detail.textContent += ` \xB7 ${e.detail.type}`;
          }
          r.appendChild(row(`@binding(${e.binding})`, detail));
        }
        return { root: r };
      }
      return { root: r };
    }
    let lastSizesSig = "";
    function updateChrome() {
      rebuildDropdown(false);
      const glN = webgl2?.records.size || 0;
      const gpuN = webgpu2?.records.size || 0;
      const parts = [];
      if (glN) parts.push(`${glN} gl`);
      if (gpuN) parts.push(`${gpuN} gpu`);
      badge.textContent = parts.length ? `  ${parts.join(" \xB7 ")}` : "  no context";
      tabButtons.gpu.style.display = gpuN ? "" : "none";
      const onlyGPU = gpuN && !glN;
      tabButtons.programs.style.display = onlyGPU ? "none" : "";
      tabButtons.resources.style.display = onlyGPU ? "none" : "";
      if (onlyGPU && (state.tab === "programs" || state.tab === "resources")) switchTab("gpu");
      if (!gpuN && state.tab === "gpu") switchTab("live");
      const sceneN = scenes2?.scenes?.length || 0;
      tabButtons.scene.style.display = sceneN || glN ? "" : "none";
      if (!sceneN && !glN && state.tab === "scene") switchTab("live");
      const sig = `${glN}|${gpuN}|${sceneN}`;
      if (sig !== lastSizesSig) {
        lastSizesSig = sig;
        rerenderCurrent();
      }
    }
    const unsubFrame = onFrame(() => {
      updateChrome();
      currentController?.update?.();
    });
    function noContextMsg(label) {
      const m = el("div", null, `no ${label} context`);
      m.className = "wgla-empty";
      return m;
    }
    rebuildDropdown(true);
    switchTab("live");
    function unmount() {
      unsubFrame();
      if (state.selected?.record?.canvas) {
        state.selected.record.canvas.classList.remove("wgla-canvas-highlight");
      }
      root.remove();
    }
    root.__wgla_unmount = unmount;
    return root;
  }
  function unmountHUD() {
    const e = document.getElementById(HUD_ID);
    if (e && e.__wgla_unmount) e.__wgla_unmount();
    else if (e) e.remove();
  }
  function linkSpan(text, onClick) {
    const s = el("span", null, text || "?");
    s.className = "wgla-link";
    s.addEventListener("click", onClick);
    return s;
  }
  function downloadCombined(webgl2, webgpu2) {
    const data = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      url: location.href,
      webgl: webgl2?.data?.() || null,
      webgpu: webgpu2?.data?.() || null
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gpu-probe.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  function countContexts(webgl2, webgpu2) {
    return (webgl2?.records.size || 0) + (webgpu2?.records.size || 0);
  }
  function makeDropdownSignature(webgl2, webgpu2) {
    const parts = [];
    if (webgl2) for (const [, r] of webgl2.records) parts.push(`gl:${r.canvas?.id || ""}:${r.canvas?.width}x${r.canvas?.height}`);
    if (webgpu2) for (const [, r] of webgpu2.records) parts.push(`gpu:${r.canvas?.id || ""}`);
    return parts.join("|");
  }
  function parseSelectKey(v, webgl2, webgpu2) {
    const [side, idxStr] = v.split(":");
    const idx = +idxStr;
    if (side === "webgl" && webgl2) {
      const arr = [...webgl2.records.values()];
      return { side: "webgl", record: arr[idx] };
    }
    if (side === "webgpu" && webgpu2) {
      const arr = [...webgpu2.records.values()];
      return { side: "webgpu", record: arr[idx] };
    }
    return null;
  }
  function selectKeyFor(sel, webgl2, webgpu2) {
    const analyzer = sel.side === "webgl" ? webgl2 : webgpu2;
    if (!analyzer) return "";
    const arr = [...analyzer.records.values()];
    const idx = arr.indexOf(sel.record);
    return idx >= 0 ? `${sel.side}:${idx}` : "";
  }
  function enableDrag(root, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON" || e.target.tagName === "SELECT") return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = root.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      root.style.left = `${ox}px`;
      root.style.top = `${oy}px`;
      root.style.right = "auto";
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      root.style.left = `${ox + (e.clientX - sx)}px`;
      root.style.top = `${oy + (e.clientY - sy)}px`;
    });
    window.addEventListener("mouseup", () => dragging = false);
  }

  // src/index.js
  var webgl = getAnalyzer();
  var webgpu = getWebGPUAnalyzer();
  var scenes = getSceneTracker();
  var api = {
    version: "0.2.0",
    // analyzers
    webgl,
    webgpu,
    scenes,
    Analyzer,
    WebGPUAnalyzer,
    instance: webgl,
    // backwards compat with v0.1
    // unified controls
    install: () => {
      webgl.install();
      webgpu.install();
      return api;
    },
    uninstall: () => {
      webgl.uninstall();
      return api;
    },
    scan: () => {
      webgl.scan();
      webgpu.scan();
      return api;
    },
    attach: (gl, canvas, version) => webgl.attach(gl, canvas, version),
    // Three.js scene attach — backend-agnostic; works for WebGLRenderer and WebGPURenderer.
    attachScene: (scene, opts) => {
      scenes.attach(scene, opts);
      return api;
    },
    detachScene: (scene) => {
      scenes.detach(scene);
      return api;
    },
    // Tag a loaded asset root (e.g. gltf.scene) so the Scene tab can group its
    // meshes/textures separately from procedural primitives.
    attachModel: (root, opts) => {
      scenes.attachModel(root, opts);
      return api;
    },
    detachModel: (root) => {
      scenes.detachModel(root);
      return api;
    },
    data: () => ({ webgl: webgl.data(), webgpu: webgpu.data() }),
    report: () => {
      webgl.report();
      if (webgpu.records.size) webgpu.report();
    },
    download: (filename = "gpu-probe.json") => {
      const data = api.data();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
    },
    reset: () => {
      webgl.reset();
      webgpu.reset();
      return api;
    },
    showHUD: () => mountHUD({ webgl, webgpu, scenes }),
    hideHUD: () => unmountHUD()
  };
  if (typeof globalThis !== "undefined") {
    globalThis.GPUProbe = api;
  }
  var index_default = api;
  return __toCommonJS(index_exports);
})();
