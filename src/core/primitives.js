// primitives.js
// Convert a draw call's (mode, count, instanceCount) into vertex/primitive
// counts. Knows about every WebGL2 draw mode.

const MODES = {
  0x0000: { name: "POINTS",         kind: "points",    prims: (c) => c },
  0x0001: { name: "LINES",          kind: "lines",     prims: (c) => (c >= 2 ? (c / 2) | 0 : 0) },
  0x0002: { name: "LINE_LOOP",      kind: "lines",     prims: (c) => (c >= 2 ? c : 0) },
  0x0003: { name: "LINE_STRIP",     kind: "lines",     prims: (c) => (c >= 2 ? c - 1 : 0) },
  0x0004: { name: "TRIANGLES",      kind: "triangles", prims: (c) => (c >= 3 ? (c / 3) | 0 : 0) },
  0x0005: { name: "TRIANGLE_STRIP", kind: "triangles", prims: (c) => (c >= 3 ? c - 2 : 0) },
  0x0006: { name: "TRIANGLE_FAN",   kind: "triangles", prims: (c) => (c >= 3 ? c - 2 : 0) },
};

export function classifyDraw(mode, count, instances = 1) {
  const m = MODES[mode];
  const inst = Math.max(1, instances | 0);
  if (!m) {
    return {
      modeName: `UNKNOWN(0x${mode.toString(16)})`,
      kind: "unknown",
      vertices: (count | 0) * inst,
      primitives: 0,
      instances: inst,
    };
  }
  return {
    modeName: m.name,
    kind: m.kind,
    vertices: (count | 0) * inst,
    primitives: m.prims(count | 0) * inst,
    instances: inst,
  };
}
