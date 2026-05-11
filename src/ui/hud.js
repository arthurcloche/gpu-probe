// hud.js
// Tabbed live HUD for WebGL + WebGPU.
//
// Architecture
// ────────────
//   - Chrome (header, dropdown, tabbar, footer) is built ONCE at mount.
//   - Each tab returns a controller { root, update? }. `root` is built on tab
//     activation; `update()` runs every frame to diff live data via keyed rows.
//   - keyed-list diff (see makeKeyedList) preserves row identity across frames,
//     so click targets, hover state, and selection survive live updates.
//   - When multiple contexts/devices exist and "All" is selected, rows are
//     prefixed with a context letter (A·, B·, …). Filtering to one drops the
//     prefix and also highlights the corresponding canvas.

import { onFrame } from "../core/frame.js";
import { extractProgram } from "../core/extract.js";
import { snapshotScene } from "../core/scene.js";

const HUD_ID = "__wgla_hud";
const STYLE_ID = "__wgla_styles";

// ─── styles ────────────────────────────────────────────────────────
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

// ─── DOM helpers ──────────────────────────────────────────────────
function el(tag, styles, text) {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (text != null) e.textContent = text;
  return e;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function row(label, valueEl, onClick) {
  const r = el("div");
  r.className = "wgla-row" + (onClick ? " clickable" : "");
  r.appendChild(el("span", null, label));
  r.appendChild(valueEl);
  if (onClick) r.addEventListener("click", onClick);
  return r;
}
function tableHeader(cols, items) {
  const h = el("div"); h.className = "wgla-thead"; h.style.gridTemplateColumns = cols;
  for (const x of items) {
    const s = el("span");
    if (x.right) s.style.textAlign = "right";
    s.textContent = x.label;
    h.appendChild(s);
  }
  return h;
}
function tableRow(cols, onClick) {
  const r = el("div"); r.className = "wgla-trow"; r.style.gridTemplateColumns = cols;
  if (onClick) r.addEventListener("click", onClick);
  return r;
}
function section(text) {
  const e = el("div", null, text); e.className = "wgla-sect"; return e;
}
function emptyMsg(text) {
  return el("div", null, text); // caller sets className
}
function button(label, onClick) {
  const b = el("button", null, label); b.className = "wgla-btn";
  b.addEventListener("click", onClick); return b;
}

// ─── formatting ──────────────────────────────────────────────────
function fmtNum(n) {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n | 0);
}
function fmtBytes(n) {
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
    if (v.length > 4) return `[${v.slice(0, 4).map(s).join(", ")}, …(${v.length})]`;
    return `[${v.map(s).join(", ")}]`;
  }
  return s(v);
}
function contextLetter(i) { return String.fromCharCode(65 + i); }

// Single-character glyph for mesh kinds in the Scene tab.
const MESH_KIND_GLYPH = {
  mesh: "△", instancedMesh: "⧉", skinnedMesh: "¿",
  points: "·", line: "─", lineSegments: "⋮",
};

// ─── keyed-list diff ─────────────────────────────────────────────
// Renders + updates a list of rows keyed by stable identity. Existing rows
// have their values updated in place; new rows are built and appended; rows
// for items no longer in the set are removed. After each diff, rows are
// reordered in the DOM to match item order. Click targets survive updates.
function makeKeyedList(parent, opts) {
  if (opts.title)   parent.appendChild(section(opts.title));
  if (opts.headers) parent.appendChild(tableHeader(opts.cols, opts.headers));
  const container = el("div");
  const empty = el("div", null, opts.emptyText || "(none)"); empty.className = "wgla-empty";
  parent.appendChild(container);
  parent.appendChild(empty);

  const rowMap = new Map();

  function diff() {
    const items = opts.getItems() || [];
    empty.style.display = items.length ? "none" : "";
    const seen = new Set();
    for (const item of items) {
      const key = opts.getKey(item);
      seen.add(key);
      let entry = rowMap.get(key);
      if (!entry) {
        entry = opts.build(item);
        rowMap.set(key, entry);
        // ensure click handler reads latest item even on Frame-tab style key reuse
        if (entry.row && !entry.row.__wgla_clickbound && opts.onClick) {
          entry.row.addEventListener("click", () => opts.onClick(entry.item));
          entry.row.__wgla_clickbound = true;
        }
      }
      entry.item = item;
      opts.update(entry, item);
      container.appendChild(entry.row); // move into order
    }
    for (const [key, entry] of [...rowMap]) {
      if (!seen.has(key)) { entry.row.remove(); rowMap.delete(key); }
    }
  }
  return diff;
}

// ─── id resolution (with optional context narrowing) ─────────────
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
  for (const [, r] of analyzer.records) { if (r === rec) return i; i++; }
  return -1;
}

// ─── HUD main ──────────────────────────────────────────────────────
export function mountHUD(analyzers) {
  ensureStyles();
  const { webgl, webgpu, scenes } = analyzers;

  // unmount previous instance cleanly
  const existing = document.getElementById(HUD_ID);
  if (existing && existing.__wgla_unmount) existing.__wgla_unmount();
  else if (existing) existing.remove();

  const state = {
    tab: "live",
    detail: null,          // { side, kind, id, contextIdx }
    selected: null,        // { side, record } or null = All
    collapsed: false,
  };
  let currentController = null;   // { root, update? }
  let dropdownSig = "";

  // ─── Chrome (built once) ─────────────────────────────────────────
  const root = el("div", {
    position: "fixed", top: "12px", right: "12px", zIndex: "2147483647",
    width: "380px", maxHeight: "92vh",
    display: "flex", flexDirection: "column",
    background: "rgba(10,10,12,0.92)",
    border: "1px solid #2a2a2a", borderRadius: "6px",
    backdropFilter: "blur(8px)",
    boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
    userSelect: "none",
  });
  root.id = HUD_ID;

  // header
  const header = el("div", {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "6px 8px", borderBottom: "1px solid #222", cursor: "move",
  });
  const titleWrap = el("div");
  const title = el("span", { color: "#0bf", fontWeight: "bold" }, "gpu-probe");
  const badge = el("span", { color: "#666", marginLeft: "6px" }, "");
  titleWrap.append(title, badge);
  const collapseBtn = el("button", null, "▾"); collapseBtn.className = "wgla-iconbtn";
  const closeBtn    = el("button", null, "×"); closeBtn.className    = "wgla-iconbtn";
  const headerRight = el("div"); headerRight.append(collapseBtn, closeBtn);
  header.append(titleWrap, headerRight);

  // context selector
  const ctxBar = el("div", {
    display: "flex", alignItems: "center", gap: "6px",
    padding: "6px 8px", borderBottom: "1px solid #222",
  });
  ctxBar.appendChild(el("span", { color: "#888" }, "context:"));
  const ctxSelect = el("select"); ctxSelect.className = "wgla-select";
  ctxBar.appendChild(ctxSelect);

  // tabbar
  const tabbar = el("div", {
    display: "flex", background: "#0c0c0c", borderBottom: "1px solid #222",
  });
  const tabButtons = {};
  for (const t of [
    { key: "live",      label: "Live"      },
    { key: "frame",     label: "Frame"     },
    { key: "programs",  label: "Programs"  },
    { key: "resources", label: "Resources" },
    { key: "gpu",       label: "GPU"       },
    { key: "scene",     label: "Scene"     },
  ]) {
    const b = el("button", null, t.label); b.className = "wgla-tab";
    b.addEventListener("click", () => switchTab(t.key));
    tabButtons[t.key] = b;
    tabbar.appendChild(b);
  }

  // body
  const body = el("div", {
    padding: "6px 0", overflowY: "auto", flex: "1 1 auto", minHeight: "0",
  });

  // footer
  const footer = el("div", {
    display: "flex", gap: "4px", padding: "6px 8px",
    background: "#0c0c0c", borderTop: "1px solid #222",
  });
  footer.append(
    button("Scan",    () => { webgl?.scan?.(); rebuildDropdown(true); rerenderCurrent(); }),
    button("Report",  () => { webgl?.report?.(); if (webgpu?.records.size) webgpu.report(); }),
    button("JSON",    () => downloadCombined(webgl, webgpu)),
    button("Reset",   () => { webgl?.reset?.(); webgpu?.reset?.(); rerenderCurrent(); }),
  );

  root.append(header, ctxBar, tabbar, body, footer);
  document.body.appendChild(root);

  // header behaviors
  closeBtn.addEventListener("click", unmount);
  collapseBtn.addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    const dsp = state.collapsed ? "none" : "";
    ctxBar.style.display = dsp;
    tabbar.style.display = state.collapsed ? "none" : "flex";
    body.style.display   = dsp;
    footer.style.display = state.collapsed ? "none" : "flex";
    collapseBtn.textContent = state.collapsed ? "▸" : "▾";
  });
  enableDrag(root, header);
  ctxSelect.addEventListener("change", () => {
    const v = ctxSelect.value;
    const next = v === "" ? null : parseSelectKey(v, webgl, webgpu);
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
    const sig = makeDropdownSignature(webgl, webgpu);
    if (!force && sig === dropdownSig) return;
    dropdownSig = sig;
    const prev = ctxSelect.value;
    clear(ctxSelect);
    const optAll = document.createElement("option");
    optAll.value = ""; optAll.textContent = `All (${countContexts(webgl, webgpu)})`;
    ctxSelect.appendChild(optAll);
    if (webgl) {
      let i = 0;
      for (const [, r] of webgl.records) {
        const o = document.createElement("option");
        o.value = `webgl:${i}`;
        const c = r.canvas;
        const label = c?.id ? `#${c.id}` : c?.className ? `.${c.className.split(" ")[0]}` : `canvas[${i}]`;
        o.textContent = `${contextLetter(i)}·[gl] ${label}  ${c ? `${c.width}×${c.height}` : ""}`;
        ctxSelect.appendChild(o); i++;
      }
    }
    if (webgpu) {
      let i = 0;
      const offset = webgl ? webgl.records.size : 0;
      for (const [, r] of webgpu.records) {
        const o = document.createElement("option");
        o.value = `webgpu:${i}`;
        const c = r.canvas;
        o.textContent = `${contextLetter(offset + i)}·[gpu] ${c?.id ? `#${c.id}` : `dev[${i}]`}`;
        ctxSelect.appendChild(o); i++;
      }
    }
    if (state.selected) {
      const k = selectKeyFor(state.selected, webgl, webgpu);
      if (k) ctxSelect.value = k;
    } else if (prev && [...ctxSelect.options].some((o) => o.value === prev)) {
      ctxSelect.value = prev;
    }
  }

  function getActiveRecords(side) {
    const analyzer = side === "webgl" ? webgl : webgpu;
    if (!analyzer) return [];
    const all = [...analyzer.records.values()];
    if (state.selected && state.selected.side === side && all.includes(state.selected.record)) {
      return [state.selected.record];
    }
    if (state.selected && state.selected.side !== side) return [];
    return all;
  }
  function showPrefix(side) {
    const analyzer = side === "webgl" ? webgl : webgpu;
    if (!analyzer) return false;
    return state.selected == null && analyzer.records.size > 1;
  }
  function ctxIdxOf(side, rec) {
    const analyzer = side === "webgl" ? webgl : webgpu;
    return recordIndex(analyzer, rec);
  }
  function idLabel(side, id, ctxIdx) {
    return (showPrefix(side) ? `${contextLetter(ctxIdx)}·` : "") + (id || "?");
  }

  // ─── Tab switching ──────────────────────────────────────────────
  function switchTab(key) {
    state.tab = key;
    state.detail = null;
    for (const [k, b] of Object.entries(tabButtons)) b.classList.toggle("active", k === key);
    rerenderCurrent();
  }
  function rerenderCurrent() {
    clear(body);
    if (state.detail) currentController = buildDetailView(state.detail);
    else currentController = (
      state.tab === "live"      ? buildLiveTab() :
      state.tab === "frame"     ? buildFrameTab() :
      state.tab === "programs"  ? buildProgramsTab() :
      state.tab === "resources" ? buildResourcesTab() :
      state.tab === "gpu"       ? buildGPUTab() :
      state.tab === "scene"     ? buildSceneTab() : null
    );
    if (currentController) {
      body.appendChild(currentController.root);
      currentController.update?.();
    }
  }
  function openDetail(detail) { state.detail = detail; rerenderCurrent(); }

  // ─── LIVE TAB ───────────────────────────────────────────────────
  // Adapts to context type:
  //   - WebGL only  -> WebGL Frame/Inventory only.
  //   - WebGPU only -> WebGPU panels only (no empty WebGL widgets).
  //   - Both        -> WebGPU first (more interesting per-frame), then WebGL.
  function buildLiveTab() {
    const r = el("div");
    const refs = {};
    const hasGL  = !!(webgl  && webgl.records.size);
    const hasGPU = !!(webgpu && webgpu.records.size);

    // ── WebGPU panel ──────────────────────────────────────────
    let gpuBox = null;
    if (hasGPU) {
      r.appendChild(section("WebGPU · frame"));
      gpuBox = el("div");
      refs.gpuFps    = el("span", null, "—");
      refs.gpuMs     = el("span", null, "—");
      refs.gpuDraws  = el("span", null, "—");
      refs.gpuDisp   = el("span", null, "—");
      refs.gpuVerts  = el("span", null, "—");
      refs.gpuTris   = el("span", null, "—");
      refs.gpuWG     = el("span", null, "—");
      refs.gpuRP     = el("span", null, "—");
      refs.gpuCP     = el("span", null, "—");
      refs.gpuSubmits= el("span", null, "—");
      refs.gpuCopies = el("span", null, "—");
      refs.gpuWB     = el("span", null, "—");
      refs.gpuWT     = el("span", null, "—");
      gpuBox.append(
        row("fps",            refs.gpuFps),
        row("frame ms",       refs.gpuMs),
        row("draws/f",        refs.gpuDraws),
        row("dispatches/f",   refs.gpuDisp),
        row("vertices/f",     refs.gpuVerts),
        row("triangles/f",    refs.gpuTris),
        row("workgroups/f",   refs.gpuWG),
        row("renderPasses/f", refs.gpuRP),
        row("computePass/f",  refs.gpuCP),
        row("submits/f",      refs.gpuSubmits),
        row("copies/f",       refs.gpuCopies),
        row("writeBuffer/f",  refs.gpuWB),
        row("writeTexture/f", refs.gpuWT),
      );
      r.appendChild(gpuBox);

      r.appendChild(section("WebGPU · inventory"));
      const giBox = el("div");
      refs.gpuPipes = el("span", null, "—");
      refs.gpuComp  = el("span", null, "—");
      refs.gpuShads = el("span", null, "—");
      refs.gpuBGs   = el("span", null, "—");
      refs.gpuBGLs  = el("span", null, "—");
      refs.gpuBufs  = el("span", null, "—");
      refs.gpuTexs  = el("span", null, "—");
      refs.gpuSamps = el("span", null, "—");
      giBox.append(
        row("renderPipelines", refs.gpuPipes),
        row("computePipelines", refs.gpuComp),
        row("shaderModules",   refs.gpuShads),
        row("bindGroups",      refs.gpuBGs),
        row("bindGroupLayouts", refs.gpuBGLs),
        row("buffers",         refs.gpuBufs),
        row("textures",        refs.gpuTexs),
        row("samplers",        refs.gpuSamps),
      );
      r.appendChild(giBox);

      // Buffer kind breakdown — handy to spot leaks (e.g. a thousand uniforms)
      r.appendChild(section("WebGPU · buffers by kind"));
      const pillRow = el("div"); pillRow.className = "wgla-pillrow";
      refs.gpuBufPills = pillRow;
      r.appendChild(pillRow);

      // Validation/error preview — click to jump to GPU tab
      const warnHead = section("WebGPU · validation");
      r.appendChild(warnHead);
      refs.gpuWarnHead = warnHead;
      const warnList = el("div");
      refs.gpuWarnList = warnList;
      r.appendChild(warnList);
      const warnMore = el("div", { padding: "4px 6px" });
      const warnLink = el("span", null, "see all in GPU tab →");
      warnLink.className = "wgla-link";
      warnLink.addEventListener("click", () => switchTab("gpu"));
      warnMore.appendChild(warnLink);
      refs.gpuWarnMore = warnMore;
      r.appendChild(warnMore);
    }

    // ── WebGL panel ──────────────────────────────────────────
    let glFrameBox = null, glInvBox = null;
    if (hasGL) {
      r.appendChild(section("WebGL · frame"));
      glFrameBox = el("div");
      refs.fps   = el("span", null, "—");
      refs.ms    = el("span", null, "—");
      refs.draws = el("span", null, "—");
      refs.tris  = el("span", null, "—");
      refs.verts = el("span", null, "—");
      refs.lines = el("span", null, "—");
      refs.pts   = el("span", null, "—");
      glFrameBox.append(
        row("fps",      refs.fps),
        row("frame ms", refs.ms),
        row("draws/f",  refs.draws),
        row("tris/f",   refs.tris),
        row("verts/f",  refs.verts),
        row("lines/f",  refs.lines),
        row("points/f", refs.pts),
      );
      r.appendChild(glFrameBox);

      r.appendChild(section("WebGL · inventory"));
      glInvBox = el("div");
      refs.progs = el("span", null, "—");
      refs.shads = el("span", null, "—");
      refs.bufs  = el("span", null, "—");
      refs.texs  = el("span", null, "—");
      refs.fbs   = el("span", null, "—");
      refs.rbs   = el("span", null, "—");
      refs.vaos  = el("span", null, "—");
      glInvBox.append(
        row("programs",     refs.progs),
        row("shaders",      refs.shads),
        row("buffers",      refs.bufs),
        row("textures",     refs.texs),
        row("framebuffers", refs.fbs),
        row("renderbufs",   refs.rbs),
        row("vaos",         refs.vaos),
      );
      r.appendChild(glInvBox);
    }

    if (!hasGL && !hasGPU) {
      const e = el("div", null, "waiting for a graphics context…");
      e.className = "wgla-empty";
      r.appendChild(e);
    }

    function update() {
      if (glFrameBox) {
        const recs = getActiveRecords("webgl");
        let fps = 0, ms = 0, d = 0, t = 0, v = 0, ln = 0, pt = 0;
        let pr = 0, sh = 0, bf = 0, tx = 0, fb = 0, rb = 0, va = 0;
        for (const rec of recs) {
          fps = Math.max(fps, rec.frame.fps); ms = Math.max(ms, rec.frame.frameMs);
          d += rec.frame.drawCalls; t += rec.frame.triangles; v += rec.frame.vertices;
          ln += rec.frame.lines; pt += rec.frame.points;
          pr += rec.programs.size; sh += rec.shaders.size;
          bf += rec.buffers.size;  tx += rec.textures.size;
          fb += rec.framebuffers.size; rb += rec.renderbuffers.size; va += rec.vaos.size;
        }
        refs.fps.textContent = recs.length ? fps.toFixed(1) : "—";
        refs.fps.style.color = fps >= 55 ? "#3c3" : fps >= 30 ? "#fc3" : fps > 0 ? "#f55" : "#888";
        refs.ms.textContent    = recs.length ? ms.toFixed(2) : "—";
        refs.draws.textContent = fmtNum(d);
        refs.tris.textContent  = fmtNum(t);
        refs.verts.textContent = fmtNum(v);
        refs.lines.textContent = fmtNum(ln);
        refs.pts.textContent   = fmtNum(pt);
        refs.progs.textContent = String(pr);
        refs.shads.textContent = String(sh);
        refs.bufs.textContent  = String(bf);
        refs.texs.textContent  = String(tx);
        refs.fbs.textContent   = String(fb);
        refs.rbs.textContent   = String(rb);
        refs.vaos.textContent  = String(va);
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
          gfps = Math.max(gfps, rec.frame.fps); gms = Math.max(gms, rec.frame.frameMs);
          gd += rec.frame.drawCalls; gp += rec.frame.dispatchCalls;
          gv += rec.frame.vertices;  gtri += rec.frame.triangles; gwg += rec.frame.workgroups;
          grp += rec.frame.renderPasses; gcp += rec.frame.computePasses;
          gsub += rec.frame.submits; gcop += rec.frame.copies;
          gwb += rec.frame.writeBuffer; gwt += rec.frame.writeTexture;
          gpipes += rec.renderPipelines.size; gcomp += rec.computePipelines.size;
          gshads += rec.shaderModules.size;
          gbgs += rec.bindGroups.size; gbgls += rec.bindGroupLayouts.size;
          gbufs += rec.buffers.size;  gtex += rec.textures.size;  gsamp += rec.samplers.size;
          for (const [, info] of rec.buffers) {
            const flags = info.usageFlags || [];
            const k = flags.includes("VERTEX") ? "VERTEX"
                    : flags.includes("INDEX") ? "INDEX"
                    : flags.includes("UNIFORM") ? "UNIFORM"
                    : flags.includes("STORAGE") ? "STORAGE"
                    : flags.includes("INDIRECT") ? "INDIRECT" : "OTHER";
            kinds[k]++;
          }
          for (const w of (rec.warnings || [])) warnings.push(w);
        }
        refs.gpuFps.textContent = grecs.length ? gfps.toFixed(1) : "—";
        refs.gpuFps.style.color = gfps >= 55 ? "#3c3" : gfps >= 30 ? "#fc3" : gfps > 0 ? "#f55" : "#888";
        refs.gpuMs.textContent      = grecs.length ? gms.toFixed(2) : "—";
        refs.gpuDraws.textContent   = fmtNum(gd);
        refs.gpuDisp.textContent    = fmtNum(gp);
        refs.gpuVerts.textContent   = fmtNum(gv);
        refs.gpuTris.textContent    = fmtNum(gtri);
        refs.gpuWG.textContent      = fmtNum(gwg);
        refs.gpuRP.textContent      = fmtNum(grp);
        refs.gpuCP.textContent      = fmtNum(gcp);
        refs.gpuSubmits.textContent = fmtNum(gsub);
        refs.gpuCopies.textContent  = fmtNum(gcop);
        refs.gpuWB.textContent      = fmtNum(gwb);
        refs.gpuWT.textContent      = fmtNum(gwt);
        refs.gpuPipes.textContent   = String(gpipes);
        refs.gpuComp.textContent    = String(gcomp);
        refs.gpuShads.textContent   = String(gshads);
        refs.gpuBGs.textContent     = String(gbgs);
        refs.gpuBGLs.textContent    = String(gbgls);
        refs.gpuBufs.textContent    = String(gbufs);
        refs.gpuTexs.textContent    = String(gtex);
        refs.gpuSamps.textContent   = String(gsamp);
        // pills
        clear(refs.gpuBufPills);
        let pillTotal = 0;
        for (const k of ["VERTEX","INDEX","UNIFORM","STORAGE","INDIRECT","OTHER"]) {
          if (!kinds[k]) continue;
          pillTotal++;
          const p = el("span", null, `${k} ${kinds[k]}`); p.className = "wgla-pill gpu";
          refs.gpuBufPills.appendChild(p);
        }
        if (!pillTotal) {
          const p = el("span", null, "none"); p.className = "wgla-pill muted";
          refs.gpuBufPills.appendChild(p);
        }
        // warnings preview (top 3)
        clear(refs.gpuWarnList);
        const warnTotal = warnings.length;
        if (!warnTotal) {
          const ok = el("div", null, "no validation issues"); ok.className = "wgla-empty"; ok.style.color = "#3c3";
          refs.gpuWarnList.appendChild(ok);
          refs.gpuWarnMore.style.display = "none";
        } else {
          const head = warnings.slice(0, 3);
          for (const w of head) refs.gpuWarnList.appendChild(renderWarning(w));
          refs.gpuWarnMore.style.display = warnTotal > 3 ? "" : "none";
          refs.gpuWarnMore.firstChild.textContent = `+${warnTotal - 3} more · see GPU tab →`;
        }
      }
    }
    return { root: r, update };
  }

  // Renders a single warning item for the validation lists.
  function renderWarning(w) {
    const sev = w.severity === "error" ? "" : (w.severity || "info");
    const div = el("div"); div.className = "wgla-warn" + (sev ? " " + sev : "");
    const head = el("div");
    const kind = el("span", { color: "#fdd", fontWeight: "bold" }, w.kind || "warning");
    const meta = el("span"); meta.className = "meta";
    const src = w.source ? ` · ${w.source}` : "";
    meta.textContent = `${src}`;
    const count = el("span", null, w.count > 1 ? `×${w.count}` : "");
    count.className = "count";
    head.append(kind, meta, count);
    const msg = el("div", null, w.message || "");
    div.append(head, msg);
    return div;
  }

  // ─── FRAME TAB ─────────────────────────────────────────────────
  function buildFrameTab() {
    const r = el("div");
    const cols = "60px 1fr 50px 50px 32px";
    const refreshFns = [];
    const hasGL  = !!(webgl  && webgl.records.size);
    const hasGPU = !!(webgpu && webgpu.records.size);

    // WebGL draws (only when there's a WebGL context to talk about)
    if (hasGL) refreshFns.push(makeKeyedList(r, {
      title: "WebGL · draws this frame",
      cols,
      headers: [
        { label: "prog" }, { label: "method · mode" },
        { label: "prims", right: true }, { label: "verts", right: true }, { label: "inst", right: true },
      ],
      emptyText: "(no draws captured)",
      getItems: () => {
        const out = [];
        const recs = getActiveRecords("webgl");
        for (const rec of recs) {
          const ctxIdx = ctxIdxOf("webgl", rec);
          rec.frame.draws.forEach((d, i) => out.push({
            key: `${ctxIdx}:${i}:${d.programId || ""}:${d.method}:${d.mode || ""}`,
            ctxIdx, idx: i, ...d,
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
        const instSpan  = el("span", { textAlign: "right", color: "#888" });
        const rEl = tableRow(cols);
        rEl.append(idSpan, labelSpan, primsSpan, vertsSpan, instSpan);
        return { row: rEl, refs: { idSpan, labelSpan, primsSpan, vertsSpan, instSpan } };
      },
      update: (entry, it) => {
        entry.refs.idSpan.textContent = it.programId ? idLabel("webgl", it.programId, it.ctxIdx) : "—";
        entry.refs.labelSpan.textContent = `${it.method} · ${it.mode}`;
        entry.refs.primsSpan.textContent = fmtNum(it.primitives);
        entry.refs.vertsSpan.textContent = fmtNum(it.vertices);
        entry.refs.instSpan.textContent  = it.instances > 1 ? "×" + it.instances : "";
      },
      onClick: (it) => {
        if (it?.programId) openDetail({ side: "webgl", kind: "program", id: it.programId, contextIdx: it.ctxIdx });
      },
    }));

    // WebGPU draws + dispatches (only if any GPU device)
    if (hasGPU) {
      refreshFns.push(makeKeyedList(r, {
        title: "WebGPU · draws this frame",
        cols,
        headers: [
          { label: "pipe" }, { label: "method · topology" },
          { label: "prims", right: true }, { label: "verts", right: true }, { label: "inst", right: true },
        ],
        emptyText: "(no draws captured)",
        getItems: () => {
          const out = [];
          const recs = getActiveRecords("webgpu");
          for (const rec of recs) {
            const ctxIdx = ctxIdxOf("webgpu", rec);
            rec.frame.draws.forEach((d, i) => out.push({
              key: `${ctxIdx}:${i}:${d.pipelineId || ""}:${d.method}:${d.topology || ""}`,
              ctxIdx, idx: i, ...d,
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
          const instSpan  = el("span", { textAlign: "right", color: "#888" });
          const rEl = tableRow(cols);
          rEl.append(idSpan, labelSpan, primsSpan, vertsSpan, instSpan);
          return { row: rEl, refs: { idSpan, labelSpan, primsSpan, vertsSpan, instSpan } };
        },
        update: (entry, it) => {
          entry.refs.idSpan.textContent = it.pipelineId ? idLabel("webgpu", it.pipelineId, it.ctxIdx) : "—";
          entry.refs.labelSpan.textContent = `${it.method} · ${it.topology}`;
          entry.refs.primsSpan.textContent = fmtNum(it.primitives);
          entry.refs.vertsSpan.textContent = fmtNum(it.vertices);
          entry.refs.instSpan.textContent  = it.instances > 1 ? "×" + it.instances : "";
        },
        onClick: (it) => {
          if (it?.pipelineId) openDetail({ side: "webgpu", kind: "renderPipeline", id: it.pipelineId, contextIdx: it.ctxIdx });
        },
      }));

      refreshFns.push(makeKeyedList(r, {
        title: "WebGPU · dispatches this frame",
        cols: "60px 1fr 60px",
        headers: [
          { label: "pipe" }, { label: "dispatch (x,y,z)" }, { label: "wgrps", right: true },
        ],
        emptyText: "(no dispatches captured)",
        getItems: () => {
          const out = [];
          const recs = getActiveRecords("webgpu");
          for (const rec of recs) {
            const ctxIdx = ctxIdxOf("webgpu", rec);
            rec.frame.dispatches.forEach((d, i) => out.push({
              key: `${ctxIdx}:${i}:${d.pipelineId || ""}:${d.method}`,
              ctxIdx, idx: i, ...d,
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
          entry.refs.idSpan.textContent = it.pipelineId ? idLabel("webgpu", it.pipelineId, it.ctxIdx) : "—";
          entry.refs.xyzSpan.textContent = `${it.x},${it.y},${it.z}`;
          entry.refs.wgSpan.textContent  = fmtNum(it.workgroups);
        },
        onClick: (it) => {
          if (it?.pipelineId) openDetail({ side: "webgpu", kind: "computePipeline", id: it.pipelineId, contextIdx: it.ctxIdx });
        },
      }));

      // Per-pass breakdown — the actual structure of each frame.
      // Render-pass rows show resolved color attachments (texture id, format,
      // ✸ = clear loadOp). Compute passes show their dispatch count.
      refreshFns.push(makeKeyedList(r, {
        title: "WebGPU · passes this frame",
        cols: "42px 1fr 50px 50px",
        headers: [
          { label: "kind" }, { label: "attachments / label" },
          { label: "draws", right: true }, { label: "disp", right: true },
        ],
        emptyText: "(no passes captured)",
        getItems: () => {
          const out = [];
          const recs = getActiveRecords("webgpu");
          for (const rec of recs) {
            const ctxIdx = ctxIdxOf("webgpu", rec);
            (rec.frame.passes || []).forEach((p, i) => out.push({
              key: `${ctxIdx}:${i}:${p.kind}`,
              ctxIdx, idx: i, ...p,
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
              const ref = a.textureId ? a.textureId : (a.isCanvas ? "canvas" : "?");
              return `${ref}${a.format ? `:${a.format}` : ""}${a.loadOp === "clear" ? "\u2738" : ""}`;
            });
            desc = `[${parts.join(", ")}]${it.label ? "  " + it.label : ""}`;
            if (it.depth) desc += ` +depth(${it.depth.format || "?"})`;
          }
          e.refs.lblSpan.textContent = desc || "(unlabeled)";
          e.refs.dSpan.textContent = fmtNum(it.draws);
          e.refs.cSpan.textContent = fmtNum(it.dispatches);
        },
      }));
    }

    function update() { for (const f of refreshFns) f(); }
    return { root: r, update };
  }

  // ─── PROGRAMS TAB ─────────────────────────────────────────────
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
        { label: "id" }, { label: "status" },
        { label: "draws/f", right: true }, { label: "Σ draws", right: true },
      ],
      emptyText: "(no programs)",
      getItems: () => {
        const out = [];
        const recs = getActiveRecords("webgl");
        for (const rec of recs) {
          const ctxIdx = ctxIdxOf("webgl", rec);
          const dpf = new Map();
          for (const d of rec.frame.draws) if (d.programId) dpf.set(d.programId, (dpf.get(d.programId) || 0) + 1);
          for (const p of rec.programs) {
            const id = rec.ids.get(p);
            out.push({
              key: `${ctxIdx}:${id}`,
              ctxIdx, id,
              isCurrent: rec.currentProgram === p,
              linked: !!rec.gl.getProgramParameter(p, rec.gl.LINK_STATUS),
              drawsF: dpf.get(id) || 0,
              totalDraws: rec.drawCalls.get(p) || 0,
            });
          }
        }
        return out;
      },
      getKey: (it) => it.key,
      build: () => {
        const idSpan     = el("span", { color: "#0bf" });
        const statusSpan = el("span");
        const dpfSpan    = el("span", { textAlign: "right" });
        const totSpan    = el("span", { textAlign: "right", color: "#888" });
        const rEl = tableRow(cols);
        rEl.append(idSpan, statusSpan, dpfSpan, totSpan);
        return { row: rEl, refs: { idSpan, statusSpan, dpfSpan, totSpan } };
      },
      update: (entry, it) => {
        entry.refs.idSpan.textContent     = idLabel("webgl", it.id, it.ctxIdx);
        entry.refs.statusSpan.textContent = `${it.isCurrent ? "● " : "○ "}${it.linked ? "linked" : "unlinked"}`;
        entry.refs.dpfSpan.textContent    = fmtNum(it.drawsF);
        entry.refs.totSpan.textContent    = fmtNum(it.totalDraws);
      },
      onClick: (it) => openDetail({ side: "webgl", kind: "program", id: it.id, contextIdx: it.ctxIdx }),
    });
    return { root: r, update: refresh };
  }

  // ─── RESOURCES TAB ────────────────────────────────────────────
  function buildResourcesTab() {
    const r = el("div");
    if (!getActiveRecords("webgl").length) {
      r.appendChild(noContextMsg("WebGL"));
      return { root: r };
    }
    const refreshFns = [];

    // Buffers
    refreshFns.push(makeKeyedList(r, {
      title: "Buffers",
      cols: "60px 1fr 60px 80px",
      headers: [
        { label: "id" }, { label: "target" },
        { label: "size", right: true }, { label: "usage", right: true },
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
        e.refs.idSpan.textContent    = idLabel("webgl", it.id, it.ctxIdx);
        e.refs.tgtSpan.textContent   = it.target || "UNKNOWN";
        e.refs.sizeSpan.textContent  = fmtBytes(it.size || 0);
        e.refs.usageSpan.textContent = it.usage || "";
      },
      onClick: (it) => openDetail({ side: "webgl", kind: "buffer", id: it.id, contextIdx: it.ctxIdx }),
    }));

    // Textures
    refreshFns.push(makeKeyedList(r, {
      title: "Textures",
      cols: "60px 1fr 80px 80px",
      headers: [
        { label: "id" }, { label: "target" },
        { label: "size", right: true }, { label: "format", right: true },
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
        e.refs.idSpan.textContent  = idLabel("webgl", it.id, it.ctxIdx);
        e.refs.tgtSpan.textContent = it.target || "?";
        e.refs.sizeSpan.textContent = it.depth > 1 ? `${it.width}×${it.height}×${it.depth}` : `${it.width}×${it.height}`;
        e.refs.fmtSpan.textContent  = it.internalFormat || "";
      },
      onClick: (it) => openDetail({ side: "webgl", kind: "texture", id: it.id, contextIdx: it.ctxIdx }),
    }));

    // Framebuffers
    refreshFns.push(makeKeyedList(r, {
      title: "Framebuffers",
      cols: "60px 1fr",
      headers: [{ label: "id" }, { label: "attachments" }],
      emptyText: "(none)",
      getItems: () => {
        const out = [];
        for (const rec of getActiveRecords("webgl")) {
          const ctxIdx = ctxIdxOf("webgl", rec);
          for (const [f, info] of rec.framebuffers) {
            const id = rec.ids.get(f);
            out.push({ key: `${ctxIdx}:${id}`, ctxIdx, id,
              attachments: Object.keys(info.attachments || {}).join(", ") || "(none)" });
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
        e.refs.idSpan.textContent  = idLabel("webgl", it.id, it.ctxIdx);
        e.refs.attSpan.textContent = it.attachments;
      },
      onClick: (it) => openDetail({ side: "webgl", kind: "framebuffer", id: it.id, contextIdx: it.ctxIdx }),
    }));

    // Renderbuffers
    refreshFns.push(makeKeyedList(r, {
      title: "Renderbuffers",
      cols: "60px 1fr 80px 50px",
      headers: [
        { label: "id" }, { label: "format" },
        { label: "size", right: true }, { label: "samples", right: true },
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
        e.refs.idSpan.textContent   = idLabel("webgl", it.id, it.ctxIdx);
        e.refs.fmtSpan.textContent  = it.internalFormat || "?";
        e.refs.sizeSpan.textContent = `${it.width}×${it.height}`;
        e.refs.sampSpan.textContent = String(it.samples || 0);
      },
      onClick: (it) => openDetail({ side: "webgl", kind: "renderbuffer", id: it.id, contextIdx: it.ctxIdx }),
    }));

    function update() { for (const f of refreshFns) f(); }
    return { root: r, update };
  }

  // ─── GPU TAB ────────────────────────────────────────────────────
  function buildGPUTab() {
    const r = el("div");
    if (!getActiveRecords("webgpu").length) {
      r.appendChild(noContextMsg("WebGPU"));
      return { root: r };
    }
    const refreshFns = [];

    // Validation — most useful surface for WebGPU debugging. Lives at the
    // top of the tab so errors are unmissable.
    r.appendChild(section("Validation"));
    const warnHost = el("div");
    r.appendChild(warnHost);
    const warnEmpty = el("div", null, "no validation issues");
    warnEmpty.className = "wgla-empty"; warnEmpty.style.color = "#3c3";
    r.appendChild(warnEmpty);
    let lastWarnSig = "";
    refreshFns.push(() => {
      const warnings = [];
      for (const rec of getActiveRecords("webgpu")) {
        for (const w of (rec.warnings || [])) warnings.push(w);
      }
      const sig = warnings.map((w) => `${w.kind}|${w.message}|${w.count}`).join("\n");
      if (sig === lastWarnSig) return;
      lastWarnSig = sig;
      clear(warnHost);
      warnEmpty.style.display = warnings.length ? "none" : "";
      for (const w of warnings) warnHost.appendChild(renderWarning(w));
    });

    // Per-device stats — one row per device, keyed
    refreshFns.push(makeKeyedList(r, {
      title: "Devices · live stats",
      cols: "60px 1fr 50px 50px 50px",
      headers: [
        { label: "id" }, { label: "vendor / passes" },
        { label: "draws", right: true }, { label: "disp", right: true }, { label: "submits", right: true },
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
            vendor: rec.adapterInfo?.vendor || "—",
            renderPasses: rec.frame.renderPasses,
            computePasses: rec.frame.computePasses,
            draws: rec.frame.drawCalls,
            disp: rec.frame.dispatchCalls,
            submits: rec.frame.submits,
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
        e.refs.drawsSpan.textContent = fmtNum(it.draws);
        e.refs.dispSpan.textContent = fmtNum(it.disp);
        e.refs.subSpan.textContent = fmtNum(it.submits);
      },
    }));

    // Render pipelines  —  with per-pipeline draw counters
    refreshFns.push(makeKeyedList(r, {
      title: "Render Pipelines",
      cols: "60px 1fr 50px 50px",
      headers: [
        { label: "id" }, { label: "topology · label" },
        { label: "draws/f", right: true }, { label: "Σ draws", right: true },
      ],
      emptyText: "(none)",
      getItems: () => {
        const out = [];
        for (const rec of getActiveRecords("webgpu")) {
          const ctxIdx = ctxIdxOf("webgpu", rec);
          for (const [p, info] of rec.renderPipelines) {
            const id = rec.ids.get(p);
            out.push({
              key: `${ctxIdx}:${id}`, ctxIdx, id,
              topology: info.topology, label: info.label,
              drawsF: info._drawsF || 0,
              totalDraws: info._totalDraws || 0,
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
        e.refs.dpfSpan.textContent = fmtNum(it.drawsF);
        e.refs.totSpan.textContent = fmtNum(it.totalDraws);
      },
      onClick: (it) => openDetail({ side: "webgpu", kind: "renderPipeline", id: it.id, contextIdx: it.ctxIdx }),
    }));

    // Compute pipelines  —  dispatches and workgroups per frame
    refreshFns.push(makeKeyedList(r, {
      title: "Compute Pipelines",
      cols: "60px 1fr 50px 60px",
      headers: [
        { label: "id" }, { label: "label" },
        { label: "disp/f", right: true }, { label: "wgrps/f", right: true },
      ],
      emptyText: "(none)",
      getItems: () => {
        const out = [];
        for (const rec of getActiveRecords("webgpu")) {
          const ctxIdx = ctxIdxOf("webgpu", rec);
          for (const [p, info] of rec.computePipelines) {
            const id = rec.ids.get(p);
            out.push({
              key: `${ctxIdx}:${id}`, ctxIdx, id, label: info.label,
              dispatchesF: info._dispatchesF || 0,
              wgF: info._wgF || 0,
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
        const wgSpan  = el("span", { textAlign: "right", color: "#888" });
        const rEl = tableRow("60px 1fr 50px 60px");
        rEl.append(idSpan, lblSpan, dpfSpan, wgSpan);
        return { row: rEl, refs: { idSpan, lblSpan, dpfSpan, wgSpan } };
      },
      update: (e, it) => {
        e.refs.idSpan.textContent = idLabel("webgpu", it.id, it.ctxIdx);
        e.refs.lblSpan.textContent = it.label || "";
        e.refs.dpfSpan.textContent = fmtNum(it.dispatchesF);
        e.refs.wgSpan.textContent  = fmtNum(it.wgF);
      },
      onClick: (it) => openDetail({ side: "webgpu", kind: "computePipeline", id: it.id, contextIdx: it.ctxIdx }),
    }));

    // Bind groups — jumping-off point for inspecting the binding model.
    // Most validation errors come from a bind group not matching its layout,
    // so making them browsable matters more here than it does in WebGL.
    refreshFns.push(makeKeyedList(r, {
      title: "Bind Groups",
      cols: "60px 1fr 40px",
      headers: [{ label: "id" }, { label: "layout · label" }, { label: "#ent", right: true }],
      emptyText: "(none)",
      getItems: () => {
        const out = [];
        for (const rec of getActiveRecords("webgpu")) {
          const ctxIdx = ctxIdxOf("webgpu", rec);
          for (const [g, info] of rec.bindGroups) {
            const id = rec.ids.get(g);
            out.push({
              key: `${ctxIdx}:${id}`, ctxIdx, id,
              label: info.label, layoutId: info.layoutId,
              entryCount: (info.entries || []).length,
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
        const lay = it.layoutId ? `→ ${it.layoutId}` : "→ (auto)";
        e.refs.lblSpan.textContent = `${lay}${it.label ? "  " + it.label : ""}`;
        e.refs.cntSpan.textContent = String(it.entryCount);
      },
      onClick: (it) => openDetail({ side: "webgpu", kind: "bindGroup", id: it.id, contextIdx: it.ctxIdx }),
    }));

    // Buffers
    refreshFns.push(makeKeyedList(r, {
      title: "Buffers",
      cols: "60px 1fr 60px 60px",
      headers: [
        { label: "id" }, { label: "label · usage" },
        { label: "size", right: true }, { label: "kind", right: true },
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
        e.refs.sizeSpan.textContent = fmtBytes(it.size);
        const kind = (it.usageFlags || []).find((f) => ["VERTEX","INDEX","UNIFORM","STORAGE","INDIRECT"].includes(f)) || "OTHER";
        e.refs.kindSpan.textContent = kind;
      },
      onClick: (it) => openDetail({ side: "webgpu", kind: "gpuBuffer", id: it.id, contextIdx: it.ctxIdx }),
    }));

    // GPU Textures
    refreshFns.push(makeKeyedList(r, {
      title: "Textures",
      cols: "60px 1fr 80px 40px",
      headers: [
        { label: "id" }, { label: "label · format" },
        { label: "size", right: true }, { label: "mips", right: true },
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
        e.refs.sizeSpan.textContent = it.depthOrArrayLayers > 1
          ? `${it.width}×${it.height}×${it.depthOrArrayLayers}`
          : `${it.width}×${it.height}`;
        e.refs.mipSpan.textContent = String(it.mipLevelCount);
      },
      onClick: (it) => openDetail({ side: "webgpu", kind: "gpuTexture", id: it.id, contextIdx: it.ctxIdx }),
    }));

    // Shader modules
    refreshFns.push(makeKeyedList(r, {
      title: "Shader Modules",
      cols: "60px 1fr 60px",
      headers: [
        { label: "id" }, { label: "label" }, { label: "chars", right: true },
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
        e.refs.lenSpan.textContent = fmtNum(it.sourceLength);
      },
      onClick: (it) => openDetail({ side: "webgpu", kind: "shaderModule", id: it.id, contextIdx: it.ctxIdx }),
    }));

    function update() { for (const f of refreshFns) f(); }
    return { root: r, update };
  }

  // ─── SCENE TAB (Three.js) ────────────────────────────
  // Backend-agnostic. Walks each attached Three.js scene per frame and shows
  // mesh/geometry/material/texture rollups. Useful for analyzing a GLB load:
  // total triangle/vertex counts, instancing breakdown, texture inventory
  // (with sizes), and per-mesh draw-call estimates.
  function buildSceneTab() {
    const r = el("div");
    if (!scenes || !scenes.scenes.length) {
      const e = el("div", null, "no scene attached  —  call GPUProbe.attachScene(scene)");
      e.className = "wgla-empty"; r.appendChild(e);
      return { root: r };
    }

    // Per-scene block (the common case is one scene).
    const blocks = scenes.scenes.map((entry, sceneIdx) => {
      const block = el("div");
      block.appendChild(section(`Scene · ${entry.label}`));
      const refs = {
        meshes:    el("span", null, "—"),
        instMesh:  el("span", null, "—"),
        instTotal: el("span", null, "—"),
        verts:     el("span", null, "—"),
        tris:      el("span", null, "—"),
        geos:      el("span", null, "—"),
        mats:      el("span", null, "—"),
        texs:      el("span", null, "—"),
        lights:    el("span", null, "—"),
        cameras:   el("span", null, "—"),
        nodes:     el("span", null, "—"),
        drawEst:   el("span", null, "—"),
      };
      const stats = el("div");
      stats.append(
        row("nodes",            refs.nodes),
        row("meshes",           refs.meshes),
        row("instancedMeshes",  refs.instMesh),
        row("Σ instances",       refs.instTotal),
        row("Σ vertices",        refs.verts),
        row("Σ triangles",       refs.tris),
        row("unique geometries", refs.geos),
        row("unique materials",  refs.mats),
        row("unique textures",   refs.texs),
        row("lights",            refs.lights),
        row("cameras",           refs.cameras),
        row("draw calls (est.)", refs.drawEst),
      );
      block.appendChild(stats);

      // Models sub-section — each registered model (gltf.scene, etc.) gets
      // its own clickable row. Click opens a per-model detail view with its
      // own meshes and textures.
      const modelList = makeKeyedList(block, {
        title: "Models",
        cols: "32px 1fr 40px 50px 50px",
        headers: [
          { label: "kind" }, { label: "label / source" },
          { label: "meshes", right: true }, { label: "verts", right: true },
          { label: "tris", right: true },
        ],
        emptyText: "(no models attached)",
        getItems: () => (block.__lastSnap?.models || []).map((m, i) => ({
          key: `mdl:${i}:${m.label}`, idx: i, ...m,
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
          const sub = it.source ? `  · ${it.source.split("/").pop()}` : "";
          e.refs.n.textContent = `${it.label}${sub}`;
          e.refs.m.textContent = String(it.meshes);
          e.refs.v.textContent = fmtNum(it.vertices);
          e.refs.t.textContent = fmtNum(it.triangles);
          e.row.style.opacity = it.visible ? "1" : "0.5";
        },
        onClick: (it) => openDetail({ side: "scene", kind: "model", sceneIdx, modelIdx: it.idx }),
      });

      // Per-mesh table — only renderables NOT belonging to any registered
      // model, so this becomes the "procedural primitives" list.
      const meshList = makeKeyedList(block, {
        title: "Scene primitives",
        cols: "22px 1fr 50px 50px 40px",
        headers: [
          { label: "k" }, { label: "name" },
          { label: "verts", right: true }, { label: "tris", right: true },
          { label: "inst", right: true },
        ],
        emptyText: "(no primitives — all renderables belong to a model)",
        getItems: () => (block.__lastSnap?.meshes || [])
          .filter((m) => m.modelIndex < 0)
          .map((m, i) => ({
            key: `m:${i}:${m.geometryUuid || m.name}`,
            ...m, idx: i,
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
          e.refs.v.textContent = fmtNum(it.vertices);
          e.refs.t.textContent = fmtNum(it.triangles);
          e.refs.i.textContent = it.isInstanced ? "×" + it.instanceCount : "";
          e.row.style.opacity = it.visible ? "1" : "0.5";
        },
      });

      // Texture table
      const texList = makeKeyedList(block, {
        title: "Textures (in scene)",
        cols: "1fr 70px 60px 30px",
        headers: [
          { label: "name / slot" }, { label: "size", right: true },
          { label: "format", right: true }, { label: "refs", right: true },
        ],
        emptyText: "(no textures)",
        getItems: () => block.__lastSnap?.textures.map((t, i) => ({
          key: `tx:${i}:${t.name || ""}:${t.width}x${t.height}`,
          idx: i, ...t,
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
          e.refs.n.textContent = `${it.name || "(unnamed)"}  · ${slot}`;
          e.refs.s.textContent = it.width && it.height ? `${it.width}×${it.height}` : "—";
          e.refs.f.textContent = it.isCompressed ? "compressed" : (it.format != null ? String(it.format) : "—");
          e.refs.c.textContent = String(it.count);
        },
      });

      block.__refresh = () => {
        const snap = snapshotScene(entry.scene, scenes.models);
        block.__lastSnap = snap;
        let instMeshes = 0;
        for (const m of snap.meshes) if (m.isInstanced) instMeshes++;
        refs.nodes.textContent     = String(snap.nodeCount);
        refs.meshes.textContent    = String(snap.meshes.length);
        refs.instMesh.textContent  = String(instMeshes);
        refs.instTotal.textContent = fmtNum(snap.totalInstances);
        refs.verts.textContent     = fmtNum(snap.totalVerts);
        refs.tris.textContent      = fmtNum(snap.totalTris);
        refs.geos.textContent      = String(snap.uniqueGeometries);
        refs.mats.textContent      = String(snap.uniqueMaterials);
        refs.texs.textContent      = String(snap.uniqueTextures);
        refs.lights.textContent    = String(snap.lights.length);
        refs.cameras.textContent   = String(snap.cameras.length);
        refs.drawEst.textContent   = String(snap.drawCallEstimate);
        modelList();
        meshList();
        texList();
      };
      r.appendChild(block);
      return block;
    });

    function update() { for (const b of blocks) b.__refresh(); }
    return { root: r, update };
  }

  // ─── DETAIL VIEW ─────────────────────────────
  function buildDetailView(d) {
    const r = el("div");
    const back = button("← back", () => { state.detail = null; rerenderCurrent(); });
    back.style.margin = "4px 6px 8px";
    r.appendChild(back);
    if (d.side === "webgl")  return buildWebGLDetail(d, r);
    if (d.side === "webgpu") return buildWebGPUDetail(d, r);
    if (d.side === "scene")  return buildSceneDetail(d, r);
    return { root: r };
  }

  // ─── SCENE DETAIL VIEW ───────────────────────────────────
  // The scene tracker doesn't use stable IDs across frames, so detail views
  // resolve their target by index into the live snapshot they came from.
  function buildSceneDetail(d, r) {
    if (d.kind === "model") {
      const entry = scenes.scenes[d.sceneIdx];
      const modelMeta = scenes.models[d.modelIdx];
      if (!entry || !modelMeta) {
        r.appendChild(noContextMsg("(model not found)")); return { root: r };
      }
      r.appendChild(section(`Model · ${modelMeta.label}`));
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
        visible: el("span"),
      };
      r.append(
        row("kind",          refs.kind),
        row("source",        refs.source),
        row("root",          refs.rootName),
        row("visible",       refs.visible),
        row("nodes",         refs.nodes),
        row("meshes",        refs.meshes),
        row("Σ instances",    refs.instances),
        row("Σ vertices",     refs.verts),
        row("Σ triangles",    refs.tris),
        row("unique geos",   refs.geos),
        row("unique mats",   refs.mats),
        row("unique tex",    refs.texs),
      );

      const meshList = makeKeyedList(r, {
        title: "Meshes (this model)",
        cols: "22px 1fr 50px 50px 40px",
        headers: [
          { label: "k" }, { label: "name" },
          { label: "verts", right: true }, { label: "tris", right: true },
          { label: "inst", right: true },
        ],
        emptyText: "(no meshes)",
        getItems: () => (r.__lastModel?.meshList || []).map((m, i) => ({
          key: `m:${i}:${m.geometryUuid || m.name}`,
          ...m, idx: i,
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
          e.refs.v.textContent = fmtNum(it.vertices);
          e.refs.t.textContent = fmtNum(it.triangles);
          e.refs.i.textContent = it.isInstanced ? "×" + it.instanceCount : "";
          e.row.style.opacity = it.visible ? "1" : "0.5";
        },
      });

      const texList = makeKeyedList(r, {
        title: "Textures (this model)",
        cols: "1fr 70px 60px 30px",
        headers: [
          { label: "name / slot" }, { label: "size", right: true },
          { label: "format", right: true }, { label: "refs", right: true },
        ],
        emptyText: "(no textures)",
        getItems: () => (r.__lastModel?.textures || []).map((t, i) => ({
          key: `tx:${i}:${t.name || ""}:${t.width}x${t.height}`,
          idx: i, ...t,
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
          e.refs.n.textContent = `${it.name || "(unnamed)"}  · ${slot}`;
          e.refs.s.textContent = it.width && it.height ? `${it.width}×${it.height}` : "—";
          e.refs.f.textContent = it.isCompressed ? "compressed" : (it.format != null ? String(it.format) : "—");
          e.refs.c.textContent = String(it.count);
        },
      });

      function update() {
        const snap = snapshotScene(entry.scene, scenes.models);
        const ms = snap.models[d.modelIdx];
        if (!ms) return;
        r.__lastModel = ms;
        refs.kind.textContent      = ms.kind;
        refs.source.textContent    = ms.source || "—";
        refs.rootName.textContent  = ms.rootName || "(unnamed root)";
        refs.visible.textContent   = ms.visible ? "yes" : "no";
        refs.nodes.textContent     = String(ms.nodes);
        refs.meshes.textContent    = String(ms.meshes);
        refs.instances.textContent = fmtNum(ms.instances);
        refs.verts.textContent     = fmtNum(ms.vertices);
        refs.tris.textContent      = fmtNum(ms.triangles);
        refs.geos.textContent      = String(ms.uniqueGeometries);
        refs.mats.textContent      = String(ms.uniqueMaterials);
        refs.texs.textContent      = String(ms.uniqueTextures);
        meshList(); texList();
      }
      return { root: r, update };
    }
    return { root: r };
  }

  function buildWebGLDetail(d, r) {
    const hit = findInWebGL(webgl, d.id, d.contextIdx);
    if (!hit) { r.appendChild(noContextMsg("(not found)")); return { root: r }; }
    const rec = hit.record, resource = hit.resource;
    const ctxBadge = showPrefix("webgl")
      ? el("span", { color: "#888", marginLeft: "6px", fontSize: "10px" }, `context ${contextLetter(hit.ctxIdx)}`)
      : null;

    if (d.kind === "program") {
      const head = el("div"); head.appendChild(section(`Program ${d.id}`));
      if (ctxBadge) head.firstChild.appendChild(ctxBadge);
      r.appendChild(head);
      const metaBox = el("div"); r.appendChild(metaBox);
      const refs = {
        active: el("span"), linked: el("span"), validated: el("span"),
        draws: el("span"),  uses: el("span"),
      };
      metaBox.append(
        row("active",       refs.active),
        row("linked",       refs.linked),
        row("validated",    refs.validated),
        row("Σ draws",      refs.draws),
        row("Σ useProgram", refs.uses),
      );

      const info0 = extractProgram(rec.gl, resource, { id: d.id });
      if (info0.infoLog) {
        r.appendChild(section("infoLog"));
        const log = el("pre", null, info0.infoLog); log.className = "wgla-pre"; r.appendChild(log);
      }
      if (info0.attribs.length) {
        r.appendChild(section(`Attributes (${info0.attribs.length})`));
        for (const a of info0.attribs) {
          r.appendChild(row(a.name, el("span", { color: "#888" }, `${a.type} @${a.location}`)));
        }
      }
      const uniformRefs = [];
      if (info0.uniforms.length) {
        r.appendChild(section(`Uniforms (${info0.uniforms.length})  ·  live`));
        for (const u of info0.uniforms) {
          const typeSpan = el("span", { color: "#666" }, `${u.type} = `);
          const valSpan  = el("span", { color: "#cde" }, "—");
          uniformRefs.push({ name: u.name, valSpan });
          const wrap = el("span"); wrap.append(typeSpan, valSpan);
          r.appendChild(row(`${u.name}${u.size > 1 ? `[${u.size}]` : ""}`, wrap));
        }
      }
      for (const sh of info0.shaders) {
        r.appendChild(section(`${sh.type}  ${sh.compiled ? "✓" : "✗"}  (${sh.sourceLength} chars)`));
        if (sh.infoLog) {
          const log = el("pre", null, sh.infoLog); log.className = "wgla-pre"; r.appendChild(log);
        }
        const pre = el("pre", null, sh.source); pre.className = "wgla-pre"; r.appendChild(pre);
      }

      function update() {
        const info = extractProgram(rec.gl, resource, {
          id: d.id,
          drawCalls: rec.drawCalls.get(resource) || 0,
          useProgramCount: rec.useProgramCount.get(resource) || 0,
        });
        refs.active.textContent    = info.active ? "yes" : "no";
        refs.linked.textContent    = info.linked ? "yes" : "no";
        refs.validated.textContent = info.validated ? "yes" : "no";
        refs.draws.textContent     = fmtNum(info.drawCalls);
        refs.uses.textContent      = fmtNum(info.useProgramCount);
        for (let i = 0; i < info.uniforms.length; i++) {
          if (!uniformRefs[i]) break;
          uniformRefs[i].valSpan.textContent = fmtUniform(info.uniforms[i].value);
        }
      }
      return { root: r, update };
    }

    if (d.kind === "buffer") {
      const info = rec.buffers.get(resource); if (!info) return { root: r };
      r.appendChild(section(`Buffer ${d.id}`));
      r.append(
        row("target", el("span", null, info.target || "UNKNOWN")),
        row("size",   el("span", null, fmtBytes(info.size))),
        row("usage",  el("span", null, info.usage || "?")),
      );
      return { root: r };
    }
    if (d.kind === "texture") {
      const info = rec.textures.get(resource); if (!info) return { root: r };
      r.appendChild(section(`Texture ${d.id}`));
      const sz = info.depth > 1 ? `${info.width}×${info.height}×${info.depth}` : `${info.width}×${info.height}`;
      r.append(
        row("target",         el("span", null, info.target || "?")),
        row("size",           el("span", null, sz)),
        row("internalFormat", el("span", null, info.internalFormat || "?")),
        row("format",         el("span", null, info.format || "?")),
        row("type",           el("span", null, info.type || "?")),
        row("mipmap",         el("span", null, info.mipmap ? "yes" : "no")),
      );
      return { root: r };
    }
    if (d.kind === "framebuffer") {
      const info = rec.framebuffers.get(resource); if (!info) return { root: r };
      r.appendChild(section(`Framebuffer ${d.id}`));
      for (const [name, a] of Object.entries(info.attachments || {})) {
        const refId = a.texture ? rec.ids.get(a.texture)
                    : a.renderbuffer ? rec.ids.get(a.renderbuffer)
                    : null;
        const link = el("span", null, `${a.kind} → ${refId || "?"}${a.level != null ? " L" + a.level : ""}`);
        if (refId) link.className = "wgla-link";
        if (refId) link.addEventListener("click", () => {
          openDetail({ side: "webgl", kind: a.texture ? "texture" : "renderbuffer",
                       id: refId, contextIdx: hit.ctxIdx });
        });
        r.appendChild(row(name, link));
      }
      return { root: r };
    }
    if (d.kind === "renderbuffer") {
      const info = rec.renderbuffers.get(resource); if (!info) return { root: r };
      r.appendChild(section(`Renderbuffer ${d.id}`));
      r.append(
        row("internalFormat", el("span", null, info.internalFormat || "?")),
        row("size",           el("span", null, `${info.width}×${info.height}`)),
        row("samples",        el("span", null, String(info.samples || 0))),
      );
      return { root: r };
    }
    return { root: r };
  }

  function buildWebGPUDetail(d, r) {
    const hit = findInWebGPU(webgpu, d.id, d.contextIdx);
    if (!hit) { r.appendChild(noContextMsg("(not found)")); return { root: r }; }
    const rec = hit.record, res = hit.resource;

    if (d.kind === "renderPipeline") {
      const info = rec.renderPipelines.get(res); if (!info) return { root: r };
      r.appendChild(section(`Render Pipeline ${d.id}`));
      r.append(
        row("label",     el("span", null, info.label || "")),
        row("topology",  el("span", null, info.topology)),
        row("cullMode",  el("span", null, info.cullMode)),
        row("frontFace", el("span", null, info.frontFace)),
        row("layout",    el("span", null, info.layoutKind)),
        row("samples",   el("span", null, String(info.multisample.count))),
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
          r.appendChild(row(`target[${i}]`, el("span", null, `${t.format}${t.blend ? " · blend" : ""}`)));
        }
      }
      if (info.depthStencil) {
        r.appendChild(section("depth/stencil"));
        r.append(
          row("format",  el("span", null, info.depthStencil.format || "?")),
          row("write",   el("span", null, info.depthStencil.depthWriteEnabled ? "yes" : "no")),
          row("compare", el("span", null, info.depthStencil.depthCompare || "")),
        );
      }
      return { root: r };
    }
    if (d.kind === "computePipeline") {
      const info = rec.computePipelines.get(res); if (!info) return { root: r };
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
      const info = rec.shaderModules.get(res); if (!info) return { root: r };
      r.appendChild(section(`Shader Module ${d.id}`));
      r.append(
        row("label", el("span", null, info.label || "")),
        row("chars", el("span", null, fmtNum(info.sourceLength))),
      );
      r.appendChild(section("WGSL"));
      const pre = el("pre", null, info.code); pre.className = "wgla-pre"; r.appendChild(pre);
      return { root: r };
    }
    if (d.kind === "gpuBuffer") {
      const info = rec.buffers.get(res); if (!info) return { root: r };
      r.appendChild(section(`Buffer ${d.id}`));
      r.append(
        row("label",         el("span", null, info.label || "")),
        row("size",          el("span", null, fmtBytes(info.size))),
        row("usage",         el("span", null, (info.usageFlags || []).join(" | "))),
        row("mapped@create", el("span", null, info.mappedAtCreation ? "yes" : "no")),
      );
      return { root: r };
    }
    if (d.kind === "gpuTexture") {
      const info = rec.textures.get(res); if (!info) return { root: r };
      r.appendChild(section(`Texture ${d.id}`));
      const sz = info.depthOrArrayLayers > 1 ? `${info.width}×${info.height}×${info.depthOrArrayLayers}` : `${info.width}×${info.height}`;
      r.append(
        row("label",     el("span", null, info.label || "")),
        row("size",      el("span", null, sz)),
        row("format",    el("span", null, info.format || "?")),
        row("dimension", el("span", null, info.dimension)),
        row("mipLevels", el("span", null, String(info.mipLevelCount))),
        row("samples",   el("span", null, String(info.sampleCount))),
        row("usage",     el("span", null, (info.usageFlags || []).join(" | "))),
      );
      return { root: r };
    }
    if (d.kind === "bindGroup") {
      const info = rec.bindGroups.get(res); if (!info) return { root: r };
      r.appendChild(section(`Bind Group ${d.id}`));
      r.append(
        row("label",  el("span", null, info.label || "")),
        row("layout", info.layoutId
          ? linkSpan(info.layoutId, () => openDetail({ side: "webgpu", kind: "bindGroupLayout", id: info.layoutId, contextIdx: hit.ctxIdx }))
          : el("span", { color: "#888" }, "(auto from pipeline)")),
        row("#entries", el("span", null, String((info.entries || []).length))),
      );
      const layoutInfo = info.layout ? rec.bindGroupLayouts.get(info.layout) : null;
      r.appendChild(section("entries"));
      for (const e of (info.entries || [])) {
        const lyEntry = layoutInfo?.entries.find((le) => le.binding === e.binding);
        const meta = el("span");
        if (lyEntry) {
          const vis = (lyEntry.visibility || []).join("|") || "?";
          meta.append(el("span", { color: "#888" }, `${lyEntry.kind} · vis:${vis}`));
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
          const slice = res2.size != null ? res2.size : (total != null ? total - (res2.offset|0) : null);
          const detail = el("span");
          detail.append(link);
          detail.append(el("span", { color: "#888" },
            ` +${res2.offset|0}, ${slice != null ? fmtBytes(slice) : "?"}${total != null ? ` of ${fmtBytes(total)}` : ""}`));
          r.appendChild(row("  buffer", detail));
          // mismatch check rendered inline
          const minSz = lyEntry?.detail?.minBindingSize;
          if (minSz && slice != null && slice < minSz) {
            const warn = el("div", null,
              `⚠ binding size ${fmtBytes(slice)} < minBindingSize ${fmtBytes(minSz)}`);
            warn.className = "wgla-warn"; warn.style.margin = "2px 12px";
            r.appendChild(warn);
          }
        } else if (res2.kind === "textureView") {
          if (res2.textureId) {
            const link = linkSpan(res2.textureId, () => openDetail({
              side: "webgpu", kind: "gpuTexture", id: res2.textureId, contextIdx: hit.ctxIdx,
            }));
            const wrap = el("span");
            wrap.append(el("span", { color: "#888" }, "view of "), link);
            if (res2.label) wrap.append(el("span", { color: "#888" }, ` · ${res2.label}`));
            r.appendChild(row("  textureView", wrap));
          } else {
            r.appendChild(row("  textureView", el("span", { color: "#888" },
              res2.label ? `(canvas?) · ${res2.label}` : "(canvas or external)")));
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
      const info = rec.bindGroupLayouts.get(res); if (!info) return { root: r };
      r.appendChild(section(`Bind Group Layout ${d.id}`));
      r.append(
        row("label",   el("span", null, info.label || "")),
        row("source",  el("span", null, info.explicit ? "explicit" : "derived")),
        row("#entries", el("span", null, String((info.entries || []).length))),
      );
      r.appendChild(section("entries"));
      for (const e of (info.entries || [])) {
        const vis = (e.visibility || []).join("|") || "?";
        const detail = el("span", { color: "#888" }, `${e.kind} · vis:${vis}`);
        if (e.kind === "buffer" && e.detail?.minBindingSize) {
          detail.textContent += ` · minBindingSize:${e.detail.minBindingSize}`;
        }
        if (e.kind === "buffer" && e.detail?.type) {
          detail.textContent += ` · ${e.detail.type}`;
        }
        r.appendChild(row(`@binding(${e.binding})`, detail));
      }
      return { root: r };
    }
    return { root: r };
  }

  // ─── Per-frame tick ──────────────────────────
  let lastSizesSig = "";
  function updateChrome() {
    rebuildDropdown(false);
    const glN  = webgl?.records.size  || 0;
    const gpuN = webgpu?.records.size || 0;
    const parts = [];
    if (glN)  parts.push(`${glN} gl`);
    if (gpuN) parts.push(`${gpuN} gpu`);
    badge.textContent = parts.length ? `  ${parts.join(" · ")}` : "  no context";
    tabButtons.gpu.style.display = gpuN ? "" : "none";
    // Hide WebGL-specific tabs when WebGPU is the only thing in the page —
    // they'd just say "no WebGL context" which is noise.
    const onlyGPU = gpuN && !glN;
    tabButtons.programs.style.display  = onlyGPU ? "none" : "";
    tabButtons.resources.style.display = onlyGPU ? "none" : "";
    if (onlyGPU && (state.tab === "programs" || state.tab === "resources")) switchTab("gpu");
    if (!gpuN && state.tab === "gpu") switchTab("live");
    // Scene tab only appears when a Three.js scene has been attached.
    const sceneN = scenes?.scenes?.length || 0;
    tabButtons.scene.style.display = sceneN ? "" : "none";
    if (!sceneN && state.tab === "scene") switchTab("live");
    // Rerender if the set of contexts changed — most importantly so the Live
    // tab can sprout its WebGPU section once a device is created post-mount.
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
    const m = el("div", null, `no ${label} context`); m.className = "wgla-empty"; return m;
  }

  // initial render
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

export function unmountHUD() {
  const e = document.getElementById(HUD_ID);
  if (e && e.__wgla_unmount) e.__wgla_unmount();
  else if (e) e.remove();
}

// ─── module-level helpers ──────────────────────────
function linkSpan(text, onClick) {
  const s = el("span", null, text || "?"); s.className = "wgla-link";
  s.addEventListener("click", onClick); return s;
}
function downloadCombined(webgl, webgpu) {
  const data = {
    timestamp: new Date().toISOString(), url: location.href,
    webgl:  webgl?.data?.()  || null,
    webgpu: webgpu?.data?.() || null,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "gpu-probe.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function countContexts(webgl, webgpu) {
  return (webgl?.records.size || 0) + (webgpu?.records.size || 0);
}
function makeDropdownSignature(webgl, webgpu) {
  const parts = [];
  if (webgl)  for (const [, r] of webgl.records)  parts.push(`gl:${r.canvas?.id || ""}:${r.canvas?.width}x${r.canvas?.height}`);
  if (webgpu) for (const [, r] of webgpu.records) parts.push(`gpu:${r.canvas?.id || ""}`);
  return parts.join("|");
}
function parseSelectKey(v, webgl, webgpu) {
  const [side, idxStr] = v.split(":"); const idx = +idxStr;
  if (side === "webgl" && webgl) {
    const arr = [...webgl.records.values()]; return { side: "webgl", record: arr[idx] };
  }
  if (side === "webgpu" && webgpu) {
    const arr = [...webgpu.records.values()]; return { side: "webgpu", record: arr[idx] };
  }
  return null;
}
function selectKeyFor(sel, webgl, webgpu) {
  const analyzer = sel.side === "webgl" ? webgl : webgpu;
  if (!analyzer) return "";
  const arr = [...analyzer.records.values()];
  const idx = arr.indexOf(sel.record);
  return idx >= 0 ? `${sel.side}:${idx}` : "";
}
function enableDrag(root, handle) {
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
  handle.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON" || e.target.tagName === "SELECT") return;
    dragging = true; sx = e.clientX; sy = e.clientY;
    const r = root.getBoundingClientRect(); ox = r.left; oy = r.top;
    root.style.left = `${ox}px`; root.style.top = `${oy}px`; root.style.right = "auto";
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    root.style.left = `${ox + (e.clientX - sx)}px`;
    root.style.top  = `${oy + (e.clientY - sy)}px`;
  });
  window.addEventListener("mouseup", () => (dragging = false));
}
