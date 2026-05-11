// report.js
// Pretty console output for an extracted snapshot.

const S = {
  title: "color:#0bf;font-weight:bold;font-size:13px",
  dim:   "color:#888",
  kv:    "color:#aaa",
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

export function printSnapshot(snap) {
  const inv = snap.inventory;
  console.groupCollapsed(
    `%c[gpu-probe]%c ${snap.version}  ${inv.programs}p ${inv.buffers}b ${inv.textures}t ${inv.framebuffers}f  ${fmtNum(snap.totals.drawCalls)} draws  ${fmtNum(snap.totals.triangles)} tris`,
    S.title, S.dim
  );

  // Context
  console.groupCollapsed("%cContext", S.title);
  console.log("%cvendor:", S.kv, snap.capabilities.vendor);
  console.log("%crenderer:", S.kv, snap.capabilities.renderer);
  console.log("%cversion:", S.kv, snap.capabilities.version);
  console.log("%cglsl:", S.kv, snap.capabilities.glslVersion);
  if (snap.canvas) {
    console.log("%ccanvas:", S.kv,
      `${snap.canvas.width}×${snap.canvas.height} (css ${snap.canvas.clientWidth}×${snap.canvas.clientHeight})`,
      snap.canvas.id ? `#${snap.canvas.id}` : "");
  }
  console.groupEnd();

  // Live frame
  console.groupCollapsed(`%cFrame`, S.title);
  console.log("fps:", snap.frame.fps.toFixed(1));
  console.log("frame ms:", snap.frame.frameMs.toFixed(2));
  console.log("draws/frame:", snap.frame.drawCalls);
  console.log("tris/frame:",  snap.frame.triangles);
  console.log("verts/frame:", snap.frame.vertices);
  console.groupEnd();

  // Totals
  console.groupCollapsed(`%cTotals (since attach)`, S.title);
  console.table({
    drawCalls: snap.totals.drawCalls,
    vertices:  snap.totals.vertices,
    triangles: snap.totals.triangles,
    lines:     snap.totals.lines,
    points:    snap.totals.points,
  });
  console.log("by method:", snap.totals.drawCallsByMethod);
  console.groupEnd();

  // Inventory
  console.groupCollapsed(`%cInventory`, S.title);
  console.table({
    programs:           inv.programs,
    shaders:            inv.shaders,
    buffers:            inv.buffers,
    textures:           inv.textures,
    framebuffers:       inv.framebuffers,
    renderbuffers:      inv.renderbuffers,
    vaos:               inv.vaos,
    samplers:           inv.samplers,
    transformFeedbacks: inv.transformFeedbacks,
    queries:            inv.queries,
    syncs:              inv.syncs,
  });
  if (Object.keys(inv.buffersByTarget).length) {
    console.log("buffers by target:", inv.buffersByTarget);
  }
  console.groupEnd();

  // Resource tables
  if (snap.buffers.length) {
    console.groupCollapsed(`Buffers (${snap.buffers.length})`);
    console.table(snap.buffers.map(b => ({ id: b.id, target: b.target, size: fmtBytes(b.size), usage: b.usage })));
    console.groupEnd();
  }
  if (snap.textures.length) {
    console.groupCollapsed(`Textures (${snap.textures.length})`);
    console.table(snap.textures.map(t => ({
      id: t.id, target: t.target,
      size: t.depth > 1 ? `${t.width}×${t.height}×${t.depth}` : `${t.width}×${t.height}`,
      internalFormat: t.internalFormat, mipmap: t.mipmap,
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
    console.table(snap.renderbuffers.map(r => ({
      id: r.id, internalFormat: r.internalFormat, size: `${r.width}×${r.height}`, samples: r.samples,
    })));
    console.groupEnd();
  }

  // Programs
  for (const prog of snap.programs) {
    const head = `${prog.id}  ${prog.active ? "● active" : "○"}  linked:${prog.linked ? "✓" : "✗"}  draws:${prog.drawCalls}`;
    console.groupCollapsed(`%c${head}`, S.title);
    if (prog.infoLog) console.warn("infoLog:", prog.infoLog);
    if (prog.attribs.length) {
      console.groupCollapsed(`Attributes (${prog.attribs.length})`);
      console.table(prog.attribs);
      console.groupEnd();
    }
    if (prog.uniforms.length) {
      console.groupCollapsed(`Uniforms (${prog.uniforms.length})`);
      console.table(prog.uniforms.map(u => ({
        name: u.name, type: u.type, size: u.size, value: fmtValue(u.value),
      })));
      console.groupEnd();
    }
    for (const sh of prog.shaders) {
      const status = sh.compiled ? "✓" : "✗";
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
    if (v.length > 6) return `[${v.slice(0, 6).map(short).join(", ")}, …(${v.length})]`;
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
