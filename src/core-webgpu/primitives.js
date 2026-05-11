// primitives.js (WebGPU)
// WebGPU topology -> primitive math. Different from WebGL: no triangle-fan,
// no line-loop. Vertex/index counts come straight from draw(), drawIndexed().

const TOPOS = {
  "point-list":     { kind: "points",    prims: (c) => c },
  "line-list":      { kind: "lines",     prims: (c) => (c >= 2 ? (c / 2) | 0 : 0) },
  "line-strip":     { kind: "lines",     prims: (c) => (c >= 2 ? c - 1 : 0) },
  "triangle-list":  { kind: "triangles", prims: (c) => (c >= 3 ? (c / 3) | 0 : 0) },
  "triangle-strip": { kind: "triangles", prims: (c) => (c >= 3 ? c - 2 : 0) },
};

export function classifyDraw(topology, count, instances = 1) {
  const t = TOPOS[topology] || TOPOS["triangle-list"];
  const inst = Math.max(1, instances | 0);
  return {
    topology: topology || "triangle-list",
    kind: t.kind,
    vertices: (count | 0) * inst,
    primitives: t.prims(count | 0) * inst,
    instances: inst,
  };
}

// Decode GPUBufferUsage bitmask into readable flag names.
export function bufferUsageFlags(mask) {
  const flags = [];
  if (mask & 0x0001) flags.push("MAP_READ");
  if (mask & 0x0002) flags.push("MAP_WRITE");
  if (mask & 0x0004) flags.push("COPY_SRC");
  if (mask & 0x0008) flags.push("COPY_DST");
  if (mask & 0x0010) flags.push("INDEX");
  if (mask & 0x0020) flags.push("VERTEX");
  if (mask & 0x0040) flags.push("UNIFORM");
  if (mask & 0x0080) flags.push("STORAGE");
  if (mask & 0x0100) flags.push("INDIRECT");
  if (mask & 0x0200) flags.push("QUERY_RESOLVE");
  return flags;
}

// Decode GPUTextureUsage bitmask.
export function textureUsageFlags(mask) {
  const flags = [];
  if (mask & 0x01) flags.push("COPY_SRC");
  if (mask & 0x02) flags.push("COPY_DST");
  if (mask & 0x04) flags.push("TEXTURE_BINDING");
  if (mask & 0x08) flags.push("STORAGE_BINDING");
  if (mask & 0x10) flags.push("RENDER_ATTACHMENT");
  return flags;
}

// Roughly classify a buffer by its dominant usage role for inventory grouping.
export function bufferKind(flagNames) {
  if (flagNames.includes("VERTEX")) return "VERTEX";
  if (flagNames.includes("INDEX")) return "INDEX";
  if (flagNames.includes("UNIFORM")) return "UNIFORM";
  if (flagNames.includes("STORAGE")) return "STORAGE";
  if (flagNames.includes("INDIRECT")) return "INDIRECT";
  return "OTHER";
}
