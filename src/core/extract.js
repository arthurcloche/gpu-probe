// extract.js
// Read-only extraction of a context's state into a JSON-safe snapshot.

import { GL_TYPE_NAMES } from "./gl-types.js";

function typeNameU(type) { return GL_TYPE_NAMES[type] || `0x${type.toString(16)}`; }

function shaderTypeName(gl, shader) {
  const t = gl.getShaderParameter(shader, gl.SHADER_TYPE);
  if (t === gl.VERTEX_SHADER) return "VERTEX_SHADER";
  if (t === gl.FRAGMENT_SHADER) return "FRAGMENT_SHADER";
  return `UNKNOWN(${t})`;
}

function safeUniformValue(gl, program, location) {
  if (!location) return null;
  try {
    const v = gl.getUniform(program, location);
    if (v == null) return null;
    if (ArrayBuffer.isView(v)) return Array.from(v);
    return v;
  } catch (_) {
    return null;
  }
}

export function extractShader(gl, shader, cached) {
  if (!shader && !cached) return null;
  // Prefer live GL state; fall back to whatever we cached at compile time.
  // After Three.js (and other engines) detach shaders post-link, the GL calls
  // below either return empty or throw on a deleted shader — that's when the
  // cached snapshot is the only source of truth.
  let type = cached?.type || null;
  let compiled = cached?.compiled ?? false;
  let deleted = false;
  let source = cached?.source || "";
  let infoLog = cached?.infoLog || "";
  if (shader) {
    // Only OVERWRITE cached values when GL actually has a useful answer. Once
    // the engine deletes a shader (Three.js does this right after linking),
    // getShaderParameter returns null on it — we must not clobber the cached
    // type/compiled with the dead-shader response.
    try {
      const t = gl.getShaderParameter(shader, gl.SHADER_TYPE);
      if (t === gl.VERTEX_SHADER) type = "VERTEX_SHADER";
      else if (t === gl.FRAGMENT_SHADER) type = "FRAGMENT_SHADER";
    } catch (_) {}
    try {
      const c = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
      if (c !== null && c !== undefined) compiled = !!c;
    } catch (_) {}
    try {
      const d = gl.getShaderParameter(shader, gl.DELETE_STATUS);
      if (d !== null && d !== undefined) deleted = !!d;
    } catch (_) {}
    try { const s = gl.getShaderSource(shader); if (s) source = s; } catch (_) {}
    try { const l = gl.getShaderInfoLog(shader); if (l) infoLog = l; } catch (_) {}
  }
  return {
    type: type || "UNKNOWN",
    compiled, deleted,
    sourceLength: source.length,
    source,
    infoLog,
  };
}

export function extractProgram(gl, program, meta = {}, record = null) {
  const linked = !!gl.getProgramParameter(program, gl.LINK_STATUS);
  const validated = !!gl.getProgramParameter(program, gl.VALIDATE_STATUS);
  const active = gl.getParameter(gl.CURRENT_PROGRAM) === program;

  const attached = gl.getAttachedShaders(program) || [];
  // Union of currently-attached shaders and shaders we saw via attachShader
  // before the engine detached them post-link.
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
      value: safeUniformValue(gl, program, loc),
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
      location: gl.getAttribLocation(program, info.name),
    });
  }

  return {
    id: meta.id ?? null,
    active, linked, validated,
    deleted: !!gl.getProgramParameter(program, gl.DELETE_STATUS),
    infoLog: gl.getProgramInfoLog(program) || "",
    drawCalls: meta.drawCalls ?? 0,
    useProgramCount: meta.useProgramCount ?? 0,
    shaders, uniforms, attribs,
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
      usage: info.usage || null,
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
      mipmap: !!info.mipmap,
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
        att[name] = { kind: a.kind, texture: idFor(record, a.texture, null),
                      level: a.level ?? 0, layer: a.layer ?? null };
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
      samples: info.samples || 0,
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

export function extractContext(gl, record) {
  const programs = [];
  for (const p of record.programs) {
    programs.push(
      extractProgram(gl, p, {
        id: idFor(record, p, "p?"),
        drawCalls: record.drawCalls.get(p) || 0,
        useProgramCount: record.useProgramCount.get(p) || 0,
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
      width: record.canvas.width, height: record.canvas.height,
      clientWidth: record.canvas.clientWidth, clientHeight: record.canvas.clientHeight,
      id: record.canvas.id || null, className: record.canvas.className || null,
    } : null,
    capabilities: {
      vendor: safeGet(gl, gl.VENDOR),
      renderer: safeGet(gl, gl.RENDERER),
      version: safeGet(gl, gl.VERSION),
      glslVersion: safeGet(gl, gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: safeGet(gl, gl.MAX_TEXTURE_SIZE),
      maxVertexAttribs: safeGet(gl, gl.MAX_VERTEX_ATTRIBS),
      maxVaryingVectors:
        safeGet(gl, gl.MAX_VARYING_VECTORS) ?? safeGet(gl, gl.MAX_VARYING_COMPONENTS),
      extensions: gl.getSupportedExtensions ? gl.getSupportedExtensions() : [],
    },
    frame: {
      fps: record.frame.fps,
      frameMs: record.frame.frameMs,
      drawCalls: record.frame.drawCalls,
      vertices: record.frame.vertices,
      triangles: record.frame.triangles,
      lines: record.frame.lines,
      points: record.frame.points,
      draws: record.frame.draws.slice(),
    },
    totals: {
      drawCalls: record.totalDrawCalls,
      vertices: record.totalVertices,
      triangles: record.totalTriangles,
      lines: record.totalLines,
      points: record.totalPoints,
      drawCallsByMethod: Object.fromEntries(record.drawCallsByMethod),
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
      syncs: record.syncs.size,
    },
    programs,
    buffers,
    textures,
    framebuffers,
    renderbuffers,
  };
}

function safeGet(gl, pname) {
  try { return gl.getParameter(pname); } catch (_) { return null; }
}
